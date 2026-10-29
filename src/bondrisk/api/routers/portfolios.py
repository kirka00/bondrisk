# ruff: noqa: E501  — длинные SQL-строки
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from bondrisk.api.deps import ADMIN, OPERATOR, TRADER, Conn, UserId
from bondrisk.api.pagination import PageParams, page_params, paginate
from bondrisk.api.routers._util import build_update, clean_row, fetch_all, fetch_one, today_or
from bondrisk.api.schemas import DepositIn, Page, PortfolioIn, PortfolioPatch

router = APIRouter(prefix="/portfolios", tags=["portfolios"])

BASE = """
select p.portfolio_id, p.code, p.name, p.base_currency, p.manager_id, u.full_name as manager_name,
       p.allow_short, p.status, p.created_at,
       (select count(*) from ops.position x where x.portfolio_id = p.portfolio_id and x.qty <> 0) as positions_count,
       (select min(t.trade_date) from ops.trade t where t.portfolio_id = p.portfolio_id) as inception_date
  from ops.portfolio p join ops.app_user u on u.user_id = p.manager_id
"""
SORT = {"code": "code", "name": "name", "portfolio_id": "portfolio_id", "created_at": "created_at"}


def _exists(conn, portfolio_id: int) -> dict:
    return fetch_one(
        conn,
        "select portfolio_id, code, status from ops.portfolio where portfolio_id = :id",
        {"id": portfolio_id},
        "portfolio not found",
    )


@router.get("", response_model=Page, summary="Портфели")
def list_portfolios(
    conn: Conn, page: Annotated[PageParams, Depends(page_params)], status: str | None = None
) -> dict:
    where, params = [], {}
    if status:
        where.append("status = :status")
        params["status"] = status
    return paginate(conn, BASE, where, params, SORT, page, "code", "portfolio_id")


@router.post("", status_code=201, summary="Создать портфель", dependencies=[ADMIN])
def create_portfolio(body: PortfolioIn, conn: Conn) -> dict:
    pid = conn.execute(
        text("""
        insert into ops.portfolio (code, name, base_currency, manager_id, allow_short)
        values (:code, :name, :base_currency, :manager_id, :allow_short) returning portfolio_id"""),
        body.model_dump(),
    ).scalar_one()
    return fetch_one(conn, BASE + " where p.portfolio_id = :id", {"id": pid})


@router.get("/{portfolio_id}", summary="Портфель")
def get_portfolio(portfolio_id: int, conn: Conn) -> dict:
    return fetch_one(
        conn, BASE + " where p.portfolio_id = :id", {"id": portfolio_id}, "portfolio not found"
    )


@router.patch("/{portfolio_id}", summary="Изменить портфель", dependencies=[ADMIN])
def patch_portfolio(portfolio_id: int, body: PortfolioPatch, conn: Conn) -> dict:
    sql, params = build_update(
        "ops.portfolio",
        "portfolio_id",
        portfolio_id,
        body.model_dump(exclude_unset=True),
        {"name", "manager_id", "allow_short", "status"},
    )
    fetch_one(conn, sql, params, "portfolio not found")
    return fetch_one(conn, BASE + " where p.portfolio_id = :id", {"id": portfolio_id})


@router.get("/{portfolio_id}/positions", summary="Оценка позиций и агрегаты портфеля на дату")
def positions(
    portfolio_id: int, conn: Conn, as_of: date | None = None, holdings_date: date | None = None
) -> dict:
    """holdings_date — про-форма: состав портфеля на эту дату, цены и кривая — на as_of."""
    _exists(conn, portfolio_id)
    d = today_or(as_of)
    p = {"id": portfolio_id, "d": d, "h": holdings_date}
    items = fetch_all(
        conn,
        "select * from risk.position_valuation(:id, :d, null, 0, :h) order by abs(mv_rub) desc",
        p,
    )
    totals = (
        conn.execute(
            text("select * from risk.portfolio_metrics(:id, :d, null, 0, 32, 2.326, :h)"), p
        )
        .mappings()
        .one()
    )
    return {
        "portfolio_id": portfolio_id,
        "as_of": d,
        "holdings_date": holdings_date,
        "items": items,
        "totals": clean_row(totals),
    }


@router.get("/{portfolio_id}/cash", summary="Денежные счета")
def cash(portfolio_id: int, conn: Conn) -> list[dict]:
    _exists(conn, portfolio_id)
    return fetch_all(
        conn,
        """
        select cash_account_id, currency, balance, allow_overdraft from ops.cash_account
         where portfolio_id = :id order by currency""",
        {"id": portfolio_id},
    )


@router.post(
    "/{portfolio_id}/cash/deposit",
    status_code=201,
    summary="Пополнение / списание денег",
    dependencies=[TRADER],
)
def deposit(portfolio_id: int, body: DepositIn, conn: Conn, user_id: UserId) -> list[dict]:
    _exists(conn, portfolio_id)
    conn.execute(
        text("call ops.deposit_cash(:id, :cur, :amt, :uid, :note)"),
        {
            "id": portfolio_id,
            "cur": body.currency,
            "amt": body.amount,
            "uid": user_id,
            "note": body.note or "пополнение",
        },
    )
    return cash(portfolio_id, conn)


@router.get("/{portfolio_id}/risk", summary="Снапшоты риска: последний и история (120 дней)")
def risk(portfolio_id: int, conn: Conn, days: Annotated[int, Query(ge=1, le=3660)] = 120) -> dict:
    _exists(conn, portfolio_id)
    hist = fetch_all(
        conn,
        """
        select * from risk.risk_snapshot where portfolio_id = :id
           and as_of >= coalesce((select max(as_of) from risk.risk_snapshot where portfolio_id = :id), current_date) - :days
         order by as_of""",
        {"id": portfolio_id, "days": days},
    )
    return {"portfolio_id": portfolio_id, "latest": hist[-1] if hist else None, "history": hist}


@router.post(
    "/{portfolio_id}/eod",
    summary="Расчёт конца дня: снапшоты, лимиты, обновление сводки",
    dependencies=[OPERATOR],
)
def eod(
    portfolio_id: int, conn: Conn, as_of: date | None = None, holdings_date: date | None = None
) -> dict:
    """holdings_date — ретроспективный (про-форма) снапшот: без фиксации нарушений."""
    _exists(conn, portfolio_id)
    d = today_or(as_of)
    conn.execute(
        text("call risk.run_eod(:id, :d, :h)"), {"id": portfolio_id, "d": d, "h": holdings_date}
    )
    conn.execute(text("call risk.refresh_views()"))
    snap = (
        conn.execute(
            text("select * from risk.risk_snapshot where portfolio_id = :id and as_of = :d"),
            {"id": portfolio_id, "d": d},
        )
        .mappings()
        .first()
    )
    breaches = fetch_all(
        conn,
        """
        select lb.*, l.metric, l.is_hard, coalesce(i.short_name, i.name, b.short_name, l.scope_sector) as scope
          from risk.limit_breach lb join risk.risk_limit l on l.limit_id = lb.limit_id
          left join ref.issuer i on i.issuer_id = l.scope_issuer_id
          left join ref.bond b on b.bond_id = l.scope_bond_id
         where l.portfolio_id = :id and lb.as_of = :d order by lb.utilization_pct desc""",
        {"id": portfolio_id, "d": d},
    )
    return {
        "portfolio_id": portfolio_id,
        "as_of": d,
        "snapshot": clean_row(snap) if snap else None,
        "breaches": breaches,
    }


@router.get("/{portfolio_id}/limits", summary="Утилизация лимитов онлайн (risk.limit_facts)")
def limits(
    portfolio_id: int, conn: Conn, as_of: date | None = None, holdings_date: date | None = None
) -> list[dict]:
    _exists(conn, portfolio_id)
    return fetch_all(
        conn,
        "select * from risk.limit_facts(:id, :d, null, 0, :h)",
        {"id": portfolio_id, "d": today_or(as_of), "h": holdings_date},
    )
