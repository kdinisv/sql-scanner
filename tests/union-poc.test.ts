import { describe, it, expect } from "vitest";
import { startDbEmulator } from "./servers/dbEmulators.js";
import { runScan } from "../src/core/runScan.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Union-based PoC", () => {
  it("detects orderby signal and union diff on mysql emulator", async () => {
    const { server, baseUrl } = await startDbEmulator("mysql");
    try {
      const url = `${baseUrl}/search?q=1`;
      const res = await runScan({
        target: url,
        enable: {
          query: true,
          error: false,
          boolean: false,
          time: false,
          union: true,
        },
        requestTimeoutMs: 8000,
        parallel: 1,
      });
      const unionDetails = res.details.filter((d) => d.technique === "union");
      // Expect at least two entries: orderBy signal and a union diff
      expect(unionDetails.length).toBeGreaterThanOrEqual(2);
      const orderSignal = unionDetails.find((d) =>
        d.evidence?.includes("orderby-sim")
      );
      const unionDiff = unionDetails.find((d) =>
        d.evidence?.includes("sim(base,union)")
      );
      expect(orderSignal?.vulnerable).toBe(true);
      expect(unionDiff?.vulnerable).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30000);
});
