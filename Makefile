.PHONY: up down db logs check test lint api

up:            ## база + adminer + api
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
lint:
	uv run ruff check . && uv run ruff format --check .
