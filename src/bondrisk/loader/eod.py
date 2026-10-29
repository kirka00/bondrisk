"""EOD: снапшоты риска и контроль лимитов по торговым дням."""

from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import text

from bondrisk.loader.db import rows, tx

log = logging.getLogger("bondrisk.eod")


def portfolio_ids(code: str | None) -> list[tuple[int, str]]:
    """Активные портфели; без кода — все."""
    sql = "select portfolio_id, code from ops.portfolio where status = 'active'"
    sql += " and code = :c" if code else ""
    sql += " order by portfolio_id"
    return [(r["portfolio_id"], r["code"]) for r in rows(sql, c=code)]


def trading_days(date_from: date, date_to: date) -> list[date]:
    return [
        r["ts"]
        for r in rows(
            "select distinct ts from ts.price_history where ts between :a and :b order by ts",
            a=date_from,
            b=date_to,
        )
    ]


def run_eod(code: str | None, as_of: date, refresh: bool = True) -> None:
    for pid, pcode in portfolio_ids(code):
        with tx() as c:
            c.execute(text("call risk.run_eod(:p, :d)"), {"p": pid, "d": as_of})
        log.info("eod %s %s", pcode, as_of)
    if refresh:
        refresh_views()


def run_eod_range(
    code: str | None, date_from: date, date_to: date, holdings: date | None = None
) -> int:
    """EOD по торговым дням; holdings — про-форма: состав на эту дату, рынок на каждый день."""
    days = trading_days(date_from, date_to)
    pids = portfolio_ids(code)
    n = 0
    for d in days:
        with tx() as c:
            for pid, _ in pids:
                c.execute(text("call risk.run_eod(:p, :d, :h)"), {"p": pid, "d": d, "h": holdings})
                n += 1
        log.info("eod %s%s: %d portfolios", d, " (про-форма)" if holdings else "", len(pids))
    refresh_views()
    return n


def refresh_views() -> None:
    with tx() as c:
        c.execute(text("call risk.refresh_views()"))
