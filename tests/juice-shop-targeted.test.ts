import { describe, it, expect } from "vitest";
import http from "node:http";
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

describe("Juice Shop targeted SQLi checks (optional)", () => {
  it("scans known endpoints for SQLi patterns", async () => {
    const base = "http://127.0.0.1:3000";
    if (!(await isUp(base))) {
      // eslint-disable-next-line no-console
      console.warn("[skip] Juice Shop is not running on 127.0.0.1:3000");
      return;
    }

    const scanner = new SqlScanner({ requestTimeoutMs: 10000 });

    // 1) REST search endpoint (query-based)
    const restSearch = await scanner.scan({
      target: `${base}/rest/products/search?q=test`,
      method: "GET",
      enable: {
        query: true,
        path: false,
        form: false,
        json: false,
        header: false,
        cookie: false,
        error: true,
        boolean: true,
        time: false,
      },
      payloads: {
        error: [
          "'",
          "' OR 1=1--",
          "' UNION SELECT 1--",
          "' UNION SELECT 1,2--",
        ],
        boolean: [
          { true: "' OR 1=1--", false: "' OR 1=2--", label: "or_comment" },
          { true: ") OR 1=1--", false: ") OR 1=2--", label: "paren" },
        ],
      },
    });

    // 2) Login endpoint (JSON-based)
    const loginJson = await scanner.scan({
      target: `${base}/rest/user/login`,
      method: "POST",
      jsonBody: { email: "a@b.c", password: "test" },
      enable: {
        query: false,
        path: false,
        form: false,
        json: true,
        header: false,
        cookie: false,
        error: true,
        boolean: true,
        time: false,
      },
      payloads: {
        error: ["'", '"'],
        boolean: [
          { true: "' OR 1=1--", false: "' OR 1=2--", label: "or_comment" },
        ],
      },
    });

    const totalFindings = [...restSearch.details, ...loginJson.details].filter(
      (d) => d.vulnerable
    );

    // На разных версиях результат может отличаться, но ожидаем хотя бы 1 сигнал
    expect(totalFindings.length).toBeGreaterThan(0);
  }, 90_000);
});
