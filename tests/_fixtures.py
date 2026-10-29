"""Общие SQL-фикстуры для тестов ограничений и конкурентности.

Создаётся изолированный набор: эмитенты, две бумаги с графиком, цены, кривая, курс,
портфель с кассой. Всё помечено префиксом CTEST и удаляется в teardown под admin.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text

from bondrisk.db.engine import connect

AS_OF = "2035-10-25"


@dataclass
class Fixture:
    issuer_sov: int
    issuer_corp: int
    bond_zero: int
    bond_par: int
    portfolio: int
    user_trader: int
    user_risk: int


def _ids(prefix: str) -> dict[str, str]:
    code = str(sum(ord(ch) for ch in prefix) % 100).zfill(2)
    return {
        "isin1": f"RU0{prefix[:4]}0{code}01",
        "isin2": f"RU0{prefix[:4]}0{code}02",
        "inn1": f"7799{code}0001",
        "inn2": f"7799{code}0002",
        "like": f"RU0{prefix[:4]}0{code}%",
    }


def create_fixture(prefix: str = "CTEST") -> Fixture:
    ids = _ids(prefix)
    with connect(admin=True) as c:
        c.execute(text("select set_config('bondrisk.user_id', '1', true)"))
        sov = c.execute(
            text(
                "insert into ref.issuer (name, inn, sector, is_sovereign) values (:n, :inn, 'Государственные', true)"
                " on conflict (inn) do update set name = excluded.name returning issuer_id"
            ),
            {"n": f"{prefix} Минфин", "inn": ids["inn1"]},
        ).scalar_one()
        corp = c.execute(
            text(
                "insert into ref.issuer (name, inn, sector) values (:n, :inn, 'Тест')"
                " on conflict (inn) do update set name = excluded.name returning issuer_id"
            ),
            {"n": f"{prefix} Корпорация", "inn": ids["inn2"]},
        ).scalar_one()
        zero = c.execute(
            text(
                "insert into ref.bond (isin, secid, issuer_id, short_name, face_value_initial, coupon_type,"
                " coupon_rate_pct, coupon_freq, issue_date, maturity_date)"
                " values (:isin, :s, :i, 'CTEST Zero', 1000, 'zero', null, 0, '2034-10-25', '2036-10-25')"
                " on conflict (isin) do update set short_name = excluded.short_name returning bond_id"
            ),
            {"isin": ids["isin1"], "s": f"{prefix}ZERO", "i": sov},
        ).scalar_one()
        par = c.execute(
            text(
                "insert into ref.bond (isin, secid, issuer_id, short_name, face_value_initial, coupon_type,"
                " coupon_rate_pct, coupon_freq, issue_date, maturity_date)"
                " values (:isin, :s, :i, 'CTEST Par10', 1000, 'fixed', 10, 1, '2034-10-25', '2037-10-25')"
                " on conflict (isin) do update set short_name = excluded.short_name returning bond_id"
            ),
            {"isin": ids["isin2"], "s": f"{prefix}PAR", "i": corp},
        ).scalar_one()
        c.execute(text("delete from ref.cash_flow_schedule where bond_id = :b"), {"b": par})
        c.execute(
            text(
                "insert into ref.cash_flow_schedule (bond_id, flow_type, period, pay_date, rate_pct, amount) values"
                " (:b, 'coupon', daterange('2034-10-25','2035-10-25'), '2035-10-25', 10, 100),"
                " (:b, 'coupon', daterange('2035-10-25','2036-10-25'), '2036-10-25', 10, 100),"
                " (:b, 'coupon', daterange('2036-10-25','2037-10-25'), '2037-10-25', 10, 100),"
                " (:b, 'redemption', null, '2037-10-25', null, 1000)"
            ),
            {"b": par},
        )
        c.execute(
            text(
                "insert into ts.price_history (ts, bond_id, close_pct) values (:d, :z, 82.6446), (:d, :p, 100.0)"
                " on conflict (bond_id, ts) do update set close_pct = excluded.close_pct"
            ),
            {"d": AS_OF, "z": zero, "p": par},
        )
        c.execute(
            text(
                "insert into ts.yield_curve (ts, tenor_years, rate_pct) values (:d, 0.25, 13), (:d, 1, 14), (:d, 2, 15), (:d, 5, 16)"
                " on conflict do nothing"
            ),
            {"d": AS_OF},
        )
        c.execute(
            text(
                "insert into ts.fx_rate (ts, currency, rate_rub) values (:d, 'USD', 80.0) on conflict do nothing"
            ),
            {"d": AS_OF},
        )
        c.execute(text("delete from ref.credit_rating where issuer_id = :i"), {"i": corp})
        c.execute(
            text(
                "insert into ref.credit_rating (agency_id, issuer_id, grade, assigned_on) values (2, :i, 'BBB+', '2035-03-10')"
            ),
            {"i": corp},
        )
        trader = c.execute(
            text("select user_id from ops.app_user where login = 'trader'")
        ).scalar_one()
        risk = c.execute(text("select user_id from ops.app_user where login = 'risk'")).scalar_one()
        drop_portfolio(c, prefix)
        pf = c.execute(
            text(
                "insert into ops.portfolio (code, name, manager_id) values (:c, 'Тест конкурентности', :m) returning portfolio_id"
            ),
            {"c": prefix, "m": trader},
        ).scalar_one()
        c.execute(text("call ops.deposit_cash(:p, 'RUB', 10000000, :u)"), {"p": pf, "u": trader})
    return Fixture(sov, corp, zero, par, pf, trader, risk)


def drop_portfolio(c, prefix: str) -> None:
    pf = c.execute(
        text("select portfolio_id from ops.portfolio where code = :c"), {"c": prefix}
    ).scalar()
    if pf is None:
        return
    c.execute(text("alter table ops.trade disable trigger trade_immutable"))
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
    c.execute(text("alter table ops.trade enable trigger trade_immutable"))
    c.execute(text("delete from ops.position where portfolio_id = :p"), {"p": pf})
    c.execute(text("delete from ops.cash_account where portfolio_id = :p"), {"p": pf})
    c.execute(text("delete from ops.portfolio where portfolio_id = :p"), {"p": pf})


def drop_fixture(prefix: str = "CTEST") -> None:
    ids = _ids(prefix)
    with connect(admin=True) as c:
        drop_portfolio(c, prefix)
        c.execute(
            text("delete from ts.yield_curve where ts = :d and rate_pct in (13, 14, 15, 16)"),
            {"d": AS_OF},
        )
        c.execute(
            text("delete from ts.fx_rate where ts = :d and currency = 'USD' and rate_rub = 80.0"),
            {"d": AS_OF},
        )
        c.execute(
            text(
                "delete from ref.credit_rating where issuer_id in (select issuer_id from ref.issuer where inn in (:a, :b))"
            ),
            {"a": ids["inn1"], "b": ids["inn2"]},
        )
        c.execute(
            text(
                "delete from ts.price_history where ts = :d"
                " and bond_id in (select bond_id from ref.bond where isin like :l)"
            ),
            {"d": AS_OF, "l": ids["like"]},
        )
        c.execute(text("delete from ref.bond where isin like :l"), {"l": ids["like"]})
        c.execute(
            text("delete from ref.issuer where inn in (:a, :b)"),
            {"a": ids["inn1"], "b": ids["inn2"]},
        )
        c.execute(text("call risk.refresh_views()"))  # убрать удалённый портфель из сводки риска
