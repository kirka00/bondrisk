# bondrisk — система управления портфелями облигаций и аналитики процентных и кредитных рисков

Курсовой проект по дисциплине «Базы данных» (МАИ, 2026). PostgreSQL 18 + TimescaleDB, Python 3.14, FastAPI.
План и обоснование решений — `../План курсового проекта.md`.

## Запуск

```bash
cp .env.example .env            # один раз
docker compose up -d db adminer # PostgreSQL 18 + TimescaleDB 2.31, Adminer на http://127.0.0.1:8080
uv sync                         # локальное окружение (Python 3.14 подтянет uv)
uv run bondrisk check           # связь с БД и MOEX ISS
uv run uvicorn bondrisk.api.main:app --reload   # http://127.0.0.1:8000/docs
```

## Структура

```
db/init/        SQL, выполняемый при создании пустой базы (расширения, схемы, роли)
db/schema/      DDL по схемам: ref, ops, ts, risk, audit
db/functions/   PL/pgSQL: НКД, потоки, YTM, дюрация, DV01, КБД
db/triggers/    триггеры позиции/кассы, аудит, проверки
db/seed/        демо-данные
db/migrations/  Alembic + ручные SQL-миграции (в т. ч. таблица → hypertable)
src/bondrisk/   api/ (FastAPI), loader/ (MOEX ISS, ЦБ, рейтинги), db/, settings.py
tests/          sql/ api/ concurrency/ perf/
data/raw/       кэш сырых ответов MOEX/ЦБ/агентств (не в git)
notebooks/      графики для пояснительной записки
```
