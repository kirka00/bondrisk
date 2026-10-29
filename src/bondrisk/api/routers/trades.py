# ruff: noqa: E501  — длинные SQL-строки
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from sqlalchemy import text

from bondrisk.api.deps import TRADER, Conn, CurrentUser
from bondrisk.api.errors import ApiError
from bondrisk.api.pagination import PageParams, page_params, paginate
from bondrisk.api.routers._util import fetch_all, fetch_one, today_or
from bondrisk.api.schemas import Page, TradeIn, TradePreviewIn

router = APIRouter(prefix="/portfolios/{portfolio_id}/trades", tags=["trades"])

BASE = "select * from ops.v_trade_blotter"
SORT = {
    "trade_ts": "trade_ts",
    "trade_date": "trade_date, trade_id",
    "qty": "qty",
    "amount": "amount",
    "trade_id": "trade_id",
    "clean_price_pct": "clean_price_pct",
    "short_name": "short_name",
}


@router.get("", response_model=Page, summary="Блоттер сделок портфеля")
def list_trades(
    portfolio_id: int,
    conn: Conn,
    page: Annotated[PageParams, Depends(page_params)],
    bond_id: int | None = None,
    side: Literal["buy", "sell"] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    fetch_one(
        conn,
        "select 1 from ops.portfolio where portfolio_id = :id",
        {"id": portfolio_id},
        "portfolio not found",
    )
    where, params = ["portfolio_id = :pid"], {"pid": portfolio_id}
    if bond_id is not None:
        where.append("bond_id = :bond_id")
        params["bond_id"] = bond_id
    if side:
        where.append("side = :side")
        params["side"] = side
    if date_from:
        where.append("trade_date >= :df")
        params["df"] = date_from
    if date_to:
        where.append("trade_date <= :dt")
        params["dt"] = date_to
    if page.sort is None:
        page.order = "desc"
    return paginate(conn, BASE, where, params, SORT, page, "trade_ts", "trade_id")


def _blocks(r: dict) -> bool:
    """Как в ops.execute_trade: жёсткий лимит блокирует, если сделка доводит его до нарушения или
    увеличивает факт по уже нарушенному; сокращение нарушенной позиции разрешено."""
    if not r["is_hard"] or r["status_after"] != "breach":
        return False
    ub, fb, fa = r["utilization_before"], r["before_value"], r["after_value"]
    return ub is None or ub < 100 or fb is None or fa is None or fa > fb + 1e-6


@router.post("/preview", summary="Предварительная оценка сделки: метрики и лимиты до/после")
def preview(portfolio_id: int, body: TradePreviewIn, conn: Conn) -> dict:
    fetch_one(
        conn,
        "select 1 from ops.portfolio where portfolio_id = :id",
        {"id": portfolio_id},
        "portfolio not found",
    )
    fetch_one(
        conn, "select 1 from ref.bond where bond_id = :id", {"id": body.bond_id}, "bond not found"
    )
    d = today_or(body.as_of)
    settle = fetch_one(
        conn,
        "select * from ref.resolve_settlement(:d, :n, :m)",
        {"d": d, "n": body.settlement_days, "m": body.settlement_date},
    )
    rows = fetch_all(
        conn,
        "select * from risk.what_if_trade(:pid, :bid, :side, :qty, :d, :px, :s)",
        {
            "pid": portfolio_id,
            "bid": body.bond_id,
            "side": body.side,
            "qty": body.qty,
            "d": d,
            "px": body.clean_price_pct,
            "s": settle["settlement_date"],
        },
    )
    trade = {r["metric"]: r["after_value"] for r in rows if r["kind"] == "trade"}
    metrics = [
        {"metric": r["metric"], "before": r["before_value"], "after": r["after_value"]}
        for r in rows
        if r["kind"] == "metric"
    ]
    limits = [
        {
            "limit_id": int(r["metric"].split("#")[1]),
            "metric": r["metric"].split(" #")[0],
            "scope": r["scope"],
            "before": r["before_value"],
            "after": r["after_value"],
            "limit_value": r["limit_value"],
            "utilization_before": r["utilization_before"],
            "utilization_after": r["utilization_after"],
            "status_after": r["status_after"],
            "is_hard": r["is_hard"],
            "blocks": _blocks(r),
        }
        for r in rows
        if r["kind"] == "limit"
    ]
    blocked = any(x["blocks"] for x in limits)
    return {
        "portfolio_id": portfolio_id,
        "bond_id": body.bond_id,
        "side": body.side,
        "qty": body.qty,
        "metrics": metrics,
        "limits": limits,
        "blocked": blocked,
        # §20.1: дата расчётов (ручная дата в выходной переносится на понедельник — перенос явно)
        "settlement_date": settle["settlement_date"],
        "settlement_shifted_from": settle["shifted_from"],
        "price_pct": trade.get("price_pct"),
        "accrued_at_settlement": trade.get("accrued_at_settlement"),
        "amount_rub": trade.get("amount_rub"),
    }


@router.post(
    "",
    status_code=201,
    summary="Заключить сделку (атомарно: позиция, касса, лимиты)",
    dependencies=[TRADER],
)
def create_trade(portfolio_id: int, body: TradeIn, conn: Conn, user: CurrentUser) -> dict:
    # отключить проверку жёстких лимитов — исключительное действие, только администратор
    if not body.check_limits and user.role != "admin":
        raise ApiError(403, "only admin may skip the hard-limit check", "BR005")
    user_id = user.user_id
    trade_id = conn.execute(
        text("""
        select ops.execute_trade_fn(:pid, :bid, :side, :qty, :price, :uid, :td, :sd, :fee, :cp, :chk)"""),
        {
            "pid": portfolio_id,
            "bid": body.bond_id,
            "side": body.side,
            "qty": body.qty,
            "price": body.clean_price_pct,
            "uid": user_id,
            "td": today_or(body.trade_date),
            "sd": body.settlement_days,
            "fee": body.fee,
            "cp": body.counterparty,
            "chk": body.check_limits,
        },
    ).scalar_one()
    return fetch_one(conn, BASE + " where trade_id = :id", {"id": trade_id})
