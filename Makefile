.PHONY: up down db logs check test lint api

up:            ## весь стек: база + adminer + api + web
	docker compose up -d --build
db:            ## только база и adminer
	docker compose up -d db adminer
down:          ## остановить и удалить данные
	docker compose down -v
logs:
	docker compose logs -f db
check:         ## связь с БД и MOEX
	uv run bondrisk check
api:           ## API локально с автоперезагрузкой
	uv run uvicorn bondrisk.api.main:app --reload
test:
	uv run pytest -q
SCALE ?= 1
SCALES ?= 1,3,10
perf-data:     ## масштабируемый набор в схеме perf: SCALE копий истории котировок (SCALE=1 → 546 600 строк)
	uv run python -m tests.perf.dataset --scale $(SCALE)
perf-report:   ## EXPLAIN (ANALYZE, BUFFERS) на наборах масштабов SCALES → reports/perf/
	uv run python -m tests.perf.explain_report --scales $(SCALES)
lint:
	uv run ruff check . && uv run ruff format --check .

# ---- данные (загрузчик) ----
migrate:       ## миграции Alembic до head
	uv run bondrisk migrate
load:          ## справочники + временные ряды + рейтинги (MOEX, ЦБ, АКРА/НКР/НРА) — только первоисточники
	uv run bondrisk load all --from 2022-01-01
history:       ## портфели индексов MOEX: исторические составы с 01.11.2024, ребалансировка, ежедневный EOD
	uv run bondrisk load index-history --from 2024-11-01
demo: load history funds  ## полный конвейер реальных данных
update:        ## догрузить данные с последней даты в базе + EOD (то же делает сервис scheduler)
	BONDRISK_RAW_CACHE=false uv run bondrisk update
update-full:   ## то же + справочник выпусков и графики платежей
	BONDRISK_RAW_CACHE=false uv run bondrisk update --reference
eod:           ## EOD по всем портфелям за сегодня
	uv run bondrisk eod --all
funds:         ## реальный портфель БПИФ BOND (ДОХОДЪ) по опубликованному составу
	uv run bondrisk load funds
