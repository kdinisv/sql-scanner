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

describe("Juice Shop known SQLi quick check (optional)", () => {
  it("detects SQLi on /rest/products/search?q=", async () => {
    const base = "http://127.0.0.1:3000";
    if (!(await isUp(base))) {
      // eslint-disable-next-line no-console
      console.warn("[skip] Juice Shop is not running on 127.0.0.1:3000");
      return;
    }

    const scanner = new SqlScanner({ requestTimeoutMs: 8000 });
    const result = await scanner.scan({
      target: `${base}/rest/products/search?q=test`,
      method: "GET",
      enable: {
        query: true,
        error: true,
        boolean: true,
        time: false,
        path: false,
        form: false,
        json: false,
        header: false,
        cookie: false,
      },
      payloads: {
        error: ["'", "' OR 1=1--", "' UNION SELECT 1--"],
        boolean: [
          { true: "' OR 1=1--", false: "' OR 1=2--", label: "or_comment" },
        ],
      },
    });

    expect(result.details.some((d) => d.vulnerable)).toBe(true);
  }, 20_000);
});
