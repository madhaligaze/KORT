# KORT

Управленческий учёт компании: деньги (счета, журнал операций, отчёты,
платёжный календарь), выписки банков Казахстана, реестр договоров, люди и
права.

Выделен 28.09.2026 из раздела «Финансы» монорепозитория PDF-CONVERTER
механическим переносом: поведение то же, внутренние имена прежние (пакет
`finance`, схема Postgres `finance`, API `/api/v1/finance/*`). Новое — вход
(дым → знак → форма), знак KORT и сцена, которая в светлой теме серая.

## Устройство

| Путь | Что там |
| --- | --- |
| `src/` | фронт, Next.js 16 + Univer (листы) + GSAP (движение) |
| `src/app/api/backend/` | прокси браузер → API (снимает `content-encoding`, см. комментарий в файле) |
| `src/components/finance/` | весь интерфейс учёта |
| `src/components/stage/auth-stage.tsx` | экран входа и его сценарий |
| `src/components/motion/` | слой GSAP: дымовая сцена, проявления, занавес |
| `src/components/univer/` | общий корень листов Univer |
| `backend/` | API, FastAPI + SQLAlchemy + alembic |
| `backend/app/finance/` | учёт, см. `backend/app/finance/README.md` |
| `backend/app/services/` | разбор выписок (Kaspi, Halyk, OCR, выписки юрлиц) |
| `docs/finmap-audit.md` | протокол проверки чужого импортёра — откуда правила «не угадывать» |

## Локальный запуск

API:

```
cd backend
uv sync --extra ocr_local
DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:5432/kort uv run python main.py   # :8080
```

Без `DATABASE_URL` в `development` API после пяти попыток соединиться с
Postgres уходит на SQLite (`backend/data/kort.db`). На SQLite ревизии не
гоняются, схема собирается `create_all`; одновременные запросы первого входа
там иногда упираются в «database is locked» — это свойство SQLite, на проде
Postgres.

Фронт:

```
pnpm install
API_URL=http://127.0.0.1:8080 pnpm dev
```

## Проверка

```
cd backend && uv run pytest              # ≈290 тестов; 3 под Postgres — с TEST_DATABASE_URL
pnpm lint && pnpm build
```

Интерфейс — в браузере, не по сборке (см. CLAUDE.md). Наборы Playwright лежат
вне репозитория, в `C:\Users\user\Documents\pw-finmap\`:

- `kort/intro.cjs` — сценарий входа на 1440 / 800 / 390, светлая сцена,
  плавная смена темы, «меньше движения»;
- `kort/flicker.cjs` — дым не пропадает, пока форма раздвигает сцену;
- `kort/inside.cjs` — шапка со знаком, портрет кабинета в обеих темах;
- `kort/switch.cjs` — тумблер темы на входе (тема системы по умолчанию,
  «капля», плавная смена, выбор переживает перезагрузку) и вход учёткой;
- `kort/mark-compare.cjs` — знак против макета, попиксельно;
- `fin-e2e.mjs` — сквозной прогон учёта (ходит на `/finance`, KORT уводит на `/`).

## Деплой

Как у PDF-CONVERTER: два репозитория, два сервиса Railway.

| Репозиторий | Что в нём | Сервис Railway |
| --- | --- | --- |
| [madhaligaze/KORT](https://github.com/madhaligaze/KORT) | весь проект, вместе с `backend/` | **фронт**: `Dockerfile` в корне, `backend/` в образ не попадает (`.dockerignore`) |
| [madhaligaze/KORT_backend](https://github.com/madhaligaze/KORT_backend) | содержимое `backend/` в корне | **API**: `Dockerfile`, миграции в ENTRYPOINT, проверка `/api/v1/health/live` |

Правка в `backend/` пушится в оба: сначала сюда, потом те же файлы — в
KORT_backend (`git subtree split --prefix=backend` или поштучно, как в
PDF-CONVERTER).

### Переменные

Полный список с пояснениями — `.env.example` и `backend/.env.example`.

**Фронт:** `API_URL` — публичный адрес API (`https://…up.railway.app`, без
слэша в конце). Если оба сервиса в одном проекте Railway —
`https://${{<имя сервиса API>.RAILWAY_PUBLIC_DOMAIN}}`.

**API:**

| Переменная | Значение |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — своя база KORT, не база PDF-CONVERTER |
| `ENVIRONMENT` | `production` |
| `ALLOWED_ORIGINS` | публичный адрес фронта |
| `FINANCE_SERVICE_ACCOUNT_JSON` | JSON сервисного аккаунта Google (в PDF-CONVERTER — `BBC_SERVICE_ACCOUNT_JSON`) |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` / `_KEY` | по желанию, распознавание сканов |

### Данные с прода PDF-CONVERTER

После первого старта API (он создаст пустую схему):

```
SOURCE_DATABASE_URL=<база PDF-CONVERTER> TARGET_DATABASE_URL=<база KORT>   bash backend/scripts/copy_from_pdf_converter.sh
```

Скрипт переносит схему `finance` целиком, ставит ревизию 0023, сверяет счёт
записей и отказывается писать в базу, где уже есть учётки. Подробности —
`backend/app/finance/README.md`, раздел «Данные с прода».
