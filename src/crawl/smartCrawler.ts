import type {
  SmartScanOptions,
  SmartScanResult,
  DiscoveredTarget,
  ResultShape,
} from "../types.js";
import {
  buildClient,
  fetchHtml,
  extractLinksAndForms,
  isSameOrigin,
} from "../utils.js";
import { runScan } from "../core/runScan.js";
import { URL as NodeURL } from "url";

async function discoverWithPlaywright(
  startUrls: string[],
  opts: SmartScanOptions
): Promise<DiscoveredTarget[]> {
  const out: DiscoveredTarget[] = [];
  const seenReq = new Set<string>();
  let chromium: any;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return out;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const maxPages = opts.playwrightMaxPages ?? Math.min(10, startUrls.length);
    // фильтруем только http/https
    const httpOnly = startUrls.filter((u) => /^https?:/i.test(u));
    const pagesToVisit = httpOnly.slice(0, maxPages);
    for (const url of pagesToVisit) {
      const page = await context.newPage();
      page.on("request", (req: any) => {
        try {
          const url = req.url();
          const method = req.method().toUpperCase();
          if (!/^https?:/i.test(url)) return;
          if (opts.sameOriginOnly && !isSameOrigin(opts.baseUrl, url)) return;
          const key = `${method} ${url}`;
          if (seenReq.has(key)) return;
          seenReq.add(key);
          let body: any = undefined;
          const postData = req.postData();
          if (postData) {
            try {
              if (
                /application\/json/i.test(req.headers()["content-type"] || "")
              )
                body = JSON.parse(postData);
              else body = postData;
            } catch {
              body = postData;
            }
          }
          out.push({
            kind: "json-endpoint",
            url,
            method: method as any,
            body,
            headers: req.headers(),
          });
        } catch {}
      });
      // пропускаем не-HTTP(S) даже если каким-то образом просочились
      if (!/^https?:/i.test(url)) {
        await page.close();
        continue;
      }
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(1500);
      } catch {
        // игнорируем ошибки навигации (например, abort на mailto:)
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return out;
}

export async function smartScan(
  opts: SmartScanOptions
): Promise<SmartScanResult> {
  const {
    baseUrl,
    maxDepth = 2,
    maxPages = 50,
    sameOriginOnly = true,
    requestTimeoutMs = 10000,
    usePlaywright = true,
    headers,
    cookies,
    techniques,
  } = opts;
  // console.warn("[!] Use only with permission.");
  const onP = opts.onProgress;
  // Perform optional auth first and use resulting headers/cookies for crawling
  const authClient = buildClient(requestTimeoutMs, headers, cookies);
  const authResult = await (
    await import("../utils.js")
  ).performAuth(authClient, opts.auth);
  const mergedHeaders = { ...(headers || {}), ...(authResult?.headers || {}) };
  const mergedCookies = { ...(cookies || {}), ...(authResult?.cookies || {}) };
  const client = buildClient(requestTimeoutMs, mergedHeaders, mergedCookies);
  const origin = new NodeURL(baseUrl).origin;
  const q: Array<{ url: string; depth: number }> = [{ url: baseUrl, depth: 0 }];
  const visited = new Set<string>();
  const candidates: DiscoveredTarget[] = [];
  let crawled = 0;

  while (q.length && crawled < maxPages) {
    const { url, depth } = q.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    crawled++;
    const html = await fetchHtml(client, url);
    if (!html) continue;
    const { links, forms } = extractLinksAndForms(url, html);
    forms.forEach((f) => candidates.push(f));
    for (const link of links) {
      if (sameOriginOnly && !isSameOrigin(origin, link)) continue;
      if (/\.(png|jpe?g|gif|svg|webp|ico|pdf|zip|rar|7z|mp4|mp3)$/i.test(link))
        continue;
      const u = new NodeURL(link);
      if ([...u.searchParams.keys()].length > 0)
        candidates.push({ kind: "url-with-query", url: u.toString() });
      if (depth + 1 <= maxDepth)
        q.push({ url: u.toString(), depth: depth + 1 });
    }
    onP?.({ kind: "smart", phase: "crawl", crawledPages: crawled, maxPages });
  }

  if (usePlaywright) {
    const startPages = Array.from(visited).slice(0, Math.min(20, visited.size));
    const jsonTargets = await discoverWithPlaywright(startPages, opts);
    for (const jt of jsonTargets) candidates.push(jt);
  }

  const seenKey = new Set<string>();
  const uniqueCandidates = candidates.filter((c) => {
    const key =
      c.kind === "form"
        ? `${c.kind}:${c.method}:${c.action}:${c.fields
            .map((f) => f.name)
            .sort()
            .join(",")}`
        : c.kind === "url-with-query"
        ? `${c.kind}:${c.url}`
        : `${c.kind}:${c.method}:${c.url}`;
    if (seenKey.has(key)) return false;
    seenKey.add(key);
    return true;
  });

  const sqliResults: ResultShape[] = [];
  onP?.({
    kind: "smart",
    phase: "scan",
    candidatesFound: uniqueCandidates.length,
    scanProcessed: 0,
    scanTotal: uniqueCandidates.length,
  });
  for (const c of uniqueCandidates) {
    if (c.kind === "url-with-query") {
      sqliResults.push(
        await runScan({
          target: c.url,
          method: "GET",
          headers: mergedHeaders,
          cookies: mergedCookies,
          requestTimeoutMs,
          enable: {
            query: true,
            path: true,
            form: false,
            json: false,
            header: false,
            cookie: false,
            error: techniques?.error ?? true,
            boolean: techniques?.boolean ?? true,
            time: techniques?.time ?? true,
          },
          onProgress: (p) => {
            if (p.phase === "done") {
              const done =
                sqliResults.length + 1 > uniqueCandidates.length
                  ? uniqueCandidates.length
                  : sqliResults.length + 1;
              const remaining = Math.max(0, uniqueCandidates.length - done);
              onP?.({
                kind: "smart",
                phase: "scan",
                candidatesFound: uniqueCandidates.length,
                scanProcessed: done,
                scanTotal: uniqueCandidates.length,
                etaMs: remaining * (p.etaMs ?? 0),
              });
            }
          },
        })
      );
    } else if (c.kind === "form") {
      sqliResults.push(
        await runScan({
          target: c.action,
          method: c.method,
          headers: mergedHeaders,
          cookies: mergedCookies,
          requestTimeoutMs,
          enable: {
            query: false,
            path: false,
            form: true,
            json: false,
            header: false,
            cookie: false,
            error: techniques?.error ?? true,
            boolean: techniques?.boolean ?? true,
            time: techniques?.time ?? true,
          },
          onProgress: (p) => {
            if (p.phase === "done") {
              const done =
                sqliResults.length + 1 > uniqueCandidates.length
                  ? uniqueCandidates.length
                  : sqliResults.length + 1;
              const remaining = Math.max(0, uniqueCandidates.length - done);
              onP?.({
                kind: "smart",
                phase: "scan",
                candidatesFound: uniqueCandidates.length,
                scanProcessed: done,
                scanTotal: uniqueCandidates.length,
                etaMs: remaining * (p.etaMs ?? 0),
              });
            }
          },
        })
      );
    } else if (c.kind === "json-endpoint") {
      const enableJson = ["POST", "PUT", "PATCH"].includes(c.method);
      sqliResults.push(
        await runScan({
          target: c.url,
          method: c.method === "GET" || c.method === "POST" ? c.method : "POST",
          headers: { ...mergedHeaders, ...(c.headers || {}) },
          cookies: mergedCookies,
          jsonBody:
            enableJson && typeof c.body === "object" ? c.body : undefined,
          requestTimeoutMs,
          enable: {
            query: true,
            path: true,
            form: false,
            json: enableJson,
            header: false,
            cookie: false,
            error: techniques?.error ?? true,
            boolean: techniques?.boolean ?? true,
            time: techniques?.time ?? true,
          },
          onProgress: (p) => {
            if (p.phase === "done") {
              const done =
                sqliResults.length + 1 > uniqueCandidates.length
                  ? uniqueCandidates.length
                  : sqliResults.length + 1;
              const remaining = Math.max(0, uniqueCandidates.length - done);
              onP?.({
                kind: "smart",
                phase: "scan",
                candidatesFound: uniqueCandidates.length,
                scanProcessed: done,
                scanTotal: uniqueCandidates.length,
                etaMs: remaining * (p.etaMs ?? 0),
              });
            }
          },
        })
      );
    }
  }

  onP?.({
    kind: "smart",
    phase: "done",
    candidatesFound: uniqueCandidates.length,
    scanProcessed: uniqueCandidates.length,
    scanTotal: uniqueCandidates.length,
    etaMs: 0,
  });
  return {
    crawledPages: visited.size,
    candidates: uniqueCandidates,
    sqli: sqliResults,
  };
}
