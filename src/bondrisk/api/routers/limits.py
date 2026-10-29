# ruff: noqa: E501  — длинные SQL-строки
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text

from bondrisk.api.deps import RISK, Conn, UserId
from bondrisk.api.pagination import PageParams, page_params, paginate
from bondrisk.api.routers._util import build_update, fetch_one, today_or
from bondrisk.api.schemas import LimitIn, LimitPatch, Page

router = APIRouter(prefix="/limits", tags=["limits"])

BASE = "select * from risk.v_limit_utilization"
SORT = {
    "limit_id": "limit_id",
    "metric": "metric",
    "portfolio_code": "portfolio_code",
    "valid_from": "valid_from",
}


@router.get("", response_model=Page, summary="Лимиты")
def list_limits(
    conn: Conn,
    page: Annotated[PageParams, Depends(page_params)],
    portfolio_id: int | None = None,
    metric: str | None = None,
    active: bool | None = None,
) -> dict:
    where, params = [], {}
    if portfolio_id is not None:
        where.append("portfolio_id = :pid")
        params["pid"] = portfolio_id
    if metric:
        where.append("metric = :metric")
        params["metric"] = metric
    if active is not None:
        cond = "(valid_from <= :today and (valid_to is null or valid_to >= :today))"
        where.append(cond if active else f"not {cond}")
        params["today"] = today_or(None)
    return paginate(conn, BASE, where, params, SORT, page, "limit_id", "limit_id")


@router.post("", status_code=201, summary="Создать лимит", dependencies=[RISK])
def create_limit(body: LimitIn, conn: Conn, user_id: UserId) -> dict:
    lid = conn.execute(
        text("""
        insert into risk.risk_limit (portfolio_id, metric, scope_issuer_id, scope_bond_id, scope_sector, side,
                                     threshold_abs, threshold_pct, warning_pct, is_hard, valid_from, valid_to, created_by,
                                     basis, pct_base, emission_share_pct, scope_name, committee, self_adjust_pct, min_grade)
        values (:portfolio_id, :metric, :scope_issuer_id, :scope_bond_id, :scope_sector, :side,
                :threshold_abs, :threshold_pct, :warning_pct, :is_hard, coalesce(:valid_from, current_date), :valid_to, :uid,
                :basis, :pct_base, :emission_share_pct, :scope_name, :committee, :self_adjust_pct, :min_grade)
        returning limit_id"""),
        {**body.model_dump(), "uid": user_id},
    ).scalar_one()
    return fetch_one(conn, BASE + " where limit_id = :id", {"id": lid})


@router.get("/{limit_id}", summary="Лимит")
def get_limit(limit_id: int, conn: Conn) -> dict:
    return fetch_one(conn, BASE + " where limit_id = :id", {"id": limit_id}, "limit not found")


@router.patch("/{limit_id}", summary="Изменить лимит", dependencies=[RISK])
def patch_limit(limit_id: int, body: LimitPatch, conn: Conn) -> dict:
    sql, params = build_update(
        "risk.risk_limit",
        "limit_id",
        limit_id,
        body.model_dump(exclude_unset=True),
        {
            "threshold_abs",
            "threshold_pct",
            "warning_pct",
            "is_hard",
            "side",
            "valid_to",
            "basis",
            "pct_base",
            "emission_share_pct",
            "min_grade",
        },
    )
    fetch_one(conn, sql, params, "limit not found")
    return fetch_one(conn, BASE + " where limit_id = :id", {"id": limit_id})


@router.delete(
    "/{limit_id}",
    status_code=204,
    summary="Удалить лимит (каскадно с историей нарушений)",
    dependencies=[RISK],
)
def delete_limit(limit_id: int, conn: Conn) -> Response:
    res = conn.execute(text("delete from risk.risk_limit where limit_id = :id"), {"id": limit_id})
    if res.rowcount == 0:
        fetch_one(conn, "select 1 where false", {}, "limit not found")
    return Response(status_code=204)
