# Техническое задание: SQL Injection Scanner

## 1) Цели и охват
- Цель: автоматическое выявление SQL-инъекций и смежных дефектов авторизации/фильтрации в веб/API-приложениях.
- Поддерживаемые СУБД: MySQL/MariaDB, PostgreSQL, Microsoft SQL Server, Oracle, SQLite.
- Каналы инъекций: query-параметры, form-body (www-form, JSON), заголовки, cookies, GraphQL, URL-path, WebSocket payloads, gRPC-gateway.

## 2) Функциональные требования
- Аутентификация: неаутентифицированный, cookie/JWT, OAuth2, Basic.
- Импорт: OpenAPI/Swagger, GraphQL introspection, Postman/HAR.
- Кроулер форм и API.
- Генерация payload под СУБД и контекст (строка, число, ORDER BY, LIMIT, UNION).
- Стратегии: Boolean-based, Error-based, Time-based, Union-based, Stacked (unsafe), OOB (выкл. по умолчанию).
- Байпас: кодирование, комментарии, обфускация.

## 3) Детектирование
- Подтверждение уязвимости двумя методами.
- Метрики: статус/длина/хэш ответа, время (p-value), ошибки СУБД, побочные эффекты.
- Фингерпринтинг СУБД.

## 4) Безопасность
- Safe-by-default: запрет DML/DDL/stacked.
- Rate limit, jitter, do-not-touch списки.
- Dry-run и smoke-scan.

## 5) Отчётность
- JSON, SARIF 2.1.0, Markdown/PDF, CSV, JUnit.
- PoC трассировки, curl.

## 6) Минимальные тесты
- Boolean-based (AND 1=1/AND 1=2).
- Error-based (деление на 0, каст).
- Time-based (SLEEP, pg_sleep, WAITFOR, DBMS_LOCK.SLEEP).
- Union-based (подбор колонок).
- ORDER BY/LIMIT инъекции.
- Stacked (только unsafe).

## 7) Выходные форматы
- JSON, SARIF, Markdown, CSV, JUnit.

## 8) Интеграция
- CI/CD: exit codes 0/1/2, baseline.json.
- Интеграции: Jira, GitHub Issues, Slack/Telegram.

## 9) Логи/телеметрия
- JSONL-логи, RPS/p95 latency.
- Версия движка, профили.
