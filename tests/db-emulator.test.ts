import { describe, it, expect, afterAll } from "vitest";
import { SqlScanner } from "../src/index.js";
import { startDbEmulator, type DbKind } from "./servers/dbEmulators.js";

const kinds: DbKind[] = ["mysql", "postgres", "mssql", "oracle", "sqlite"];

describe("DB emulator SQLi detection", () => {
  const servers: Array<{
    kind: DbKind;
    baseUrl: string;
    close: () => Promise<void>;
  }> = [];

  afterAll(async () => {
    for (const s of servers) await s.close();
  });

  for (const kind of kinds) {
    it(`detects error/boolean/time on ${kind} emulator`, async () => {
      const { server, baseUrl } = await startDbEmulator(kind);
      servers.push({
        kind,
        baseUrl,
        close: () => new Promise((r) => server.close(() => r())),
      });

      const scanner = new SqlScanner({
        requestTimeoutMs: 9000,
        timeThresholdMs: 2500,
      });

      // query param target
      const target = `${baseUrl}/search?q=test`;
      const result = await scanner.scan({
        target,
        method: "GET",
        enable: { query: true, error: true, boolean: true, time: true },
      });

      const details = result.details;
      const hasErr = details.some(
        (d) => d.technique === "error" && d.vulnerable
      );
      const hasBool = details.some(
        (d) => d.technique === "boolean_truefalse" && d.vulnerable
      );
      const hasTime = details.some(
        (d) => d.technique === "time" && d.vulnerable
      );

      expect(hasErr || hasBool || hasTime).toBe(true);
    }, 20000);
  }
});
