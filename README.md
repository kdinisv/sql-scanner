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
  - payloads?: { error?: string[]; boolean?: { true:string; false:string; label?:string }[]; time?: { p:string; label?:string }[] }
  - onProgress?: (p: ScanProgress) => void
  - Возвращает: { vulnerable: boolean; details: Detail[] }

- smartScan(options)
  - baseUrl: string, maxDepth?: number, maxPages?: number
  - sameOriginOnly?: boolean, usePlaywright?: boolean
  - techniques?: { error?: boolean; boolean?: boolean; time?: boolean }
  - onProgress?: (p: SmartScanProgress) => void
  - Возвращает: { crawledPages: number; candidates: DiscoveredTarget[]; sqli: ResultShape[] }

## Возвращаемые данные

### scan(input) → ResultShape

- vulnerable: boolean — есть ли подтвержденные уязвимости среди проверок
- details: Detail[] — записи по каждому проверенному «поинту/технике»
  - point: { kind: "query"|"path"|"form"|"json"|"header"|"cookie"; name: string; meta?: object }
  - technique: "error" | "boolean_truefalse" | "time"
  - payload: string — инъекция, использованная в проверке
  - vulnerable: boolean — результат конкретной проверки
  - responseMeta?: { status: number; elapsedMs?: number; len?: number; location?: string }
  - evidence?: string — краткая улика (фрагмент ошибки/метрика)
  - confirmations?: string[] — ярлыки подтверждений (например, "error_signature")

Пример:

```json
{
  "vulnerable": true,
  "details": [
    {
      "point": { "kind": "query", "name": "q" },
      "technique": "error",
      "payload": "' OR '1'='1",
      "vulnerable": true,
      "responseMeta": { "status": 200, "len": 12345, "elapsedMs": 120 },
      "evidence": "You have an error in your SQL syntax",
      "confirmations": ["error_signature"]
    }
  ]
}
```

Совет: фильтруйте `details.filter(d => d.vulnerable)` для списка подтвержденных находок.

### smartScan(options) → SmartScanResult

- crawledPages: number — сколько страниц обработано краулером
- candidates: DiscoveredTarget[] — найденные цели для сканирования
  - { kind: "url-with-query"; url: string }
  - { kind: "form"; action: string; method: "GET"|"POST"; enctype?: string; fields: { name: string; value: string }[] }
  - { kind: "json-endpoint"; url: string; method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"; body?: any; headers?: Record<string,string> }
- sqli: ResultShape[] — результаты сканирования для каждой из целей

Пример:

```json
{
  "crawledPages": 12,
  "candidates": [
    { "kind": "url-with-query", "url": "https://site/search?q=" },
    {
      "kind": "form",
      "action": "https://site/login",
      "method": "POST",
      "fields": [{ "name": "email", "value": "" }]
    }
  ],
  "sqli": [
    {
      "vulnerable": false,
      "details": [
        {
          "point": { "kind": "query", "name": "q" },
          "technique": "boolean_truefalse",
          "payload": "...",
          "vulnerable": false
        }
      ]
    }
  ]
}
```

## Тонкая настройка

- Кастомные payload’ы для scan

```ts
await scanner.scan({
  target: "http://127.0.0.1:3000/rest/products/search?q=",
  enable: { query: true, error: true, boolean: true, time: false },
  payloads: {
    error: ["'", "' OR 1=1--", "' UNION SELECT 1--"],
    boolean: [{ true: "' OR 1=1--", false: "' OR 1=2--", label: "or_comment" }],
  },
});
```

- Управление техниками в smartScan

```ts
await scanner.smartScan({
  baseUrl: "https://example.com",
  maxDepth: 2,
  maxPages: 50,
  techniques: { error: true, boolean: true, time: false },
});
```

## Прогресс и ETA

- Прогресс для точечного сканирования

```ts
await scanner.scan({
  target: "https://example.com/search?q=1",
  enable: { query: true, error: true, boolean: true, time: false },
  onProgress: (p) => {
    if (p.phase === "discover") {
      console.log(`points=${p.points}`);
    } else if (p.phase === "scan") {
      console.log(
        `checks ${p.processedChecks}/${p.plannedChecks}, eta=${p.etaMs}ms`
      );
    }
  },
});
```

- Прогресс для умного сканирования (краулинг + скан)

```ts
await scanner.smartScan({
  baseUrl: "https://example.com",
  onProgress: (p) => {
    if (p.phase === "crawl") {
      console.log(`crawled ${p.crawledPages}/${p.maxPages}`);
    } else if (p.phase === "scan") {
      console.log(
        `scanned ${p.scanProcessed}/${p.scanTotal}, eta=${p.etaMs}ms`
      );
    }
  },
});
```

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

CLI показывает индикатор прогресса и оценку ETA в процессе.

## Важно

Используйте сканер только на ресурсах, для которых у вас есть разрешение.
