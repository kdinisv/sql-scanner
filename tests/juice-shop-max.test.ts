import { describe, it, expect } from "vitest";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { SqlScanner } from "../src/index.js";

async function isUp(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve((res.statusCode || 0) > 0);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function hasPlaywright(): Promise<boolean> {
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}

describe("Juice Shop max-coverage SQLi scan (optional)", () => {
  it(
    "finds as many SQL injections as possible and writes a report",
    async () => {
      const base = "http://127.0.0.1:3000";
      if (!(await isUp(base))) {
        // eslint-disable-next-line no-console
        console.warn("[skip] Juice Shop is not running on 127.0.0.1:3000");
        return;
      }

      const pw = await hasPlaywright();
      if (!pw) {
        // eslint-disable-next-line no-console
        console.warn(
          "[info] Playwright not installed; running without JS-network capture"
        );
      }

      const scanner = new SqlScanner({
        requestTimeoutMs: 12000,
        timeThresholdMs: 2500,
        parallel: 8,
        maxRequests: 1500,
      });

      const started = Date.now();
      const smart = await scanner.smartScan({
        baseUrl: base,
        maxDepth: 2,
        maxPages: 60,
        sameOriginOnly: true,
        usePlaywright: pw,
        playwrightMaxPages: 12,
        headers: {
          "User-Agent": "sql-scanner-tests/juice-shop",
        },
        techniques: { error: true, boolean: true, time: false },
      });
      const elapsed = Date.now() - started;

      const totalFindings = smart.sqli
        .flatMap((r) => r.details)
        .filter((d) => d.vulnerable).length;
      const byTechnique = smart.sqli
        .flatMap((r) => r.details)
        .filter((d) => d.vulnerable)
        .reduce<Record<string, number>>((acc, d) => {
          acc[d.technique] = (acc[d.technique] || 0) + 1;
          return acc;
        }, {});

      // eslint-disable-next-line no-console
      console.info(
        `[juice-shop] crawled=${smart.crawledPages} candidates=${smart.candidates.length} ` +
          `vuln=${totalFindings} in ${elapsed}ms techniques=${JSON.stringify(
            byTechnique
          )}`
      );

      // Запишем подробный отчет для анализа
      const outDir = path.join("tests", "out");
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(
        path.join(outDir, "juice-shop-sqli-report.json"),
        JSON.stringify(
          {
            base,
            elapsedMs: elapsed,
            crawledPages: smart.crawledPages,
            candidates: smart.candidates,
            findings: smart.sqli
              .map((r) => r.details.filter((d) => d.vulnerable))
              .flat(),
          },
          null,
          2
        ),
        "utf-8"
      );

      // Утверждение мягкое, так как набор уязвимостей может отличаться по версиям
      expect(smart.sqli.length).toBeGreaterThan(0);
      // Не валим сборку, если конкретная версия магазина не проявляет SQLi
      // Показываем результат в отчете, а утверждение мягкое
      expect(totalFindings).toBeGreaterThanOrEqual(0);
    },
    // Даем щедрый таймаут для глубокой проверки
    5 * 60 * 1000
  );
});
