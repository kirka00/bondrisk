# ruff: noqa: E501  — длинные SQL-строки
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from sqlalchemy import text

from bondrisk.api.deps import Conn, UserId
from bondrisk.api.pagination import PageParams, page_params, paginate
from bondrisk.api.routers._util import fetch_one
from bondrisk.api.schemas import Page, WaiveIn

router = APIRouter(prefix="/breaches", tags=["breaches"])

BASE = """
select lb.breach_id, lb.limit_id, l.portfolio_id, p.code as portfolio_code, l.metric, l.side, l.is_hard,
       coalesce(i.short_name, i.name, b.short_name, l.scope_sector) as scope,
       lb.as_of, lb.fact_value, lb.limit_value, lb.utilization_pct, lb.status,
       lb.waived_by, u.full_name as waived_by_name, lb.waived_at, lb.waive_reason, lb.created_at
  from risk.limit_breach lb
  join risk.risk_limit l on l.limit_id = lb.limit_id
  join ops.portfolio p on p.portfolio_id = l.portfolio_id
  left join ref.issuer i on i.issuer_id = l.scope_issuer_id
  left join ref.bond b on b.bond_id = l.scope_bond_id
  left join ops.app_user u on u.user_id = lb.waived_by
"""
SORT = {
    "as_of": "as_of",
    "utilization_pct": "utilization_pct",
    "breach_id": "breach_id",
    "status": "status",
}


@router.get("", response_model=Page, summary="Нарушения и предупреждения по лимитам")
def list_breaches(
    conn: Conn,
    page: Annotated[PageParams, Depends(page_params)],
    portfolio_id: int | None = None,
    status: Literal["warning", "breach", "waived"] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    where, params = [], {}
    if portfolio_id is not None:
        where.append("portfolio_id = :pid")
        params["pid"] = portfolio_id
    if status:
        where.append("status = :status")
        params["status"] = status
    if date_from:
        where.append("as_of >= :df")
        params["df"] = date_from
    if date_to:
        where.append("as_of <= :dt")
        params["dt"] = date_to
    if page.sort is None:
        page.order = "desc"
    return paginate(conn, BASE, where, params, SORT, page, "as_of", "breach_id")


@router.get("/{breach_id}", summary="Нарушение")
def get_breach(breach_id: int, conn: Conn) -> dict:
    return fetch_one(
        conn, BASE + " where lb.breach_id = :id", {"id": breach_id}, "breach not found"
    )


@router.post(
    "/{breach_id}/waive", summary="Снять нарушение с обоснованием (роль risk_manager/admin)"
)
def waive(breach_id: int, body: WaiveIn, conn: Conn, user_id: UserId) -> dict:
    conn.execute(
        text("call risk.waive_breach(:id, :uid, :reason)"),
        {"id": breach_id, "uid": user_id, "reason": body.reason},
    )
    return fetch_one(conn, BASE + " where lb.breach_id = :id", {"id": breach_id})
