"""Портфели-репликанты индексов MOEX с настоящей историей.

Каждый месяц (первый торговый день) берётся официальный состав индекса с весами на эту дату
(`iss/statistics/.../index/analytics/{IDX}?date=`), портфель ребалансируется к весам по ценам закрытия
этого дня: сначала продажи (выбывшие бумаги и излишки), затем покупки. Между ребалансировками каждый
торговый день считается фактический EOD: он же проводит купоны, амортизацию и погашения по графику MOEX.
Ничего случайного: состав, веса, цены, выплаты и рейтинги — из первоисточников; модельные допущения —
стартовый капитал, порог перебалансировки и денежный буфер (константы ниже).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date

from sqlalchemy import text

from bondrisk.db.engine import connect
from bondrisk.loader.db import LoadRun, rows, scalar, tx
from bondrisk.loader.eod import trading_days
from bondrisk.loader.funds import INDEXES, USER_TRADER, _seed_limits, ensure_bonds
from bondrisk.loader.moex import MoexClient

log = logging.getLogger("bondrisk.history")

CASH_BUFFER = (
    0.005  # доля NAV, остающаяся в деньгах: покупки не упираются в кассу из-за округления лотов
)
PRICE_WINDOW = 14  # дней: последняя цена закрытия для сделки ребалансировки
DRIFT = 0.02  # позиция не трогается, если отклонение от целевого количества меньше 2 %


@dataclass
class Px:
    clean: float  # чистая цена, % номинала
    dirty: float  # грязная цена в валюте выпуска на одну бумагу
    fx: float  # курс валюты выпуска к рублю


def drop_portfolio(code: str) -> None:
    """Полное удаление портфеля вместе со сделками (неизменяемость снимается только на время удаления)."""
    with connect(admin=True) as c:
        pid = c.execute(
            text("select portfolio_id from ops.portfolio where code = :c"), {"c": code}
        ).scalar()
        if pid is None:
            return
        p = {"p": pid}
        c.execute(text("alter table ops.trade disable trigger trade_immutable"))
        try:
            for sql in (
                "delete from risk.limit_breach where limit_id in (select limit_id from risk.risk_limit where portfolio_id = :p)",
                "delete from risk.risk_limit where portfolio_id = :p",
                "delete from risk.position_snapshot where portfolio_id = :p",
                "delete from risk.risk_snapshot where portfolio_id = :p",
                "delete from ops.cash_movement where cash_account_id in (select cash_account_id from ops.cash_account where portfolio_id = :p)",
                "delete from ops.trade where portfolio_id = :p",
                "delete from ops.position where portfolio_id = :p",
                "delete from ops.cash_account where portfolio_id = :p",
                "delete from ops.portfolio where portfolio_id = :p",
            ):
                c.execute(text(sql), p)
        finally:
            c.execute(text("alter table ops.trade enable trigger trade_immutable"))
    log.info("%s: dropped", code)


def _rebalance_days(d_from: date, d_to: date) -> list[date]:
    """Первый торговый день каждого месяца (по датам кривой КБД — она есть только на торговые дни)."""
    return [
        r["d"]
        for r in rows(
            "select min(ts) as d from ts.yield_curve where ts between :a and :b group by date_trunc('month', ts) order by 1",
            a=d_from,
            b=d_to,
        )
    ]


def _price(bond_id: int, d: date) -> Px | None:
    """Последняя цена закрытия не старше PRICE_WINDOW дней. Требование цены ровно на дату ребалансировки
    систематически выбрасывало неликвидные и проблемные бумаги (эффект выжившего: репликант ВДО обгонял
    индекс на 11 п.п.); без котировки за две недели бумага по-прежнему не покупается и не продаётся."""
    r = rows(
        """
        select m.clean_price_pct, m.dirty_price, risk.fx_at(b.currency, :d) as fx, m.price_date
          from ref.bond b cross join lateral ref.bond_metrics(b.bond_id, :d) m
         where b.bond_id = :b and b.maturity_date > :d""",
        b=bond_id,
        d=d,
    )
    if (
        not r
        or (d - r[0]["price_date"]).days > PRICE_WINDOW
        or not r[0]["dirty_price"]
        or r[0]["fx"] is None
    ):
        return None
    return Px(float(r[0]["clean_price_pct"]), float(r[0]["dirty_price"]), float(r[0]["fx"]))


def _holdings(pid: int, d: date) -> dict[int, int]:
    return {
        r["bond_id"]: int(r["qty"])
        for r in rows(
            """select bond_id, sum(case when side = 'buy' then qty else -qty end) as qty
                 from ops.trade where portfolio_id = :p and trade_date <= :d group by bond_id
               having sum(case when side = 'buy' then qty else -qty end) <> 0""",
            p=pid,
            d=d,
        )
    }


def _nav_rub(pid: int, d: date) -> float:
    m = rows("select mv_net from risk.portfolio_metrics(:p, :d)", p=pid, d=d)[0]
    return float(m["mv_net"] or 0) + float(
        scalar("select risk.cash_total_rub(:p, :d)", p=pid, d=d) or 0
    )


def _trade(
    c, pid: int, bond_id: int, side: str, qty: int, px: Px, d: date, index: str, user: int
) -> None:
    c.execute(
        text(
            "select ops.execute_trade_fn(cast(:p as bigint), cast(:b as bigint), cast(:s as ops.trade_side),"
            " cast(:q as bigint), cast(:pr as numeric), cast(:u as bigint), cast(:d as date), 0, 0, :cp, false)"
        ),
        {
            "p": pid,
            "b": bond_id,
            "s": side,
            "q": qty,
            "pr": round(px.clean, 6),
            "u": user,
            "d": d,
            "cp": f"ребалансировка {index}",
        },
    )


def _rebalance(
    pid: int, code: str, index: str, d: date, comp: list[dict], ids: dict, user: int, run: LoadRun
) -> tuple[int, int]:
    nav = _nav_rub(pid, d) * (1 - CASH_BUFFER)
    target: dict[int, int] = {}
    prices: dict[int, Px] = {}
    for c_ in comp:
        bid = ids.get(c_["secids"])
        if not bid or not float(c_["weight"] or 0):
            continue
        px = _price(bid, d)
        if px is None:
            run.error(f"{code} {d}: no close price for {c_['secids']}", {"secid": c_["secids"]})
            continue
        prices[bid] = px
        target[bid] = target.get(bid, 0) + int(
            float(c_["weight"]) / 100.0 * nav / (px.dirty * px.fx)
        )
    held = _holdings(pid, d)
    for bid in held:
        if bid not in prices and (px := _price(bid, d)):
            prices[bid] = px
    sells, buys = [], []
    for bid in set(held) | set(target):
        cur, want = held.get(bid, 0), target.get(bid, 0)
        if bid not in prices or cur == want:
            continue  # погашенная или без котировки в этот день — остаётся до выплаты/следующей ребалансировки
        if want and cur and abs(want - cur) < DRIFT * want:
            continue
        (sells if want < cur else buys).append((bid, abs(want - cur)))
    done = 0
    with tx() as c:
        for side, lst in (("sell", sells), ("buy", buys)):
            for bid, qty in lst:
                try:
                    with c.begin_nested():
                        _trade(c, pid, bid, side, qty, prices[bid], d, index, user)
                    done += 1
                except Exception as e:  # noqa: BLE001
                    run.error(
                        f"{code} {d}: {side} {qty} of {bid} failed: {str(e).splitlines()[0][:160]}",
                        {"bond_id": bid, "qty": qty},
                        conn=c,
                    )
    return len(sells), len(buys)


def build_index_history(
    code: str, d_from: date, d_to: date, client: MoexClient | None = None
) -> None:
    index, title, nav0, cur = INDEXES[code]
    client = client or MoexClient()
    run = LoadRun("load index-history", {"code": code, "from": str(d_from), "to": str(d_to)})
    reb = _rebalance_days(d_from, d_to)
    if not reb:
        raise RuntimeError(f"no trading days in {d_from}..{d_to}")
    comps = {d: client.index_composition(index, d.isoformat()) for d in reb}
    secids = sorted({c_["secids"] for comp in comps.values() for c_ in comp})
    ids = ensure_bonds(client, secids, run)
    log.info(
        "%s: %d rebalances, %d distinct constituents, %d resolved",
        code,
        len(reb),
        len(secids),
        sum(1 for s in secids if ids.get(s)),
    )

    drop_portfolio(code)
    user = scalar(USER_TRADER)
    start = reb[0]
    with tx() as c:
        pid = c.execute(
            text(
                "insert into ops.portfolio (code, name, manager_id, allow_short, base_currency)"
                " values (:c, :n, :m, false, :bc) returning portfolio_id"
            ),
            {
                "c": code,
                "n": f"{title}: репликация с {start:%d.%m.%Y}, ежемесячная ребалансировка",
                "m": user,
                "bc": cur,
            },
        ).scalar_one()
        c.execute(
            text(
                "call ops.deposit_cash(cast(:p as bigint), cast(:c as char(3)), cast(:a as numeric), cast(:u as bigint),"
                " 'стартовый капитал', cast(:d as date))"
            ),
            {"p": pid, "c": cur, "a": nav0, "u": user, "d": start},
        )
    days = trading_days(start, d_to)
    for i, d in enumerate(days):
        _day(pid, code, index, d, days[i - 1] if i else start, comps.get(d), ids, user, run)
        if d == start:
            _seed_limits(pid, d)
            with tx() as c:
                c.execute(text("call risk.run_eod(:p, :d)"), {"p": pid, "d": d})
    with tx() as c:
        c.execute(text("call risk.refresh_views()"))
    run.ok += len(days)
    run.finish()


def _day(
    pid: int,
    code: str,
    index: str,
    d: date,
    prev: date,
    comp: list[dict] | None,
    ids: dict,
    user: int,
    run: LoadRun,
) -> None:
    """Торговый день репликанта: в день ребалансировки (comp задан) — выплаты и сделки, затем EOD."""
    if comp is not None:
        # перед ребалансировкой проводятся выплаты по сегодняшний день: деньги от купонов реинвестируются
        with tx() as c:
            c.execute(text("call ops.book_bond_flows(:p, :a, :b)"), {"p": pid, "a": prev, "b": d})
        s, b = _rebalance(pid, code, index, d, comp, ids, user, run)
        log.info("%s %s: rebalance, %d sells, %d buys", code, d, s, b)
    with tx() as c:
        c.execute(text("call risk.run_eod(:p, :d)"), {"p": pid, "d": d})


def extend_index_history(
    code: str, last_eod: date, d_to: date, client: MoexClient | None = None
) -> int:
    """Продолжение репликанта без пересборки: торговые дни после last_eod (сам last_eod пересчитывается).
    Первый торговый день нового месяца — ребалансировка по официальному составу индекса на эту дату."""
    index = INDEXES[code][0]
    pid = scalar("select portfolio_id from ops.portfolio where code = :c", c=code)
    days = trading_days(last_eod, d_to)
    if not days:
        return 0
    month_start = date(last_eod.year, last_eod.month, 1)
    traded = scalar(
        "select max(trade_date) from ops.trade where portfolio_id = :p and counterparty like 'ребалансировка%'",
        p=pid,
    )
    reb = {
        d
        for d in _rebalance_days(month_start, d_to)
        if d in days and (traded is None or d > traded)
    }
    client = client or MoexClient()
    run = LoadRun("extend index-history", {"code": code, "from": str(last_eod), "to": str(d_to)})
    comps = {d: client.index_composition(index, d.isoformat()) for d in sorted(reb)}
    secids = sorted({c_["secids"] for comp in comps.values() for c_ in comp})
    ids = ensure_bonds(client, secids, run) if secids else {}
    user = scalar(USER_TRADER)
    for i, d in enumerate(days):
        _day(pid, code, index, d, days[i - 1] if i else last_eod, comps.get(d), ids, user, run)
    run.ok += len(days)
    run.finish()
    log.info("%s: eod %d days up to %s, %d rebalances", code, len(days), days[-1], len(reb))
    return len(days)
