import { describe, it, expect, afterAll } from "vitest";
import { SqlScanner } from "../src/index.js";
import { startTestSite } from "./servers/testSite.js";

describe("time-based p-value detection", () => {
  const servers: Array<() => Promise<void>> = [];

  afterAll(async () => {
    for (const close of servers) await close();
  });

  it("confirms time-based via p-value on slow endpoint", async () => {
    const { server, baseUrl } = await startTestSite();
    servers.push(() => new Promise((r) => server.close(() => r())));

    const scanner = new SqlScanner({
      requestTimeoutMs: 12000,
      timeThresholdMs: 2500,
    });

    // We will scan the query param endpoint and use a time payload that the site interprets as sleep
    const target = `${baseUrl}/search?q=`;
    const res = await scanner.scan({
      target,
      method: "GET",
      enable: { query: true, error: false, boolean: false, time: true },
      payloads: { time: [{ p: "SLEEP(3)", label: "sleep3" }] },
    });

    const timeFindings = res.details.filter((d) => d.technique === "time");
    expect(timeFindings.length).toBeGreaterThan(0);
    const hasVuln = timeFindings.some((d) => d.vulnerable);
    expect(hasVuln).toBe(true);
  }, 45000);
});
