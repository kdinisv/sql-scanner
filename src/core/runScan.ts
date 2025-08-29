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
  unionPayloads,
  orderByProbes,
  hasSqlError,
  clip,
  similaritySignal,
  bodyToText,
  extractTitle,
  sendWithInjection,
  performAuth,
  mean,
  pairedZTestPValue,
  detectDbFingerprint,
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
  // console.warn("[!] Use only with permission.");
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
  const unions = input.payloads?.union ?? unionPayloads;
  const orderbys = input.payloads?.orderBy ?? orderByProbes;
  const perPoint =
    (enable.error ?? true ? errs.length : 0) +
    (enable.boolean ?? true ? pairs.length : 0) +
    (enable.time ?? true ? times.length : 0) +
    (enable.union ?? false ? unions.length + orderbys.length : 0);
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
            const fp = isErr ? detectDbFingerprint(text) : "unknown";
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
              confirmations: isErr ? ["error_signature", fp] : undefined,
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

        // union-based: infer column count via ORDER BY and craft UNION SELECT
        if (enable.union ?? false) {
          // Optional: use previous DB fingerprint if needed later
          const knownDb = details
            .filter((d) => d.technique === "error" && d.vulnerable)
            .flatMap((d) => d.confirmations || [])
            .find((c) =>
              ["mysql", "postgres", "mssql", "oracle", "sqlite"].includes(c)
            );

          // Infer column count by increasing ORDER BY index until response stops changing
          const maxTry = 8;
          let columnCount: number | null = null;
          for (let n = 1; n <= maxTry; n++) {
            const okPayload = ` ORDER BY ${n}`;
            const badPayload = ` ORDER BY ${n + 10}`;
            const resOk = await sendWithInjection(
              client,
              input,
              point,
              okPayload,
              forms
            );
            const resBad = await sendWithInjection(
              client,
              input,
              point,
              badPayload,
              forms
            );
            const a = bodyToText(resOk);
            const b = bodyToText(resBad);
            const sim = similaritySignal(a, b);
            const lenDiff =
              Math.abs(a.length - b.length) / Math.max(a.length, b.length, 1);
            const statusOk = resOk.status < 500 && resBad.status < 500;
            const changed = statusOk && (sim < 0.995 || lenDiff > 0.01);
            details.push({
              point,
              payload: `${okPayload} | ${badPayload}`,
              technique: "union",
              vulnerable: changed,
              responseMeta: { status: resOk.status, len: a.length },
              evidence: changed ? `orderby-sim=${sim.toFixed(2)}` : undefined,
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
            if (changed) columnCount = n;
            else break;
            await sleep(jitter());
          }

          if (columnCount && columnCount >= 1) {
            const cols = Array.from({ length: columnCount }, () => "NULL").join(
              ","
            );
            const unionPayload = ` UNION SELECT ${cols}`;
            const resU = await sendWithInjection(
              client,
              input,
              point,
              unionPayload,
              forms
            );
            const txt = bodyToText(resU);
            const simToBase = similaritySignal(baseText, txt);
            const lenDeltaBase =
              Math.abs(baseText.length - txt.length) /
              Math.max(baseText.length, txt.length, 1);
            const noSqlErr = !hasSqlError(txt);
            const diff = simToBase < 0.995 || lenDeltaBase > 0.01;
            const vuln = noSqlErr && diff;
            details.push({
              point,
              payload: unionPayload,
              technique: "union",
              vulnerable: vuln,
              responseMeta: { status: resU.status, len: txt.length },
              evidence: vuln
                ? `sim(base,union)=${simToBase.toFixed(2)}`
                : undefined,
              confirmations: vuln
                ? (["union_select_nulls", knownDb || "unknown"].filter(
                    Boolean
                  ) as string[])
                : undefined,
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
          }
        }

        // time with basic statistical confirmation
        if (enable.time ?? true) {
          let times = input.payloads?.time ?? timePayloads;
          // prioritize DB-specific payloads if we have a hint from error-based earlier details
          const knownDb = details
            .filter((d) => d.technique === "error" && d.vulnerable)
            .flatMap((d) => d.confirmations || [])
            .find((c) =>
              ["mysql", "postgres", "mssql", "oracle", "sqlite"].includes(c)
            );
          if (knownDb) {
            const order = (p: { p: string; label?: string }) =>
              knownDb === "mysql"
                ? p.p.includes("SLEEP(")
                : knownDb === "postgres"
                ? p.p.toLowerCase().includes("pg_sleep")
                : knownDb === "mssql"
                ? p.p.toUpperCase().includes("WAITFOR DELAY")
                : knownDb === "oracle"
                ? p.p.toUpperCase().includes("DBMS_LOCK.SLEEP")
                : 0;
            times = [...times].sort(
              (a, b) => (order(b) as any) - (order(a) as any)
            );
          }
          for (const t of times) {
            const attempts = 3; // keep test runtime reasonable
            const baselineTimes: number[] = [];
            const injectedTimes: number[] = [];
            let nearBaseAll = true;

            for (let i = 0; i < attempts; i++) {
              // baseline
              let t0 = Date.now();
              const baseRes = await sendWithInjection(
                client,
                input,
                point,
                "",
                forms
              );
              let elapsedBase = Date.now() - t0;
              baselineTimes.push(elapsedBase);
              const baseOk = baseRes.status < 500;

              await sleep(10);

              // injected
              t0 = Date.now();
              const injRes = await sendWithInjection(
                client,
                input,
                point,
                t.p,
                forms
              );
              const elapsedInj = Date.now() - t0;
              injectedTimes.push(elapsedInj);
              const near = injRes.status < 500 && baseOk; // don't require body similarity (payload may be echoed)
              if (!near) nearBaseAll = false;

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
              await sleep(jitter());
            }

            const diffs = injectedTimes.map(
              (x, i) => x - (baselineTimes[i] || 0)
            );
            const { p, z } = pairedZTestPValue(diffs);
            const avgBase = mean(baselineTimes);
            const avgInj = mean(injectedTimes);
            const threshold = input.timeThresholdMs ?? 2500;
            const strongDelay = avgInj - avgBase > threshold * 0.8; // allow some noise
            const vuln = nearBaseAll && strongDelay && p <= 0.05;

            details.push({
              point,
              payload: t.p,
              technique: "time",
              vulnerable: vuln,
              responseMeta: {
                status: 200,
                elapsedMs: Math.round(avgInj),
                len: baseText.length,
              },
              evidence: `p=${p.toFixed(4)}, z=${z.toFixed(
                2
              )}, avgBase=${Math.round(avgBase)}ms, avgInj=${Math.round(
                avgInj
              )}ms`,
              confirmations:
                vuln && t.label
                  ? [t.label, "time_pvalue"]
                  : vuln
                  ? ["time_pvalue"]
                  : undefined,
            });

            if (vuln) break;
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
