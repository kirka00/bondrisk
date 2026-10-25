"""Дымовые тесты: база поднята, TimescaleDB подключён, hypertable создаётся, API отвечает."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from bondrisk.api.main import app
from bondrisk.db.engine import connect


@pytest.fixture(scope="module")
def db():
    try:
        with connect() as conn:
            conn.execute(text("select 1"))
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"БД недоступна: {e}")
    yield


def test_timescaledb_installed(db):
    with connect() as conn:
        v = conn.execute(
            text("select extversion from pg_extension where extname='timescaledb'")
        ).scalar()
    assert v is not None and v.startswith("2.")


def test_app_role_cannot_run_ddl(db):
    """Минимальные привилегии (ТЗ §7): роль приложения не создаёт объекты."""
    with pytest.raises(ProgrammingError, match="permission denied"), connect() as conn:
        conn.execute(text("create table ts._forbidden (x int)"))


def test_hypertable_roundtrip(db):
    with connect(admin=True) as conn:
        conn.execute(text("drop table if exists ts._t"))
        conn.execute(text("create table ts._t (ts timestamptz not null, v double precision)"))
        conn.execute(text("select create_hypertable('ts._t', by_range('ts', interval '1 day'))"))
        conn.execute(text("insert into ts._t values (now(), 1), (now() - interval '3 days', 2)"))
        chunks = conn.execute(
            text("select count(*) from timescaledb_information.chunks where hypertable_name='_t'")
        ).scalar_one()
        conn.execute(text("drop table ts._t"))
    assert chunks == 2


def test_health_endpoint(db):
    r = TestClient(app).get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
