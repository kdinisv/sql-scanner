import { describe, it, expect } from "vitest";
import { toCsvReport, toJUnitReport } from "../src/index.js";
import type { ResultShape, Detail } from "../src/index.js";

describe("reporters", () => {
  const sample: ResultShape = {
    vulnerable: true,
    details: [
      {
        point: { kind: "query" as const, name: "q" },
        payload: "'",
        technique: "error" as const,
        vulnerable: true,
        responseMeta: { status: 200, elapsedMs: 100, len: 42 },
        evidence: "err",
        confirmations: ["error_signature", "mysql"],
      },
    ],
  };

  it("csv non-empty", () => {
    const csv = toCsvReport(sample);
    expect(csv.split("\n").length).toBeGreaterThan(1);
  });

  it("junit xml contains testsuite", () => {
    const xml = toJUnitReport(sample);
    expect(xml).toContain("<testsuite");
    expect(xml).toContain("<testcase");
  });
});
