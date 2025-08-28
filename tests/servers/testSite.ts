import http from "node:http";

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req
      .on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
      .on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function hasErrorPayload(s: string): boolean {
  return /['"\\)]/.test(s);
}

function hasTimePayload(s: string): boolean {
  return /SLEEP\(3\)|pg_sleep\(3\)|WAITFOR\s+DELAY|DBMS_LOCK\.SLEEP\(3\)/i.test(
    s
  );
}

function isBooleanTrue(s: string): boolean {
  return /(1\s*AND\s*1=1)|('\s*OR\s*1=1(--|\s|$))/.test(s);
}

function isBooleanFalse(s: string): boolean {
  return /(1\s*AND\s*1=2)|('\s*OR\s*1=2(--|\s|$))/.test(s);
}

async function respondLogic(res: http.ServerResponse, input: string) {
  if (hasTimePayload(input)) {
    await sleep(3100);
  }
  if (hasErrorPayload(input)) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      "<!doctype html><html><head><title>Error</title></head><body><pre>You have an error in your SQL syntax</pre></body></html>"
    );
    return true;
  }
  if (isBooleanTrue(input)) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      "<!doctype html><html><head><title>OK</title></head><body><div>valid</div></body></html>"
    );
    return true;
  }
  if (isBooleanFalse(input)) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      "<!doctype html><html><head><title>OK</title></head><body><div>no results</div></body></html>"
    );
    return true;
  }
  return false;
}

export async function startTestSite(): Promise<{
  server: http.Server;
  baseUrl: string;
}> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    // Parse cookies
    const cookies: Record<string, string> = {};
    const cookieHeader = String(req.headers["cookie"] || "");
    if (cookieHeader) {
      cookieHeader.split(";").forEach((p) => {
        const [k, v] = p.split("=");
        if (k && v !== undefined) cookies[k.trim()] = v.trim();
      });
    }
    if (url.pathname === "/") {
      // HTML с ссылкой, формой и JS, делающим fetch (GET и POST)
      const html = `<!doctype html>
      <html><head><title>Home</title></head>
      <body>
        <a id="lnk" href="/search?q=">search</a>
        <form id="f" action="/submit" method="POST">
          <input type="text" name="q" value="" />
          <button type="submit">Go</button>
        </form>
        <script>
          (function(){
            fetch('/api/data?foo=').catch(()=>{});
            try{
              fetch('/api/post', {
                method:'POST',
                headers:{'content-type':'application/json'},
                body: JSON.stringify({ q: '' })
              }).catch(()=>{});
            }catch(e){}
          })();
        </script>
      </body></html>`;
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
      return;
    }

    if (url.pathname === "/account") {
      const loggedIn = cookies["auth"] === "1";
      const body = loggedIn
        ? "<!doctype html><html><body><h1>Account</h1></body></html>"
        : "<!doctype html><html><body><h1>Sign in</h1></body></html>";
      res.writeHead(200, { "content-type": "text/html" });
      res.end(body);
      return;
    }

    if (url.pathname === "/search") {
      const q = url.searchParams.get("q") || "";
      if (await respondLogic(res, q)) return;
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><body>query=${q}</body></html>`);
      return;
    }

    if (url.pathname === "/submit" && req.method === "POST") {
      const body = await parseBody(req);
      const params = new URLSearchParams(body);
      const q = params.get("q") || "";
      if (await respondLogic(res, q)) return;
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><body>form=${q}</body></html>`);
      return;
    }

    if (url.pathname === "/api/data") {
      const foo = url.searchParams.get("foo") || "";
      if (await respondLogic(res, foo)) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, foo }));
      return;
    }

    if (url.pathname === "/api/post" && req.method === "POST") {
      const raw = await parseBody(req);
      let q = "";
      try {
        q = JSON.parse(raw)?.q || "";
      } catch {}
      if (await respondLogic(res, q)) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, q }));
      return;
    }

    if (url.pathname === "/slow") {
      await sleep(3100);
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>slow</body></html>");
      return;
    }

    // Auth endpoints
    if (url.pathname === "/auth/login-form" && req.method === "POST") {
      const body = await parseBody(req);
      const p = new URLSearchParams(body);
      const u = p.get("username");
      const pw = p.get("password");
      const ok = u === "admin" && pw === "secret";
      if (ok) {
        res.setHeader("Set-Cookie", ["auth=1; Path=/"]);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok }));
      return;
    }
    if (url.pathname === "/auth/login-json" && req.method === "POST") {
      const raw = await parseBody(req);
      let u = "",
        pw = "";
      try {
        const j = JSON.parse(raw || "{}");
        u = j?.email || j?.username || "";
        pw = j?.password || "";
      } catch {}
      const ok = (u === "admin@site.local" || u === "admin") && pw === "secret";
      if (ok) {
        res.setHeader("Set-Cookie", ["auth=1; Path=/"]);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok }));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (typeof addr === "object" && addr && "port" in addr) {
    return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
  }
  throw new Error("failed to bind test site");
}
