import http from "node:http";

export async function startTestProxy(): Promise<{
  server: http.Server;
  baseUrl: string;
  getStats: () => { total: number; absolutePathSeen: number };
}> {
  let total = 0;
  let absolutePathSeen = 0;

  const server = http.createServer((clientReq, clientRes) => {
    try {
      total++;
      const rawPath = clientReq.url || "/";
      let targetUrl: URL | null = null;
      if (/^https?:\/\//i.test(rawPath)) {
        // Absolute-form request line (proxy mode)
        absolutePathSeen++;
        targetUrl = new URL(rawPath);
      } else {
        const host = String(clientReq.headers["host"] || "");
        if (host) {
          targetUrl = new URL(`http://${host}${rawPath}`);
        }
      }
      if (!targetUrl) {
        clientRes.writeHead(400, { "content-type": "text/plain" });
        clientRes.end("bad proxy request");
        return;
      }

      // Forward to target
      const headers = { ...clientReq.headers } as Record<string, string>;
      delete (headers as any)["proxy-connection"];
      const opt: http.RequestOptions = {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
        method: clientReq.method,
        path: targetUrl.pathname + targetUrl.search,
        headers,
      };
      const upstream = http.request(opt, (upRes) => {
        const resHeaders = { ...upRes.headers, "x-proxy-used": "1" } as any;
        clientRes.writeHead(upRes.statusCode || 502, resHeaders);
        upRes.pipe(clientRes);
      });
      upstream.on("error", (e) => {
        clientRes.writeHead(502, { "content-type": "text/plain" });
        clientRes.end(String(e));
      });
      clientReq.pipe(upstream);
    } catch (e) {
      clientRes.writeHead(500, { "content-type": "text/plain" });
      clientRes.end(String(e));
    }
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (typeof addr === "object" && addr && "port" in addr) {
    return {
      server,
      baseUrl: `http://127.0.0.1:${addr.port}`,
      getStats: () => ({ total, absolutePathSeen }),
    };
  }
  throw new Error("failed to bind proxy server");
}
