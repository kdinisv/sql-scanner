# 🚀 Дорожная карта: SQL Injection Scanner

## Этап 1. Архитектура и MVP (2–3 недели)
- [ ] Выбор стека (Node.js TS или Python).
- [ ] CLI (scan, report, help), .env-конфиги.
- [ ] HTTP-драйвер (timeout/retry/proxy, cookie/JWT).
- [ ] Базовый Boolean-based детектор.
- [ ] JSON + Markdown отчёт.

## Этап 2. Расширение техник и СУБД (4–6 недель)
- [ ] Time-based + статистическая проверка.
- [ ] Error-based (сигнатуры ошибок).
- [ ] Union-based (подбор колонок/типов).
- [ ] Фингерпринтинг СУБД.
- [ ] Поддержка MySQL, PostgreSQL, MSSQL, Oracle, SQLite.

## Этап 3. Кроулинг и спецификации (3–4 недели)
- [ ] HTML/JSON кроулер.
- [ ] OpenAPI, GraphQL introspection, Postman/HAR.
- [ ] Типизация параметров.
- [ ] Контекстные payload.

## Этап 4. Подтверждение и снижение FP (2–3 недели)
- [ ] Time-based p-value.
- [ ] Хэши/длина/маркеры.
- [ ] Confidence-скоринг.
- [ ] Дедупликация находок.

## Этап 5. Отчёты и CI/CD (3–4 недели)
- [ ] SARIF, Markdown/PDF.
- [ ] CSV, JUnit.
- [ ] Exit codes (0/1/2).
- [ ] Интеграции с Jira, GitHub, Slack/Telegram.
- [ ] Baseline suppression.

## Этап 6. Безопасность и производительность (2–3 недели)
- [ ] Safe-mode, запрет DML/DDL/stacked.
- [ ] Rate-limit, jitter, параллелизм.
- [ ] Логи JSONL, метрики.
- [ ] Docker-образ.

## Этап 7. Расширения и R&D
- [ ] OOB-детект (DNS/HTTP).
- [ ] Автогенерация UNION-цепочек.
- [ ] Обфускация payload под WAF.
- [ ] Web-GUI.

---

### Сроки
- **MVP:** 2–3 недели.
- **Базовая версия (Этапы 1–5):** ~3 месяца.
- **Продвинутая (Этапы 6–7):** +1–2 месяца.
