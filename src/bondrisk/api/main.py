"""REST API bondrisk — FastAPI поверх PostgreSQL + TimescaleDB. Контракт: docs/api-contract.md."""
# ruff: noqa: E501  — длинные SQL-строки

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from bondrisk import __version__
from bondrisk.api.errors import install_error_handlers
from bondrisk.api.routers import (
    audit,
    bonds,
    breaches,
    corrections,
    health,
    issuers,
    limits,
    market,
    portfolios,
    reports,
    trades,
    users,
)

TAGS = [
    {"name": "service", "description": "Состояние сервиса"},
    {
        "name": "users",
        "description": "Пользователи и роли (действующее лицо — заголовок X-User-Id)",
    },
    {"name": "issuers", "description": "Справочник эмитентов"},
    {"name": "bonds", "description": "Выпуски облигаций, графики платежей, котировки, метрики"},
    {"name": "market", "description": "Рыночные данные: кривая КБД, курсы валют"},
    {
        "name": "portfolios",
        "description": "Портфели, позиции, касса, снапшоты риска, EOD, лимиты онлайн",
    },
    {"name": "trades", "description": "Сделки: предварительная оценка и заключение"},
    {"name": "limits", "description": "Лимитная политика"},
    {"name": "breaches", "description": "Нарушения лимитов и их снятие риск-менеджером"},
    {"name": "reports", "description": "Аналитические отчёты (db/queries/q01–q16)"},
    {
        "name": "corrections",
        "description": "Ручные корректировки срезов и кассы, синонимы книги лимитов (риск-менеджер)",
    },
    {"name": "audit", "description": "Журнал изменений"},
]

app = FastAPI(
    title="bondrisk API",
    version=__version__,
    description=(
        "Система управления портфелями облигаций и аналитики процентных и кредитных рисков. "
        "Расчётное ядро — PL/pgSQL в PostgreSQL 18 + TimescaleDB; API — тонкий слой над ним. "
        "Ошибки бизнес-правил возвращаются с HTTP 409 и кодом СУБД (BR001 — недостаточно бумаг, "
        "BR002 — недостаточно денег, BR003 — нарушение жёсткого лимита, BR004 — бумага не торгуется, "
        "BR005 — нет прав, BR006 — нарушение правила справочника)."
    ),
    openapi_tags=TAGS,
    openapi_url="/api/v1/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)
install_error_handlers(app)

api = APIRouter(prefix="/api/v1")
for r in (
    health,
    users,
    issuers,
    bonds,
    market,
    portfolios,
    trades,
    limits,
    breaches,
    reports,
    corrections,
    audit,
):
    api.include_router(r.router)
app.include_router(api)
app.include_router(health.router)  # /health без префикса — для docker healthcheck
