import { describe, it, expect, afterAll } from "vitest";
import { SqlScanner } from "../src/index.js";
import { startDbEmulator, type DbKind } from "./servers/dbEmulators.js";

describe("contextual payloads prioritize by DB fingerprint", () => {
  const servers: Array<() => Promise<void>> = [];
  afterAll(async () => {
    for (const c of servers) await c();
  });

  const matrix: Array<{ kind: DbKind; expectLabel: string }> = [
    { kind: "mysql", expectLabel: "mysql_sleep" },
    { kind: "postgres", expectLabel: "postgresql_sleep" },
    { kind: "mssql", expectLabel: "mssql_waitfor" },
    { kind: "oracle", expectLabel: "oracle_sleep" },
  ];

  for (const { kind, expectLabel } of matrix) {
    it(`prioritizes ${expectLabel} for ${kind}`, async () => {
      const { server, baseUrl } = await startDbEmulator(kind);
      servers.push(() => new Promise((r) => server.close(() => r())));
      const scanner = new SqlScanner({
        requestTimeoutMs: 9000,
        timeThresholdMs: 2500,
      });
      const target = `${baseUrl}/search?q=`;
      const res = await scanner.scan({
        target,
        method: "GET",
        enable: { query: true, error: true, boolean: false, time: true },
      });
      const picked = res.details.filter(
        (d) => d.technique === "time" && d.vulnerable
      );
      // ensure there is at least one time-based vuln and that our expected label is among confirmations
      expect(picked.length).toBeGreaterThan(0);
      const hasExpected = picked.some((d) =>
        (d.confirmations || []).includes(expectLabel)
      );
      expect(hasExpected).toBe(true);
    }, 30000);
  }
});
