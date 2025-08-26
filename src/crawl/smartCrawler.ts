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
    const pagesToVisit = startUrls.slice(0, maxPages);
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
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(1500);
      await page.close();
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
  } = opts;
  console.warn("[!] Use only with permission.");
  const client = buildClient(requestTimeoutMs, headers, cookies);
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
  for (const c of uniqueCandidates) {
    if (c.kind === "url-with-query") {
      sqliResults.push(
        await runScan({
          target: c.url,
          method: "GET",
          headers,
          cookies,
          requestTimeoutMs,
          enable: {
            query: true,
            path: true,
            form: false,
            json: false,
            header: false,
            cookie: false,
            error: true,
            boolean: true,
            time: true,
          },
        })
      );
    } else if (c.kind === "form") {
      sqliResults.push(
        await runScan({
          target: c.action,
          method: c.method,
          headers,
          cookies,
          requestTimeoutMs,
          enable: {
            query: false,
            path: false,
            form: true,
            json: false,
            header: false,
            cookie: false,
            error: true,
            boolean: true,
            time: true,
          },
        })
      );
    } else if (c.kind === "json-endpoint") {
      const enableJson = ["POST", "PUT", "PATCH"].includes(c.method);
      sqliResults.push(
        await runScan({
          target: c.url,
          method: c.method === "GET" || c.method === "POST" ? c.method : "POST",
          headers: { ...headers, ...(c.headers || {}) },
          cookies,
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
            error: true,
            boolean: true,
            time: true,
          },
        })
      );
    }
  }

  return {
    crawledPages: visited.size,
    candidates: uniqueCandidates,
    sqli: sqliResults,
  };
}
