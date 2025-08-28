import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { SqlScanner } from "../src/index.js";
import { startTestSite } from "./servers/testSite.js";
import { startTestProxy } from "./servers/testProxy.js";

const OLD_ENV = { ...process.env };

describe("HTTP proxy support", () => {
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterAll(async () => {
    for (const c of cleanups) await c();
  });

  it("routes traffic via HTTP_PROXY and still detects", async () => {
    const { server: site, baseUrl } = await startTestSite();
    cleanups.push(() => new Promise((r) => site.close(() => r())));
    const {
      server: proxy,
      baseUrl: proxyUrl,
      getStats,
    } = await startTestProxy();
    cleanups.push(() => new Promise((r) => proxy.close(() => r())));

    process.env.HTTP_PROXY = proxyUrl;
    delete process.env.NO_PROXY; // ensure not bypassed

    const scanner = new SqlScanner({ requestTimeoutMs: 8000 });
    const res = await scanner.scan({
      target: `${baseUrl}/search?q=`,
      method: "GET",
      enable: { query: true, error: true, boolean: false, time: false },
    });

    const used = getStats();
    expect(used.total).toBeGreaterThan(0);
    expect(used.absolutePathSeen).toBeGreaterThan(0);
    // базовая проверка, что сканер работал (даже если не уязвимо)
    expect(res.details.length).toBeGreaterThan(0);
  }, 20000);
});
