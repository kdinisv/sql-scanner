#!/usr/bin/env node

// Динамический импорт собранного ESM-бандла, чтобы не тянуть src при сборке CLI
async function getScanner() {
  const mod = await import(new URL("./esm/index.js", import.meta.url).href);
  return mod.SqlScanner as typeof import("../src/index.js").SqlScanner;
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: sql-scan <url> [--no-js]");
    process.exit(2);
  }

  const useJs = !process.argv.includes("--no-js");
  const SqlScanner = await getScanner();
  const scanner = new SqlScanner({
    requestTimeoutMs: 10000,
    timeThresholdMs: 3000,
    parallel: 4,
    maxRequests: 500,
  });

  const res = await scanner.smartScan({
    baseUrl: url,
    usePlaywright: useJs,
    maxDepth: 2,
    maxPages: 50,
    sameOriginOnly: true,
    onProgress: (p: any) => {
      const fmt = (ms?: number) =>
        ms === undefined ? "?" : `${Math.ceil(ms / 1000)}s`;
      if (p.kind === "smart") {
        if (p.phase === "crawl") {
          process.stdout.write(
            `\r[crawl] ${p.crawledPages ?? 0}/${p.maxPages ?? "?"} pages...   `
          );
        } else if (p.phase === "scan") {
          const done = p.scanProcessed ?? 0;
          const total = p.scanTotal ?? 0;
          process.stdout.write(
            `\r[scan] ${done}/${total} candidates, eta ${fmt(p.etaMs)}      `
          );
        } else if (p.phase === "done") {
          process.stdout.write(
            "\r[done]                                             \n"
          );
        }
      }
      if (p.kind === "scan" && p.phase === "scan") {
        const done = p.processedChecks ?? 0;
        const total = p.plannedChecks ?? 0;
        process.stdout.write(
          `\r[checks] ${done}/${total}, eta ${fmt(p.etaMs)}               `
        );
      }
    },
  });

  const vulns = res.sqli
    .filter((r) => r.vulnerable)
    .flatMap((r) => r.details.filter((d) => d.vulnerable));

  console.log(
    JSON.stringify(
      {
        crawledPages: res.crawledPages,
        candidates: res.candidates.length,
        vulns: vulns.length,
        details: vulns.slice(0, 20),
      },
      null,
      2
    )
  );

  process.exit(vulns.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
