# Развертывание в GitHub

Этот проект готов к публикации в GitHub репозитории `https://github.com/kdinisv/sql-scanner.git`.

## Предварительные шаги

1. Убедитесь, что у вас есть доступ к репозиторию `kdinisv/sql-scanner`
2. Проект уже настроен для этого репозитория в `package.json`

## Команды для развертывания

```bash
# 1. Инициализация git репозитория (если еще не сделано)
git init

# 2. Добавление remote origin
git remote add origin https://github.com/kdinisv/sql-scanner.git

# 3. Добавление файлов в git
git add .

# 4. Первый коммит
git commit -m "Initial commit: SQL Scanner SDK with dual package support"

# 5. Создание основной ветки и push
git branch -M main
git push -u origin main
```

## Публикация в NPM

После загрузки в GitHub:

```bash
# 1. Войти в npm (если еще не сделано)
npm login

# 2. Собрать проект
npm run build

# 3. Опубликовать (автоматически запустится prepublishOnly)
npm publish --access public
```

## Структура проекта в GitHub

После загрузки репозиторий будет содержать:

```
kdinisv/sql-scanner/
├── .gitignore              # Исключения для git
├── README.md               # Документация в стиле SDK
├── package.json            # Настройки пакета с dual exports
├── PROJECT_STRUCTURE.md    # Описание структуры проекта
├── bin/                    # CLI инструмент
├── src/                    # Исходный код TypeScript
├── scripts/                # Скрипты сборки
├── tsconfig*.json          # Конфигурации TypeScript
└── dist/                   # Собранные файлы (игнорируется git)
```

## После публикации

Пользователи смогут установить и использовать ваш пакет:

```bash
# Установка
npm install @kdinisv/sql-scanner

# Использование ESM
import { SqlScanner } from "@kdinisv/sql-scanner";

# Использование CommonJS
const { SqlScanner } = require("@kdinisv/sql-scanner");

# CLI инструмент
npx @kdinisv/sql-scanner https://example.com
```

## GitHub Actions (опционально)

Рекомендуется добавить автоматическую сборку и тестирование через GitHub Actions.

Создайте файл `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm run build
      - run: npm test
```

Проект полностью готов к развертыванию в GitHub репозитории `kdinisv/sql-scanner`!
