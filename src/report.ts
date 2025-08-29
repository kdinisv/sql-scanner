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
      if (d.reproduce?.curl?.length) {
        lines.push("- reproduce:");
        d.reproduce.curl.forEach((c) => lines.push(`  - curl: ${c}`));
      }
      if (d.remediation?.length) {
        lines.push("- remediation:");
        d.remediation.forEach((r) => lines.push(`  - ${r}`));
      }
      lines.push("");
    });
  }
  return lines.join("\n");
}

export function toCsvReport(result: ResultShape): string {
  const rows: string[] = [];
  rows.push(
    [
      "technique",
      "point_kind",
      "point_name",
      "vulnerable",
      "status",
      "elapsedMs",
      "len",
      "confirmations",
      "reproduce_curl",
      "remediation",
    ].join(",")
  );
  for (const d of result.details) {
    const values = [
      d.technique,
      d.point.kind,
      d.point.name,
      String(d.vulnerable),
      String(d.responseMeta?.status ?? ""),
      String(d.responseMeta?.elapsedMs ?? ""),
      String(d.responseMeta?.len ?? ""),
      (d.confirmations || []).join("; "),
      (d.reproduce?.curl || []).join(" | "),
      (d.remediation || []).join(" | "),
    ];
    rows.push(values.map(csvEscape).join(","));
  }
  return rows.join("\n");
}

export function toJUnitReport(result: ResultShape): string {
  const vulns = result.details.filter((d) => d.vulnerable);
  const tests = Math.max(1, result.details.length || 1);
  const failures = vulns.length;
  const timeSec = (
    result.details.reduce((a, d) => a + (d.responseMeta?.elapsedMs || 0), 0) /
    1000
  ).toFixed(3);
  let xml = "";
  xml += `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuite name="sql-scanner" tests="${tests}" failures="${failures}" time="${timeSec}">\n`;
  if (result.details.length === 0) {
    xml += `  <testcase classname="scan" name="no_targets"/>\n`;
  } else {
    for (const d of result.details) {
      const name = `${d.technique} ${d.point.kind}:${d.point.name}`;
      const cls = `scan.${d.point.kind}`;
      const t = (d.responseMeta?.elapsedMs || 0) / 1000;
      xml += `  <testcase classname="${escapeXml(cls)}" name="${escapeXml(
        name
      )}" time="${t.toFixed(3)}">`;
      if (d.vulnerable) {
        const msg = d.confirmations?.join(", ") || "vulnerability";
        const evid = d.evidence || "";
        const repro = (d.reproduce?.curl || []).join("\n");
        const remediation = (d.remediation || []).join("\n");
        const body = [
          evid,
          repro ? `curl:\n${repro}` : "",
          remediation ? `fix:\n${remediation}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        xml += `\n    <failure message="${escapeXml(msg)}">${escapeXml(
          body
        )}</failure>\n  `;
      }
      xml += `</testcase>\n`;
    }
  }
  xml += `</testsuite>`;
  return xml;
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function csvEscape(v: string): string {
  const need =
    v.includes(",") || v.includes("\n") || v.includes("\r") || v.includes('"');
  if (!need) return v;
  return '"' + v.replaceAll('"', '""') + '"';
}
