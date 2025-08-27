import type {
  ScanInput,
  ResultShape,
  InjectionPoint,
  Detail,
} from "../types.js";
import {
  buildClient,
  discoverQueryPoints,
  discoverPathPoints,
  discoverJsonPoints,
  discoverHeaderCookiePoints,
  fetchAndDiscoverForms,
  sleep,
  jitter,
  errorPayloads,
  booleanPairs,
  timePayloads,
  hasSqlError,
  clip,
  similaritySignal,
  bodyToText,
  extractTitle,
  sendWithInjection,
  performAuth,
} from "../utils.js";

export async function runScan(input: ScanInput): Promise<ResultShape> {
  const {
    target,
    jsonBody,
    headers,
    cookies,
    auth,
    timeThresholdMs = 2500,
    requestTimeoutMs = 10000,
    parallel = 4,
    maxRequests = 500,
    enable = {},
  } = input;
  console.warn("[!] Use only with permission.");
  // If auth is provided, run it and merge cookies/headers
  const authClient = buildClient(requestTimeoutMs, headers, cookies);
  const authResult = await performAuth(authClient, auth);
  const mergedHeaders = { ...(headers || {}), ...(authResult?.headers || {}) };
  const mergedCookies = { ...(cookies || {}), ...(authResult?.cookies || {}) };
  const client = buildClient(requestTimeoutMs, mergedHeaders, mergedCookies);
  const rootUrl = new URL(target);

  let points: InjectionPoint[] = [];
  let forms: Record<string, any>[] = [];
  if (enable.query ?? true) points.push(...discoverQueryPoints(rootUrl));
  if (enable.path ?? true) points.push(...discoverPathPoints(rootUrl));
  if (enable.form ?? true) {
    const found = await fetchAndDiscoverForms(client, rootUrl.toString());
    points.push(...found.points);
    forms = found.forms;
  }
  if (enable.json ?? Boolean(jsonBody))
    points.push(...discoverJsonPoints(jsonBody));
  if (enable.header ?? false)
    points.push(...discoverHeaderCookiePoints(headers, undefined));
  if (enable.cookie ?? false)
    points.push(...discoverHeaderCookiePoints(undefined, cookies));

  const seen = new Set<string>();
  points = points.filter((p) => {
    const key = `${p.kind}:${p.name}:${JSON.stringify(p.meta ?? {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (points.length * 6 > maxRequests)
    points = points.slice(0, Math.max(1, Math.floor(maxRequests / 6)));

  const details: Detail[] = [];
  const report = input.onProgress;
  let active = 0;
  const tasks: Promise<void>[] = [];
  async function runTask(fn: () => Promise<void>) {
    while (active >= parallel) await sleep(15);
    active++;
    try {
      await fn();
    } finally {
      active--;
    }
  }

  // Report discovery
  report?.({ kind: "scan", phase: "discover", points: points.length });

  // Estimate planned checks
  const errs = input.payloads?.error ?? errorPayloads;
  const pairs = input.payloads?.boolean ?? booleanPairs;
  const times = input.payloads?.time ?? timePayloads;
  const perPoint =
    (enable.error ?? true ? errs.length : 0) +
    (enable.boolean ?? true ? pairs.length : 0) +
    (enable.time ?? true ? times.length : 0);
  const plannedChecks = perPoint * points.length;
  let processed = 0;
  const tStart = Date.now();

  for (const point of points) {
    tasks.push(
      runTask(async () => {
        const baselineRes = await sendWithInjection(
          client,
          input,
          point,
          "",
          forms
        );
        const baseText = bodyToText(baselineRes);
        const baseTitle = extractTitle(baseText);
        await sleep(jitter());

        // error
        if (enable.error ?? true) {
          const errs = input.payloads?.error ?? errorPayloads;
          for (const p of errs) {
            const t0 = Date.now();
            const res = await sendWithInjection(client, input, point, p, forms);
            const elapsed = Date.now() - t0;
            const text = bodyToText(res);
            const isErr = hasSqlError(text);
            details.push({
              point,
              payload: p,
              technique: "error",
              vulnerable: isErr,
              responseMeta: {
                status: res.status,
                len: text.length,
                elapsedMs: elapsed,
                location: String(res.headers["location"] || ""),
              },
              evidence: isErr ? clip(text) : undefined,
              confirmations: isErr ? ["error_signature"] : undefined,
            });
            processed++;
            const avg = (Date.now() - tStart) / Math.max(1, processed);
            const eta =
              plannedChecks > 0
                ? Math.max(0, Math.round(avg * (plannedChecks - processed)))
                : undefined;
            report?.({
              kind: "scan",
              phase: "scan",
              plannedChecks,
              processedChecks: processed,
              etaMs: eta,
            });
            if (isErr) break;
            await sleep(jitter());
          }
        }

        // boolean
        if (enable.boolean ?? true) {
          const pairs = input.payloads?.boolean ?? booleanPairs;
          for (const pair of pairs) {
            const resT = await sendWithInjection(
              client,
              input,
              point,
              pair.true,
              forms
            );
            const resF = await sendWithInjection(
              client,
              input,
              point,
              pair.false,
              forms
            );
            const a = bodyToText(resT),
              b = bodyToText(resF);
            const simBaseT = similaritySignal(baseText, a);
            const simBaseF = similaritySignal(baseText, b);
            const simTF = similaritySignal(a, b);
            const bothOk = resT.status < 500 && resF.status < 500;
            // Для JSON эндпойнтов допускаем различие в длине/полях как сигнал
            const isJson =
              (resT.headers["content-type"] || "").includes(
                "application/json"
              ) ||
              (resF.headers["content-type"] || "").includes("application/json");
            const lenDelta =
              Math.abs(a.length - b.length) / Math.max(1, baseText.length);
            const jsonSignal = isJson && lenDelta > 0.15;
            const vuln =
              bothOk &&
              ((simTF < 0.6 && Math.abs(simBaseT - simBaseF) > 0.25) ||
                jsonSignal);
            details.push({
              point,
              payload: `${pair.true} | ${pair.false}`,
              technique: "boolean_truefalse",
              vulnerable: vuln,
              responseMeta: {
                status: resT.status,
                len: a.length,
                location: String(resT.headers["location"] || ""),
              },
              evidence: vuln
                ? `sim(base,true)=${simBaseT.toFixed(
                    2
                  )} sim(base,false)=${simBaseF.toFixed(
                    2
                  )} sim(true,false)=${simTF.toFixed(2)}`
                : undefined,
              confirmations: vuln && pair.label ? [pair.label] : undefined,
            });
            processed++;
            const avg = (Date.now() - tStart) / Math.max(1, processed);
            const eta =
              plannedChecks > 0
                ? Math.max(0, Math.round(avg * (plannedChecks - processed)))
                : undefined;
            report?.({
              kind: "scan",
              phase: "scan",
              plannedChecks,
              processedChecks: processed,
              etaMs: eta,
            });
            if (vuln) break;
            await sleep(jitter());
          }
        }

        // time
        if (enable.time ?? true) {
          const times = input.payloads?.time ?? timePayloads;
          for (const t of times) {
            const t0 = Date.now();
            const res = await sendWithInjection(
              client,
              input,
              point,
              t.p,
              forms
            );
            const elapsed = Date.now() - t0;
            const text = bodyToText(res);
            const nearBase =
              similaritySignal(baseText, text) > 0.7 && res.status < 500;
            const vuln = elapsed > (input.timeThresholdMs ?? 2500) && nearBase;
            details.push({
              point,
              payload: t.p,
              technique: "time",
              vulnerable: vuln,
              responseMeta: {
                status: res.status,
                elapsedMs: elapsed,
                len: text.length,
                location: String(res.headers["location"] || ""),
              },
              evidence: `elapsed_ms=${elapsed}`,
              confirmations: vuln && t.label ? [t.label] : undefined,
            });
            processed++;
            const avg = (Date.now() - tStart) / Math.max(1, processed);
            const eta =
              plannedChecks > 0
                ? Math.max(0, Math.round(avg * (plannedChecks - processed)))
                : undefined;
            report?.({
              kind: "scan",
              phase: "scan",
              plannedChecks,
              processedChecks: processed,
              etaMs: eta,
            });
            if (vuln) break;
            await sleep(jitter());
          }
        }
      })
    );
  }

  await Promise.all(tasks);
  report?.({
    kind: "scan",
    phase: "done",
    plannedChecks,
    processedChecks: processed,
    etaMs: 0,
  });
  return { vulnerable: details.some((d) => d.vulnerable), details };
}
