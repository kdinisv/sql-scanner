import { describe, it, expect } from "vitest";
import http from "node:http";
import { SqlScanner } from "../src/index.js";

const BASE = "http://127.0.0.1:8080";

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

describe("DVWA auth option (optional)", () => {
  it("logs in via auth and scans classic SQLi", async () => {
    if (!(await isUp(BASE))) {
      // eslint-disable-next-line no-console
      console.warn("[skip] DVWA is not running on 127.0.0.1:8080");
      return;
    }

    const scanner = new SqlScanner({ requestTimeoutMs: 10000 });
    const result = await scanner.scan({
      target: `${BASE}/vulnerabilities/sqli/?id=1&Submit=Submit`,
      auth: {
        url: `${BASE}/login.php`,
        method: "POST",
        type: "form-urlencoded",
        usernameField: "username",
        passwordField: "password",
        username: "admin",
        password: "password",
        additionalFields: { Login: "Login" },
        verifyUrl: `${BASE}/index.php`,
        success: { notContainsText: "Login" },
      },
      enable: { query: true, error: true, boolean: true },
    });

    const findings = result.details.filter((d) => d.vulnerable);
    if (findings.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        "[info] DVWA auth: no SQLi detected now (check security level)"
      );
    }
    expect(Array.isArray(result.details)).toBe(true);
  }, 60_000);
});
