"""Общие фикстуры: синтетический набор данных с префиксом TEST в будущем периоде (2035 г.),
чтобы не пересекаться с реальными данными загрузчика; создаётся под admin и удаляется после сессии."""

import os
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from bondrisk.db.engine import connect

AS_OF = date(2035, 1, 15)
TAG = uuid.uuid4().hex[:5].upper()


def _db_available() -> bool:
    try:
        with connect(admin=True) as conn:
            conn.execute(text("select 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


@pytest.fixture(scope="session")
def fx():
    """Фикстура данных: эмитенты, 3 бумаги, график, цены, кривая, курс, рейтинг, портфель с кассой."""
    if not _db_available():
        pytest.skip("БД недоступна")
    ids: dict = {"tag": TAG, "as_of": AS_OF}
    with connect(admin=True) as c:
        ids["sov"] = c.execute(
            text(
                "insert into ref.issuer (name, inn, sector, is_sovereign) values (:n, :inn, 'Государственные', true) "
                "returning issuer_id"
            ),
            {"n": f"TEST Минфин {TAG}", "inn": f"77{TAG[:4].encode().hex()[:8]}"[:10]},
        ).scalar_one()
        ids["corp"] = c.execute(
            text(
                "insert into ref.issuer (name, short_name, inn, sector) values (:n, :s, :inn, 'Нефть и газ') returning issuer_id"
            ),
            {
                "n": f"TEST ООО Нефтяник {TAG}",
                "s": f"Нефтяник {TAG}",
                "inn": f"78{TAG[:4].encode().hex()[:8]}"[:10],
            },
        ).scalar_one()
        # Бескупонная 1 год (с AS_OF), фикс 10 % 2 года годовой купон, валютная (USD) 10 % 2 года
        rows = [
            (
                f"RU000T{TAG}0",
                f"TZERO{TAG}",
                ids["sov"],
                "TEST Zero 1y",
                1000,
                "zero",
                None,
                0,
                "2034-01-15",
                "2036-01-15",
                "RUB",
            ),
            (
                f"RU000T{TAG}1",
                f"TPAR{TAG}",
                ids["corp"],
                "TEST Par 10% 2y",
                1000,
                "fixed",
                10,
                1,
                "2034-01-15",
                "2037-01-15",
                "RUB",
            ),
            (
                f"RU000T{TAG}2",
                f"TUSD{TAG}",
                ids["corp"],
                "TEST USD 10% 2y",
                1000,
                "fixed",
                10,
                1,
                "2034-01-15",
                "2037-01-15",
                "USD",
            ),
        ]
        ids["bonds"] = []
        for isin, secid, iss, name, face, ct, rate, freq, idate, mdate, cur in rows:
            bid = c.execute(
                text("""
                insert into ref.bond (isin, secid, issuer_id, short_name, face_value_initial, coupon_type, coupon_rate_pct,
                                      coupon_freq, issue_date, maturity_date, currency, board)
                values (:isin, :secid, :iss, :name, :face, :ct, :rate, :freq, :idate, :mdate, :cur, 'TQCB') returning bond_id"""),
                dict(
                    isin=isin,
                    secid=secid,
                    iss=iss,
                    name=name,
                    face=face,
                    ct=ct,
                    rate=rate,
                    freq=freq,
                    idate=idate,
                    mdate=mdate,
                    cur=cur,
                ),
            ).scalar_one()
            ids["bonds"].append(bid)
        zero, par, usd = ids["bonds"]
        for b in (par, usd):
            c.execute(
                text("""
                insert into ref.cash_flow_schedule (bond_id, flow_type, period, pay_date, rate_pct, amount) values
                (:b, 'coupon', daterange('2034-01-15','2035-01-15'), '2035-01-15', 10, 100),
                (:b, 'coupon', daterange('2035-01-15','2036-01-15'), '2036-01-15', 10, 100),
                (:b, 'coupon', daterange('2036-01-15','2037-01-15'), '2037-01-15', 10, 100),
                (:b, 'redemption', null, '2037-01-15', null, 1000)"""),
                {"b": b},
            )
        c.execute(
            text(
                "insert into ts.price_history (ts, bond_id, close_pct) values (:d, :z, 82.6446), (:d, :p, 100.0), (:d, :u, 100.0)"
            ),
            {"d": AS_OF, "z": zero, "p": par, "u": usd},
        )
        c.execute(
            text("""insert into ts.yield_curve (ts, tenor_years, rate_pct) values
                          (:d, 0.25, 8), (:d, 1, 8.5), (:d, 2, 9), (:d, 5, 9.5), (:d, 10, 10)"""),
            {"d": AS_OF},
        )
        c.execute(
            text("insert into ts.fx_rate (ts, currency, rate_rub) values (:d, 'USD', 80.0)"),
            {"d": AS_OF},
        )
        c.execute(
            text(
                "insert into ref.credit_rating (agency_id, issuer_id, grade, assigned_on) values (2, :i, 'BBB', '2034-03-01')"
            ),
            {"i": ids["corp"]},
        )
        c.execute(
            text(
                "insert into ref.credit_rating (agency_id, issuer_id, grade, assigned_on) values (2, :i, 'BBB+', '2034-09-01')"
            ),
            {"i": ids["corp"]},
        )
        ids["trader"] = c.execute(
            text("select user_id from ops.app_user where login = 'trader'")
        ).scalar_one()
        ids["risk"] = c.execute(
            text("select user_id from ops.app_user where login = 'risk'")
        ).scalar_one()
        ids["admin"] = c.execute(
            text("select user_id from ops.app_user where role = 'admin' order by user_id limit 1")
        ).scalar_one()
        ids["viewer"] = c.execute(
            text("select user_id from ops.app_user where role = 'viewer' order by user_id limit 1")
        ).scalar_one()
        ids["pf"] = c.execute(
            text(
                "insert into ops.portfolio (code, name, manager_id) values (:code, 'TEST портфель', :m) returning portfolio_id"
            ),
            {"code": f"TEST-{TAG}", "m": ids["trader"]},
        ).scalar_one()
        c.execute(
            text("call ops.deposit_cash(:p, 'RUB', 1000000, :u)"),
            {"p": ids["pf"], "u": ids["trader"]},
        )
    yield ids
    if os.environ.get("BONDRISK_KEEP_TEST_DATA"):
        return
    with connect(admin=True) as c:
        c.execute(text("alter table ops.trade disable trigger trade_immutable"))
        try:
            pf = ids["pf"]
            c.execute(
                text(
                    "delete from risk.limit_breach where limit_id in (select limit_id from risk.risk_limit where portfolio_id = :p)"
                ),
                {"p": pf},
            )
            c.execute(text("delete from risk.risk_limit where portfolio_id = :p"), {"p": pf})
            c.execute(text("delete from risk.position_snapshot where portfolio_id = :p"), {"p": pf})
            c.execute(text("delete from risk.risk_snapshot where portfolio_id = :p"), {"p": pf})
            c.execute(
                text(
                    "delete from ops.cash_movement where cash_account_id in (select cash_account_id from ops.cash_account where portfolio_id = :p)"
                ),
                {"p": pf},
            )
            c.execute(text("delete from ops.trade where portfolio_id = :p"), {"p": pf})
            c.execute(text("delete from ops.position where portfolio_id = :p"), {"p": pf})
            c.execute(text("delete from ops.cash_account where portfolio_id = :p"), {"p": pf})
            c.execute(text("delete from ops.portfolio where portfolio_id = :p"), {"p": pf})
            c.execute(text("delete from ops.portfolio where code like :c"), {"c": f"TEST-{TAG}%"})
            c.execute(
                text("delete from ts.price_history where ts = :d and bond_id = any(:b)"),
                {"d": AS_OF, "b": ids["bonds"]},
            )
            c.execute(
                text(
                    "delete from ref.credit_rating where issuer_id in (:a, :b) or bond_id = any(:bb)"
                ),
                {"a": ids["sov"], "b": ids["corp"], "bb": ids["bonds"]},
            )
            c.execute(
                text("delete from ref.bond where issuer_id in (:a, :b)"),
                {"a": ids["sov"], "b": ids["corp"]},
            )
            c.execute(
                text("delete from ref.issuer where issuer_id in (:a, :b) or name like :n"),
                {"a": ids["sov"], "b": ids["corp"], "n": f"TEST%{TAG}%"},
            )
            c.execute(text("delete from ts.yield_curve where ts = :d"), {"d": AS_OF})
            c.execute(text("delete from ts.fx_rate where ts = :d"), {"d": AS_OF})
            c.execute(
                text(
                    "delete from audit.audit_log where changed_at > now() - interval '1 hour' and (new_data->>'portfolio_id' = :p or old_data->>'portfolio_id' = :p)"
                ),
                {"p": str(pf)},
            )
            # сводка риска — материализованное представление: без обновления в ней остался бы удалённый портфель
            c.execute(text("call risk.refresh_views()"))
        finally:
            c.execute(text("alter table ops.trade enable trigger trade_immutable"))


@pytest.fixture(scope="session")
def client(fx):
    from bondrisk.api.main import app

    return TestClient(app, headers={"X-User-Id": str(fx["trader"])})


@pytest.fixture(scope="session")
def risk_client(fx):
    from bondrisk.api.main import app

    return TestClient(app, headers={"X-User-Id": str(fx["risk"])})


@pytest.fixture(scope="session")
def admin_client(fx):
    from bondrisk.api.main import app

    return TestClient(app, headers={"X-User-Id": str(fx["admin"])})


@pytest.fixture(scope="session")
def viewer_client(fx):
    from bondrisk.api.main import app

    return TestClient(app, headers={"X-User-Id": str(fx["viewer"])})
