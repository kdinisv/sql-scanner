import { describe, it, expect } from "vitest";
import { SqlScanner } from "../src/index.js";
import { startTestSite } from "./servers/testSite.js";

describe("pre-scan authentication", () => {
  it("logs in via form-urlencoded and scans with cookies", async () => {
    const { server, baseUrl } = await startTestSite();
    try {
      const scanner = new SqlScanner({ requestTimeoutMs: 8000 });
      const res = await scanner.scan({
        target: `${baseUrl}/search?q=1`,
        method: "GET",
        auth: {
          url: `${baseUrl}/auth/login-form`,
          method: "POST",
          type: "form-urlencoded",
          usernameField: "username",
          passwordField: "password",
          username: "admin",
          password: "secret",
          verifyUrl: `${baseUrl}/account`,
          success: { notContainsText: "Sign in" },
        },
        enable: { query: true, error: true, boolean: true, time: false },
      });
      expect(Array.isArray(res.details)).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 15000);

  it("logs in via JSON and scans with cookies", async () => {
    const { server, baseUrl } = await startTestSite();
    try {
      const scanner = new SqlScanner({ requestTimeoutMs: 8000 });
      const res = await scanner.scan({
        target: `${baseUrl}/search?q=1`,
        method: "GET",
        auth: {
          url: `${baseUrl}/auth/login-json`,
          method: "POST",
          type: "json",
          usernameField: "email",
          passwordField: "password",
          username: "admin@site.local",
          password: "secret",
          verifyUrl: `${baseUrl}/account`,
          success: { notContainsText: "Sign in" },
        },
        enable: { query: true, error: true, boolean: true, time: false },
      });
      expect(Array.isArray(res.details)).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 15000);
});
