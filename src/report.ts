import type { ResultShape, Detail } from "./types.js";

export function toJsonReport(result: ResultShape): string {
  return JSON.stringify(result, null, 2);
}

export function toMarkdownReport(result: ResultShape): string {
  const lines: string[] = [];
  lines.push(`# SQLi Scan Report`);
  lines.push("");
  lines.push(`Status: ${result.vulnerable ? "VULNERABLE" : "OK"}`);
  lines.push("");
  const vulns = result.details.filter((d) => d.vulnerable);
  if (vulns.length === 0) {
    lines.push("No confirmed findings.");
  } else {
    lines.push(`Findings: ${vulns.length}`);
    lines.push("");
    vulns.forEach((d, i) => {
      lines.push(
        `## ${i + 1}. ${d.technique} @ ${d.point.kind}:${d.point.name}`
      );
      if (d.confirmations?.length)
        lines.push(`- confirmations: ${d.confirmations.join(", ")}`);
      if (d.responseMeta?.status !== undefined)
        lines.push(`- status: ${d.responseMeta.status}`);
      if (d.responseMeta?.elapsedMs !== undefined)
        lines.push(`- elapsedMs: ${d.responseMeta.elapsedMs}`);
      if (d.responseMeta?.len !== undefined)
        lines.push(`- len: ${d.responseMeta.len}`);
      if (d.evidence) lines.push(`- evidence: ${d.evidence}`);
      lines.push("");
    });
  }
  return lines.join("\n");
}
