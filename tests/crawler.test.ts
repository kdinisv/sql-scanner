import { describe, it, expect } from "vitest";
import { SqlScanner } from "../src/index.js";
import { startTestSite } from "./servers/testSite.js";

async function hasPlaywright(): Promise<boolean> {
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}

describe("smartScan crawler (with and without JS)", () => {
  it("discovers links/forms without JS and scans candidates", async () => {
    const { server, baseUrl } = await startTestSite();
    try {
      const scanner = new SqlScanner({ requestTimeoutMs: 8000 });
      const res = await scanner.smartScan({
        baseUrl,
        maxDepth: 1,
        maxPages: 10,
        sameOriginOnly: true,
        usePlaywright: false,
        techniques: { error: true, boolean: true, time: false },
      });

      expect(res.crawledPages).toBeGreaterThan(0);
      expect(res.candidates.length).toBeGreaterThan(0);
      expect(Array.isArray(res.sqli)).toBe(true);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 20000);

  it("captures JS network (if Playwright installed) and scans JSON endpoints", async () => {
    if (!process.env.RUN_PLAYWRIGHT) {
      // eslint-disable-next-line no-console
      console.warn("[skip] Set RUN_PLAYWRIGHT=1 to run Playwright test");
      return;
    }
    if (!(await hasPlaywright())) {
      // eslint-disable-next-line no-console
      console.warn("[skip] Playwright not installed");
      return;
    }
    const { server, baseUrl } = await startTestSite();
    try {
      const scanner = new SqlScanner({ requestTimeoutMs: 10000 });
      const res = await scanner.smartScan({
        baseUrl,
        maxDepth: 1,
        maxPages: 10,
        sameOriginOnly: true,
        usePlaywright: true,
        playwrightMaxPages: 2,
        techniques: { error: true, boolean: true, time: false },
      });

      const hasJsonEndpoint = res.candidates.some(
        (c) => c.kind === "json-endpoint"
      );
      expect(hasJsonEndpoint).toBe(true);
      expect(res.sqli.length).toBeGreaterThanOrEqual(0);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 30000);
});
