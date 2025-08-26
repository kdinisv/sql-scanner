# @kdinisv/sql-scanner

Лёгкий SDK для поиска SQL-инъекций в Node.js. Умеет точечно сканировать URL и выполнять «умное» сканирование с краулингом. Работает в ESM и CommonJS, типы включены.

— Node.js >= 18.17
— Типы: TypeScript
— Опционально: Playwright для JS-страниц

## Установка

```bash
npm i @kdinisv/sql-scanner
# (опционально) для SPA-страниц
npm i -D playwright
```

## Быстрый старт (ESM)

```ts
import { SqlScanner } from "@kdinisv/sql-scanner";

const scanner = new SqlScanner();

const result = await scanner.scan({
  target: "https://example.com/search?q=test",
  method: "GET",
  enable: { query: true, error: true, boolean: true, time: false },
});

console.log(result.vulnerable, result.details);
```

## Быстрый старт (CommonJS)

```js
const { SqlScanner } = require("@kdinisv/sql-scanner");

(async () => {
  const scanner = new SqlScanner();
  const result = await scanner.scan({ target: "https://example.com?id=1" });
  console.log(result);
})();
```

## «Умное» сканирование (краулер)

```ts
const smart = await scanner.smartScan({
  baseUrl: "https://example.com",
  maxDepth: 2,
  maxPages: 50,
  usePlaywright: true,
});
console.log(smart.crawledPages, smart.candidates.length, smart.sqli.length);
```

## Краткое API

- new SqlScanner(options?)

  - requestTimeoutMs?: number (по умолчанию 10000)
  - timeThresholdMs?: number для time-based (по умолчанию 2500)
  - headers?: Record<string,string>, cookies?: Record<string,string>

- scan(input)

  - target: string, method?: "GET"|"POST"
  - jsonBody?: Record<string,unknown>
  - enable?: { query|path|form|json|header|cookie|error|boolean|time?: boolean }
  - Возвращает: { vulnerable: boolean; details: Detail[] }

- smartScan(options)
  - baseUrl: string, maxDepth?: number, maxPages?: number
  - sameOriginOnly?: boolean, usePlaywright?: boolean
  - Возвращает: { crawledPages: number; candidates: DiscoveredTarget[]; sqli: ResultShape[] }

## CLI (опционально)

Запуск без установки:

```bash
npx --package @kdinisv/sql-scanner sql-scan https://example.com
```

Глобально:

```bash
npm i -g @kdinisv/sql-scanner
sql-scan https://example.com
```

## Важно

Используйте сканер только на ресурсах, для которых у вас есть разрешение.
