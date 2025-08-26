# @kdinisv/sql-scanner

Минимальный SDK для обнаружения SQL-инъекций в Node.js.
Позволяет сканировать веб-приложения на наличие уязвимостей SQL-инъекций с поддержкой краулинга и JavaScript-рендеринга.

• Поддерживаемая среда выполнения: Node.js >= 18.17 (встроенный fetch/undici)
• Типы: TypeScript готов «из коробки»
• Импорт: ESM и CommonJS

## Установка

```sh
npm i @kdinisv/sql-scanner
# опционально для SPA/JavaScript-приложений
npm i -D playwright
```

## Быстрый старт (ESM)

```ts
import { SqlScanner } from "@kdinisv/sql-scanner";

const scanner = new SqlScanner({
  requestTimeoutMs: 10000,
  timeThresholdMs: 3000,
  parallel: 4,
  maxRequests: 500,
});

// 1) Прямое сканирование URL
const result = await scanner.scan({
  target: "https://example.com/search?q=test",
  method: "GET",
  enable: {
    query: true,
    path: true,
    error: true,
    boolean: true,
    time: true,
  },
});

console.log(
  "vulnerabilities found:",
  result.details.filter((d) => d.vulnerable)
);

// 2) Умное сканирование с краулингом
const smartResult = await scanner.smartScan({
  baseUrl: "https://example.com",
  maxDepth: 2,
  maxPages: 50,
  usePlaywright: true,
  sameOriginOnly: true,
});

console.log("scan results:", {
  crawledPages: smartResult.crawledPages,
  candidatesFound: smartResult.candidates.length,
  vulnerabilities: smartResult.sqli.filter((r) => r.vulnerable).length,
});
```

## Быстрый старт (CommonJS)

```js
const { SqlScanner } = require("@kdinisv/sql-scanner");

(async () => {
  const scanner = new SqlScanner({
    requestTimeoutMs: 10000,
    timeThresholdMs: 3000,
  });

  const result = await scanner.scan({
    target: "https://example.com/api/users",
    method: "POST",
    jsonBody: { search: "test", limit: 10 },
    enable: { json: true, error: true, boolean: true },
  });

  console.log(result);
})();
```

## API

### new SqlScanner(options?)

• requestTimeoutMs?: number — Таймаут HTTP-запросов (по умолчанию 10000)
• timeThresholdMs?: number — Порог для time-based инъекций в мс (по умолчанию 2500)
• parallel?: number — Количество параллельных запросов (по умолчанию 4)
• maxRequests?: number — Максимальное количество запросов на сканирование (по умолчанию 500)
• headers?: Record<string, string> — Дополнительные HTTP-заголовки
• cookies?: Record<string, string> — Куки для всех запросов

### scan(input)

Сканирует указанную цель на SQL-инъекции.

• target: string — URL для сканирования
• method?: "GET" | "POST" — HTTP-метод (по умолчанию "GET")
• jsonBody?: Record<string, unknown> — Тело JSON-запроса
• headers?: Record<string, string> — Дополнительные заголовки
• cookies?: Record<string, string> — Дополнительные куки
• enable: Object — Настройки включения техник сканирования

- query?: boolean — Сканирование параметров URL
- path?: boolean — Сканирование сегментов пути
- form?: boolean — Сканирование форм
- json?: boolean — Сканирование JSON-полей
- header?: boolean — Сканирование заголовков
- cookie?: boolean — Сканирование куки
- error?: boolean — Error-based техники
- boolean?: boolean — Boolean-based техники
- time?: boolean — Time-based техники

Возвращает: `{ vulnerable: boolean; details: Detail[] }` где каждый `Detail` содержит информацию об уязвимости

### smartScan(options)

Выполняет умное сканирование с краулингом сайта.

• baseUrl: string — Базовый URL для сканирования
• maxDepth?: number — Максимальная глубина краулинга (по умолчанию 2)
• maxPages?: number — Максимальное количество страниц (по умолчанию 50)
• sameOriginOnly?: boolean — Ограничиться тем же доменом (по умолчанию true)
• usePlaywright?: boolean — Использовать Playwright для JavaScript (по умолчанию true)
• playwrightMaxPages?: number — Максимум страниц для Playwright (по умолчанию 10)
• headers?: Record<string, string> — Дополнительные заголовки
• cookies?: Record<string, string> — Дополнительные куки

Возвращает: `{ crawledPages: number; candidates: DiscoveredTarget[]; sqli: ResultShape[] }`

## Примеры

• Сканирование только error-based техниками:

```ts
const result = await scanner.scan({
  target: "https://example.com/user?id=1",
  enable: { query: true, error: true, boolean: false, time: false },
});
```

• Глубокое сканирование с формами:

```ts
const result = await scanner.scan({
  target: "https://example.com/login",
  method: "POST",
  enable: { form: true, error: true, boolean: true, time: true },
});
```

• Краулинг с ограничениями:

```ts
const result = await scanner.smartScan({
  baseUrl: "https://example.com",
  maxDepth: 1,
  maxPages: 20,
  usePlaywright: false, // отключить JavaScript
  sameOriginOnly: true,
});
```

## Предупреждения о безопасности

⚠️ **ВНИМАНИЕ**: Используйте этот инструмент только на ресурсах, на которые у вас есть явное разрешение для тестирования безопасности.

• Несанкционированное тестирование на проникновение является незаконным
• Убедитесь, что у вас есть письменное разрешение перед сканированием
• Соблюдайте responsible disclosure при обнаружении уязвимостей
• Не используйте в продакшене без соответствующих мер предосторожности

## Типы уязвимостей

Инструмент обнаруживает следующие типы SQL-инъекций:

• **Error-based** — обнаружение через ошибки СУБД
• **Boolean-based** — обнаружение через логические условия
• **Time-based** — обнаружение через временные задержки

Поддерживаемые точки инъекций:
• URL query параметры
• Сегменты пути URL
• Поля HTML-форм
• JSON-поля в теле запроса
• HTTP-заголовки
• Cookie-значения

## Разработка

• Сборка: `npm run build`
• Тестирование: `npm test`
• Перед публикацией выполняется сборка автоматически (`prepublishOnly`)

## Лицензия

MIT
