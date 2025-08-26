import { describe, it, expect } from "vitest";
import http from "node:http";
import { SqlScanner } from "../src/index.js";

async function isUp(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

describe("Juice Shop integration (optional)", () => {
  it("scans a public route and returns a valid result", async () => {
    const base = "http://127.0.0.1:3000";
    if (!(await isUp(base))) {
      // eslint-disable-next-line no-console
      console.warn("[skip] Juice Shop is not running on 127.0.0.1:3000");
      return;
    }

    const scanner = new SqlScanner({ requestTimeoutMs: 8000 });
    const result = await scanner.scan({
      target: `${base}/#/search?q=test`,
      method: "GET",
      enable: {
        query: true,
        path: true,
        error: true,
        boolean: true,
        time: false, // time-based не нужен для быстрого smoke
      },
    });

    expect(result).toBeTruthy();
    expect(Array.isArray(result.details)).toBe(true);
  }, 30000);
});
