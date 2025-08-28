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
  return /['"\\)]/.test(s);
}

function isBooleanTrue(s: string): boolean {
  return /(1\s*AND\s*1=1)|('\s*OR\s*1=1(--|\s|$))/.test(s);
}

function isBooleanFalse(s: string): boolean {
  return /(1\s*AND\s*1=2)|('\s*OR\s*1=2(--|\s|$))/.test(s);
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
