# @kdinisv/sql-scanner

Лёгкий SDK для поиска SQL-инъекций в Node.js. Умеет точечно сканировать URL и выполнять «умное» сканирование с краулингом. Работает в ESM и CommonJS, типы включены. Поддерживает отчёты JSON/Markdown/CSV/JUnit и приоритизирует payload’ы (в т.ч. time/union PoC) по отпечатку СУБД.

— Node.js >= 18.17
— Типы: TypeScript
– Опционально: Playwright для JS-страниц (захват сетевых запросов SPA)

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
  - enable?: { query|path|form|json|header|cookie|error|boolean|time|union?: boolean }
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
  - confirmations?: string[] — ярлыки подтверждений (например, "error_signature", а при error-based может добавляться отпечаток СУБД: "mysql"|"postgres"|"mssql"|"oracle"|"sqlite")
  - reproduce?: { curl: string[]; note?: string } — готовые примеры для воспроизведения (curl)
  - remediation?: string[] — краткие рекомендации по исправлению

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
      "confirmations": ["error_signature"],
      "reproduce": {
        "curl": ["curl \"https://example.com/search?q=' OR '1'='1\""]
      },
      "remediation": [
        "Используйте параметризованные запросы/Prepared Statements",
        "Не конкатенируйте пользовательский ввод в SQL"
      ]
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

– Предварительная авторизация (форма/JSON)

```ts
await scanner.scan({
  target: "https://site.local/products?id=1",
  method: "GET",
  auth: {
    url: "https://site.local/api/login",
    method: "POST",
    type: "form-urlencoded", // или "json"
    usernameField: "username",
    passwordField: "password",
    username: "admin",
    password: "secret",
    additionalFields: { remember: "1" },
    verifyUrl: "https://site.local/",
    success: { notContainsText: "Sign in" },
  },
  enable: { query: true, error: true, boolean: true },
});
```

Аналогично в smartScan:

```ts
await scanner.smartScan({
  baseUrl: "https://site.local",
  auth: {
    url: "https://site.local/api/login",
    method: "POST",
    type: "json",
    usernameField: "email",
    passwordField: "password",
    username: "admin@site.local",
    password: "secret",
    verifyUrl: "https://site.local/",
    success: { notContainsText: "Sign in" },
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

# отключить захват JS/SPA (без Playwright)
sql-scan https://example.com --no-js

# сохранить отчёт (Markdown/JSON/CSV/JUnit)
sql-scan https://example.com --report md --out report.md
sql-scan https://example.com --report json --out report.json
sql-scan https://example.com --report csv --out report.csv
sql-scan https://example.com --report junit --out report.xml
```

CLI показывает индикатор прогресса и оценку ETA в процессе.

### .env-конфиг

CLI поддерживает конфигурацию через .env-файл (dotenv). Создайте `.env` в корне проекта (см. `.env.example`). Основные переменные:

- SQL_SCANNER_REQUEST_TIMEOUT_MS, SQL_SCANNER_TIME_THRESHOLD_MS
- SQL_SCANNER_PARALLEL, SQL_SCANNER_MAX_REQUESTS
- SQL_SCANNER_USE_JS, SQL_SCANNER_MAX_DEPTH, SQL_SCANNER_MAX_PAGES, SQL_SCANNER_SAME_ORIGIN_ONLY
- SQL_SCANNER_PLAYWRIGHT_HEADLESS (true|false). В CLI есть флаг `--headed` (делает headless=false)
- SQL_SCANNER_TECHNIQUES=error,boolean,time
- SQL_SCANNER_HEADERS / SQL_SCANNER_HEADERS_JSON (JSON строка)
- SQL_SCANNER_COOKIES / SQL_SCANNER_COOKIES_JSON (JSON строка)
- SQL_SCANNER_AUTH_JSON (JSON строка с параметрами авторизации)

Переменные окружения прокси HTTP_PROXY/HTTPS_PROXY/NO_PROXY также учитываются.

## Тестовые эмуляторы СУБД (для разработки)

В репозитории есть лёгкие локальные HTTP-эмуляторы баз данных, которые имитируют поведение MySQL/PostgreSQL/MSSQL/Oracle/SQLite для техник:

- error-based — возвращают характерные сигнатуры ошибок СУБД;
- boolean-based — различающиеся ответы для «true/false» инъекций;
- time-based — искусственная задержка при SLEEP/pg_sleep/WAITFOR/DBMS_LOCK.SLEEP;
- union-based PoC — различия в ответах для ORDER BY ok/bad и UNION SELECT.

Они используются в автотестах и не требуют внешних контейнеров/стендов:

- Код эмуляторов: `tests/servers/dbEmulators.ts`
- Тест: `tests/db-emulator.test.ts`

Запуск тестов:

```bash
npm test -s
```

## Сеть и прокси

- Поддерживаются переменные окружения прокси:
  - HTTP_PROXY / HTTPS_PROXY — адрес прокси, например: `http://127.0.0.1:3128` или с авторизацией `http://user:pass@proxy.local:8080`.
  - NO_PROXY — список исключений через запятую (если задан системно, будет учтён на стороне среды).
- Для транзиентных ошибок на GET (502/503/504, сетевые таймауты) вшиты короткие ретраи с экспоненциальным backoff.

— Приоритет пейлоадов: если error-based детект дал отпечаток СУБД (MySQL/Postgres/MSSQL/Oracle/SQLite), time-based подбор сначала пробует соответствующие пейлоады (например, pg_sleep/WAITFOR/DBMS_LOCK.SLEEP), что ускоряет и повышает точность.

— Union-based PoC: реализованы безопасные пробы ORDER BY (сравнение ответов на валидный/заведомо «лишний» индекс) и базовые UNION SELECT пейлоады. При наличии отпечатка СУБД выбираются наиболее подходящие варианты.

## Дополнительные примеры

### 1) Сканирование JSON API (POST)

```ts
const result = await scanner.scan({
  target: "https://api.site.local/search",
  method: "POST",
  jsonBody: { q: "test", page: 1 },
  enable: { json: true, error: true, boolean: true, time: false },
});
```

### 2) Сканирование формы

```ts
// target указывает на страницу с формой; сканер сам получит HTML и извлечёт поля
const res = await scanner.scan({
  target: "https://site.local/login",
  enable: { form: true, error: true, boolean: true, time: false, query: false },
});
```

### 3) Заголовки и куки (и инъекции в них)

```ts
const res = await scanner.scan({
  target: "https://site.local/profile?id=1",
  headers: { "X-Trace": "abc" },
  cookies: { session: "token" },
  enable: { header: true, cookie: true, error: true, boolean: true },
});
```

### 4) Time-based проверки

```ts
const res = await scanner.scan({
  target: "https://site.local/search?q=1",
  enable: { query: true, time: true },
  // Поднимите порог, если бэкенд медленный
  timeThresholdMs: 3000,
});
```

— Встроено статистическое подтверждение (p-value) для time-based: несколько парных замеров baseline/injected, расчёт p (односторонний тест). В evidence попадают p, z, средние времена. Для шумных систем можно повысить timeThresholdMs.

### 5) smartScan с/без JS

```ts
// Без JS (быстрее, только HTML)
await scanner.smartScan({
  baseUrl: "https://site.local",
  usePlaywright: false,
});

// С JS (если установлен Playwright): захватывает запросы SPA
await scanner.smartScan({
  baseUrl: "https://site.local",
  usePlaywright: true,
  playwrightMaxPages: 4,
});
```

### 6) Постобработка результатов

```ts
const onlyVuln = result.details.filter((d) => d.vulnerable);
const byTechnique = onlyVuln.reduce(
  (acc, d) => {
    acc[d.technique] = (acc[d.technique] || 0) + 1;
    return acc;
  },
  /** @type {Record<string, number>} */ {}
);
```

— Готовые репорты: JSON/Markdown/CSV/JUnit

```ts
import {
  toJsonReport,
  toMarkdownReport,
  toCsvReport,
  toJUnitReport,
} from "@kdinisv/sql-scanner";

const json = toJsonReport(result);
const md = toMarkdownReport(result);
const csv = toCsvReport(result);
const junitXml = toJUnitReport(result);
// Сохраните в файл или отправьте в CI-артефакты
```

В отчётах теперь присутствуют примеры воспроизведения и советы по исправлению:

- Markdown: внутри каждого найденного пункта добавляется раздел `reproduce` с `curl ...`, а также `remediation` — список рекомендаций.
- CSV: дополнительные колонки `reproduce_curl` и `remediation`.
- JUnit: в `<failure>` попадает тело с блоками `curl:` и `fix:`.

### 7) Управление нагрузкой

```ts
const scanner = new SqlScanner({ parallel: 4, maxRequests: 500 });
const res = await scanner.scan({ target: "https://site.local/?q=1" });
```

### 8) UNION/ORDER BY (PoC)

```ts
// Экспериментальная техника: сначала ORDER BY (ok vs bad), затем UNION
const res = await scanner.scan({
  target: "http://127.0.0.1:3000/search?q=1",
  enable: {
    query: true,
    union: true,
    error: false,
    boolean: false,
    time: false,
  },
});

const unionFindings = res.details.filter((d) => d.technique === "union");
// evidence включает orderby-sim=... и/или sim(base,union)=...
```

Примечание: это PoC с консервативными, безопасными пейлоадами. В бою комбинируйте с error/boolean/time для повышения уверенности.

## Важно

Используйте сканер только на ресурсах, для которых у вас есть разрешение.
