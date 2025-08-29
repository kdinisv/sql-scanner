import http from "node:http";

export type DbKind = "mysql" | "postgres" | "mssql" | "oracle" | "sqlite";

function errorSignature(kind: DbKind): string {
  switch (kind) {
    case "mysql":
      return "You have an error in your SQL syntax";
    case "postgres":
      return "PostgreSQL ERROR:";
    case "mssql":
      return "Unclosed quotation mark";
    case "oracle":
      return "quoted string not properly terminated";
    case "sqlite":
      return 'SQLITE_ERROR: near ""';
  }
}

function hasTimePayload(s: string): boolean {
  return /SLEEP\(3\)|pg_sleep\(3\)|WAITFOR\s+DELAY|DBMS_LOCK\.SLEEP\(3\)/i.test(
    s
  );
}

function hasErrorPayload(s: string): boolean {
  // Keep quotes and backslash; do not trigger on ')' to avoid User-Agent parentheses
  return /['"\\]/.test(s);
}

function isBooleanTrue(s: string): boolean {
  return /(1\s*AND\s*1=1)|('\s*OR\s*1=1(--|\s|$))/.test(s);
}

function isBooleanFalse(s: string): boolean {
  return /(1\s*AND\s*1=2)|('\s*OR\s*1=2(--|\s|$))/.test(s);
}

function isOrderByProbeOk(s: string): boolean {
  return /ORDER\s+BY\s+1(\s|$)/i.test(s);
}

function isOrderByProbeBad(s: string): boolean {
  return /ORDER\s+BY\s+999(\s|$)/i.test(s);
}

function isUnionSelect(s: string): boolean {
  return /UNION\s+SELECT/i.test(s);
}

function anyStringValue(obj: any): string[] {
  const out: string[] = [];
  const walk = (v: any) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(obj);
  return out;
}

export async function startDbEmulator(kind: DbKind): Promise<{
  server: http.Server;
  baseUrl: string;
}> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      // Collect body if present
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve) => {
        req
          .on("data", (c) =>
            chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
          )
          .on("end", () => resolve());
      });
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let jsonValues: string[] = [];
      try {
        const j = JSON.parse(rawBody || "null");
        jsonValues = anyStringValue(j);
      } catch {}

      const cookiesStr = String(req.headers["cookie"] || "");
      const headersStr = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join("\n");

      const params = Array.from(url.searchParams.values());
      const haystack = [
        url.pathname,
        ...params,
        rawBody,
        ...jsonValues,
        cookiesStr,
        headersStr,
      ].join("\n");

      // Time-based
      if (hasTimePayload(haystack)) {
        await new Promise((r) => setTimeout(r, 3100));
      }

      // Error-based
      if (hasErrorPayload(haystack)) {
        const body = `<!doctype html><html><head><title>Error</title></head><body>\n<pre>${errorSignature(
          kind
        )}</pre>\n</body></html>`;
        res.writeHead(200, { "content-type": "text/html" });
        res.end(body);
        return;
      }

      // Boolean-based: return distinct content for true/false probes
      if (isBooleanTrue(haystack)) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          "<!doctype html><html><head><title>OK</title></head><body><div>valid</div></body></html>"
        );
        return;
      }
      if (isBooleanFalse(haystack)) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          "<!doctype html><html><head><title>OK</title></head><body><div>no results</div></body></html>"
        );
        return;
      }

      // ORDER BY handling: detect ORDER BY <num> and simulate boundary at 3 columns
      const orderByMatch = haystack.match(/ORDER\s+BY\s+(\d+)/i);
      if (orderByMatch) {
        const idx = parseInt(orderByMatch[1], 10);
        const maxCols = 3;
        res.writeHead(200, { "content-type": "text/html" });
        if (idx <= maxCols) {
          const body = `<!doctype html><html><head><title>OK</title></head><body><div class=\"list\">sorted_${idx}</div></body></html>`;
          res.end(body);
        } else {
          const filler = "x".repeat(200 + Math.min(800, idx));
          const body = `<!doctype html><html><head><title>OK</title></head><body><div class=\"list\">order mismatch ${filler}</div></body></html>`;
          res.end(body);
        }
        return;
      }

      // UNION SELECT handling: count columns; only if matches maxCols produce obvious union rows
      if (isUnionSelect(haystack)) {
        const maxCols = 3;
        // naive count: take substring after UNION SELECT and count commas at top level
        const idx = haystack.toUpperCase().indexOf("UNION SELECT");
        let tail = haystack.substring(idx + "UNION SELECT".length);
        // strip trailing comment/end
        tail = tail.split(/\r?\n|;|\bWHERE\b|\bORDER\b/i)[0] || tail;
        const colCount = tail.split(",").length; // naive but enough for tests
        if (colCount === maxCols) {
          res.writeHead(200, { "content-type": "text/html" });
          const rows = Array.from(
            { length: 10 },
            (_, i) => `<li>union_row_${i}</li>`
          ).join("");
          const body = `<!doctype html><html><head><title>OK</title></head><body><h1>UNION_MARK</h1><ul>${rows}</ul></body></html>`;
          res.end(body);
        } else {
          // wrong columns: behave like baseline
          res.writeHead(200, { "content-type": "text/html" });
          res.end(
            `<!doctype html><html><head><title>Base</title></head><body><p>path=${url.pathname}</p></body></html>`
          );
        }
        return;
      }

      // Baseline deterministic response
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<!doctype html><html><head><title>Base</title></head><body><p>path=${url.pathname}</p></body></html>`
      );
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e));
    }
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  const addr = server.address();
  if (typeof addr === "object" && addr && "port" in addr) {
    return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
  }
  throw new Error("failed to bind emulator server");
}
