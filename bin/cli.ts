#!/usr/bin/env node
import { SqlScanner } from "../src/index.js";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: sql-scan <url> [--no-js]");
    process.exit(2);
  }

  const useJs = !process.argv.includes("--no-js");
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
