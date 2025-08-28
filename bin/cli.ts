#!/usr/bin/env node

// Динамический импорт собранного ESM-бандла, чтобы не тянуть src при сборке CLI
async function getScanner() {
  const mod = await import(new URL("./esm/index.js", import.meta.url).href);
  return {
    SqlScanner: mod.SqlScanner as typeof import("../src/index.js").SqlScanner,
    toJsonReport:
      mod.toJsonReport as typeof import("../src/index.js").toJsonReport,
    toMarkdownReport:
      mod.toMarkdownReport as typeof import("../src/index.js").toMarkdownReport,
  };
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error(
      "Usage: sql-scan <url> [--no-js] [--report json|md] [--out path]"
    );
    process.exit(2);
  }

  const useJs = !process.argv.includes("--no-js");
  const reportFmt = (() => {
    const i = process.argv.indexOf("--report");
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
    return null;
  })();
  const outPath = (() => {
    const i = process.argv.indexOf("--out");
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
    return null;
  })();

  const { SqlScanner, toJsonReport, toMarkdownReport } = await getScanner();
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

  // Default short stdout summary
  const summary = {
    crawledPages: res.crawledPages,
    candidates: res.candidates.length,
    vulns: vulns.length,
  };
  console.log(JSON.stringify(summary, null, 2));

  // Optional full report from the first scan result (best-effort)
  if (reportFmt && outPath) {
    try {
      const fs = await import("node:fs/promises");
      const first = res.sqli[0] || { vulnerable: false, details: [] };
      const content =
        reportFmt === "md" ? toMarkdownReport(first) : toJsonReport(first);
      await fs.writeFile(outPath, content, "utf8");
      console.error(`[report] saved ${reportFmt} to ${outPath}`);
    } catch (e) {
      console.error(`[report] failed:`, e);
    }
  }

  process.exit(vulns.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
