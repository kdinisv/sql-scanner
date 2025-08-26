import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { SqlScanner } from "../src/index.js";

let server: http.Server;
let baseUrl = "";

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    // Простая страница результатов поиска, зависящая от q
    if (url.pathname === "/search") {
      const q = url.searchParams.get("q") || "";

      // time-based: если payload содержит SLEEP/pg_sleep/WAITFOR, делаем задержку
      if (/SLEEP\(3\)|pg_sleep\(3\)|WAITFOR DELAY/i.test(q)) {
        await new Promise((r) => setTimeout(r, 3100));
      }

      // error-based: если есть одиночная кавычка — вернём типичную сигнатуру ошибки
      if (q.includes("'")) {
        const body = `<!doctype html><html><head><title>Search</title></head><body>
<h1>Error</h1>
<pre>SQL syntax error near '...'; MySQL error: You have an error in your SQL syntax</pre>
</body></html>`;
        res.writeHead(200, { "content-type": "text/html" });
        res.end(body);
        return;
      }

      // boolean-based: различные ответы для true/false паттернов
      if (q.includes("1 AND 1=1")) {
        const body = `<!doctype html><html><head><title>OK</title></head><body>
<div id="result">valid</div>
</body></html>`;
        res.writeHead(200, { "content-type": "text/html" });
        res.end(body);
        return;
      }
      if (q.includes("1 AND 1=2")) {
        const body = `<!doctype html><html><head><title>OK</title></head><body>
<div id="result">no results</div>
</body></html>`;
        res.writeHead(200, { "content-type": "text/html" });
        res.end(body);
        return;
      }

      // Базовый ответ без уязвимостей
      const body = `<!doctype html><html><head><title>Search</title></head><body>
<p>query=${q}</p>
</body></html>`;
      res.writeHead(200, { "content-type": "text/html" });
      res.end(body);
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (typeof addr === "object" && addr && "port" in addr) {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  } else {
    throw new Error("Failed to get server address");
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("SqlScanner integration", () => {
  it("detects at least one vulnerability on controlled server", async () => {
    const scanner = new SqlScanner({
      requestTimeoutMs: 8000,
      timeThresholdMs: 2500,
    });
    const result = await scanner.scan({
      target: `${baseUrl}/search?q=test`,
      method: "GET",
      enable: { query: true, error: true, boolean: true, time: true },
    });
    // Должны найти хотя бы одну уязвимость (error- или boolean- или time-based)
    const vulnerable = result.details.filter((d) => d.vulnerable);
    expect(vulnerable.length).toBeGreaterThan(0);
  }, 20000);
});
