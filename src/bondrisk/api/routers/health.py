from datetime import UTC, datetime

from fastapi import APIRouter
from sqlalchemy import text

from bondrisk import __version__
from bondrisk.api.schemas import Health
from bondrisk.db.engine import connect

router = APIRouter(tags=["service"])


def _health() -> Health:
    with connect() as conn:
        pg = conn.execute(text("select version()")).scalar_one()
        ts = conn.execute(
            text("select extversion from pg_extension where extname = 'timescaledb'")
        ).scalar()
        try:
            rev = conn.execute(text("select version_num from alembic_version")).scalar()
        except Exception:  # noqa: BLE001 — таблица может быть недоступна роли
            rev = None
    return Health(
        status="ok",
        version=__version__,
        postgres=pg,
        timescaledb=ts or "not installed",
        alembic_revision=rev,
        time=datetime.now(UTC),
    )


@router.get("/health", response_model=Health, summary="Состояние сервиса и БД")
def health() -> Health:
    return _health()
