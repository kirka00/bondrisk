"""Масштабируемый набор perf: объём растёт линейно, копии не пересекаются с настоящими бумагами,
рабочие таблицы не меняются. Всё в одной транзакции с откатом — схема perf после теста не остаётся."""

import pytest
from sqlalchemy import text

from bondrisk.db.engine import get_engine
from tests.perf.dataset import COPY_STEP, build


@pytest.fixture
def conn():
    try:
        c = get_engine(admin=True).connect()
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"БД недоступна: {e}")
    tx = c.begin()
    yield c
    tx.rollback()
    c.close()


def test_scale_is_linear_and_isolated(conn):
    def one(sql):
        return conn.execute(text(sql)).scalar_one()

    base = one("select count(*) from ts.price_history")
    trades = one("select count(*) from ops.trade")
    if base == 0:
        pytest.skip("котировки не загружены")

    meta = build(conn, 2)

    assert meta["rows"] == 2 * base
    for tbl in ("perf.price_history", "perf.price_plain", "perf.price_btree"):
        assert one(f"select count(*) from {tbl}") == 2 * base
    # копия 1 — те же бумаги со сдвигом bond_id, выше любого настоящего
    assert one(f"select count(*) from perf.price_history where bond_id >= {COPY_STEP}") == base
    assert one(f"select min(bond_id) from perf.price_history where bond_id >= {COPY_STEP}") > one(
        "select max(bond_id) from ref.bond"
    )
    assert (
        one(
            "select count(*) from timescaledb_information.hypertables where hypertable_schema = 'perf'"
        )
        == 1
    )
    # рабочие данные не затронуты
    assert one("select count(*) from ts.price_history") == base
    assert one("select count(*) from ops.trade") == trades
