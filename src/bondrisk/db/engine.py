from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Connection, Engine, create_engine, text

from bondrisk.settings import get_settings

_engines: dict[str, Engine] = {}


def get_engine(admin: bool = False) -> Engine:
    """Движок приложения (роль app_rw) или административный (DDL, миграции, тесты)."""
    key = "admin" if admin else "app"
    if key not in _engines:
        s = get_settings()
        url = s.admin_database_url if admin else s.database_url
        _engines[key] = create_engine(str(url), pool_pre_ping=True)
    return _engines[key]


@contextmanager
def connect(admin: bool = False) -> Iterator[Connection]:
    with get_engine(admin).begin() as conn:
        yield conn


def db_version() -> dict[str, str]:
    with connect() as conn:
        pg = conn.execute(text("select version()")).scalar_one()
        ts = conn.execute(
            text("select extversion from pg_extension where extname = 'timescaledb'")
        ).scalar()
    return {"postgres": pg, "timescaledb": ts or "not installed"}
