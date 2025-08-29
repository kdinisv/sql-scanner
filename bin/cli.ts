#!/usr/bin/env node

// Загружаем .env (если есть)
import "dotenv/config";

// Динамический импорт собранного ESM-бандла, чтобы не тянуть src при сборке CLI
async function getScanner() {
  const mod = await import(new URL("./esm/index.js", import.meta.url).href);
  return {
    SqlScanner: mod.SqlScanner as typeof import("../src/index.js").SqlScanner,
    toJsonReport:
      mod.toJsonReport as typeof import("../src/index.js").toJsonReport,
    toMarkdownReport:
      mod.toMarkdownReport as typeof import("../src/index.js").toMarkdownReport,
    toCsvReport:
      mod.toCsvReport as typeof import("../src/index.js").toCsvReport,
    toJUnitReport:
      mod.toJUnitReport as typeof import("../src/index.js").toJUnitReport,
  };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      `Usage: sql-scan <url> [--no-js] [--report json|md|csv|junit] [--out path]\n\n` +
        `Options:\n` +
        `  --no-js                Disable JS/SPA capture (faster)\n` +
        `  --report <fmt>         Save report in format: json|md|csv|junit\n` +
        `  --out <path>           Output file path for the report\n` +
        `  -h, --help             Show this help\n`
    );
    process.exit(0);
  }

  const url = process.argv[2];
  if (!url) {
    console.error(
      "Usage: sql-scan <url> [--no-js] [--report json|md|csv|junit] [--out path]"
    );
    process.exit(2);
  }

  // helpers for env parsing
  const parseBool = (v: string | undefined, def: boolean): boolean => {
    if (v == null || v === "") return def;
    const s = String(v).trim().toLowerCase();
    return ["1", "true", "yes", "y", "on"].includes(s)
      ? true
      : ["0", "false", "no", "n", "off"].includes(s)
      ? false
      : def;
  };
  const parseNum = (v: string | undefined, def: number): number => {
    if (v == null || v === "") return def;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  const parsePairs = (
    v: string | undefined
  ): Record<string, string> | undefined => {
    if (!v) return undefined;
    const out: Record<string, string> = {};
    for (const chunk of v.split(/[,;\n]+/)) {
      const [k, ...rest] = chunk.split("=");
      const key = k?.trim();
      if (!key) continue;
      out[key] = rest.join("=").trim();
    }
    return Object.keys(out).length ? out : undefined;
  };

  // env defaults (overridable by flags)
  const envUseJs = parseBool(process.env.SQL_SCANNER_USE_JS, true);
  const useJs = process.argv.includes("--no-js") ? false : envUseJs;
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

  const {
    SqlScanner,
    toJsonReport,
    toMarkdownReport,
    toCsvReport,
    toJUnitReport,
  } = await getScanner();
  // Build scanner options from env (with sane defaults)
  const scanner = new SqlScanner({
    requestTimeoutMs: parseNum(
      process.env.SQL_SCANNER_REQUEST_TIMEOUT_MS,
      10000
    ),
    timeThresholdMs: parseNum(process.env.SQL_SCANNER_TIME_THRESHOLD_MS, 3000),
    parallel: parseNum(process.env.SQL_SCANNER_PARALLEL, 4),
    maxRequests: parseNum(process.env.SQL_SCANNER_MAX_REQUESTS, 500),
    headers:
      (process.env.SQL_SCANNER_HEADERS_JSON &&
        (() => {
          try {
            return JSON.parse(process.env.SQL_SCANNER_HEADERS_JSON!);
          } catch {
            return undefined;
          }
        })()) ||
      parsePairs(process.env.SQL_SCANNER_HEADERS),
    cookies:
      (process.env.SQL_SCANNER_COOKIES_JSON &&
        (() => {
          try {
            return JSON.parse(process.env.SQL_SCANNER_COOKIES_JSON!);
          } catch {
            return undefined;
          }
        })()) ||
      parsePairs(process.env.SQL_SCANNER_COOKIES),
  });

  const res = await scanner.smartScan({
    baseUrl: url,
    usePlaywright: useJs,
    maxDepth: parseNum(process.env.SQL_SCANNER_MAX_DEPTH, 2),
    maxPages: parseNum(process.env.SQL_SCANNER_MAX_PAGES, 50),
    sameOriginOnly: parseBool(process.env.SQL_SCANNER_SAME_ORIGIN_ONLY, true),
    // techniques toggles (error/boolean/time) via CSV: e.g., "error,boolean"
    ...(process.env.SQL_SCANNER_TECHNIQUES
      ? {
          techniques: (() => {
            const set = new Set(
              process.env
                .SQL_SCANNER_TECHNIQUES!.split(/[ ,;]+/)
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean)
            );
            return {
              error: set.has("error"),
              boolean: set.has("boolean"),
              time: set.has("time"),
            };
          })(),
        }
      : {}),
    // auth via JSON (опционально)
    ...(process.env.SQL_SCANNER_AUTH_JSON
      ? (() => {
          try {
            return { auth: JSON.parse(process.env.SQL_SCANNER_AUTH_JSON!) };
          } catch {
            return {} as any;
          }
        })()
      : {}),
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
      let content: string;
      switch (reportFmt) {
        case "md":
          content = toMarkdownReport(first);
          break;
        case "csv":
          content = toCsvReport(first);
          break;
        case "junit":
          content = toJUnitReport(first);
          break;
        default:
          content = toJsonReport(first);
      }
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
