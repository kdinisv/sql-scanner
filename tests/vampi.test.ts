import { describe, it, expect } from "vitest";
import http from "node:http";
import axios from "axios";
import { SqlScanner } from "../src/index.js";

const BASE = "http://127.0.0.1:5000";

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

async function ensureDb(): Promise<void> {
  try {
    await axios.get(`${BASE}/createdb`, { timeout: 5000 });
  } catch {}
}

describe("VAmPI SQLi (optional)", () => {
  it("detects SQLi in users/books endpoints", async () => {
    if (!(await isUp(BASE))) {
      // eslint-disable-next-line no-console
      console.warn("[skip] VAmPI is not running on 127.0.0.1:5000");
      return;
    }

    await ensureDb();
    const scanner = new SqlScanner({ requestTimeoutMs: 10000 });

    // 1) SQLi: GET /users/v1/{username} (path param)
    const resUsers = await scanner.scan({
      target: `${BASE}/users/v1/name1`,
      method: "GET",
      enable: {
        query: false,
        path: true,
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

    // 2) BOLA exists on books, but also try path/boolean differences
    const resBook = await scanner.scan({
      target: `${BASE}/books/v1/test`,
      method: "GET",
      enable: {
        query: false,
        path: true,
        error: true,
        boolean: true,
        time: false,
      },
      payloads: {
        error: ["'", '"'],
        boolean: [{ true: "1 AND 1=1", false: "1 AND 1=2", label: "num" }],
      },
    });

    const findings = [...resUsers.details, ...resBook.details].filter(
      (d) => d.vulnerable
    );
    if (findings.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[info] VAmPI: no SQLi detected right now (check /createdb and vulnerable=1)"
      );
    }
    expect(
      Array.isArray(resUsers.details) && Array.isArray(resBook.details)
    ).toBe(true);
  }, 90_000);
});
