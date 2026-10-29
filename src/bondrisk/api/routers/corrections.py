# ruff: noqa: E501  — длинные SQL-строки
"""Ручные корректировки риск-менеджмента (методология §2, §3, §19) и синонимы книги лимитов (§16.2)."""

from datetime import date

from fastapi import APIRouter, Response
from sqlalchemy import text

from bondrisk.api.deps import RISK, Conn, UserId
from bondrisk.api.routers._util import fetch_all, fetch_one
from bondrisk.api.schemas import CashAdjustmentIn, PriceOverrideIn, SynonymIn

router = APIRouter(tags=["corrections"])


@router.get("/price-overrides", summary="Корректировки цены, НКД и номинала исторических срезов")
def list_overrides(conn: Conn, bond_id: int | None = None) -> list[dict]:
    return fetch_all(
        conn,
        "select o.*, b.secid, b.short_name from risk.price_override o join ref.bond b using (bond_id)"
        " where cast(:b as bigint) is null or o.bond_id = :b order by o.as_of desc, o.bond_id",
        {"b": bond_id},
    )


@router.post(
    "/price-overrides", status_code=201, summary="Задать корректировку среза", dependencies=[RISK]
)
def put_override(body: PriceOverrideIn, conn: Conn, user_id: UserId) -> dict:
    fetch_one(
        conn, "select 1 from ref.bond where bond_id = :id", {"id": body.bond_id}, "bond not found"
    )
    return fetch_one(
        conn,
        """insert into risk.price_override (bond_id, as_of, clean_price_pct, accrued_interest, face_value, reason, created_by)
           values (:bond_id, :as_of, :clean_price_pct, :accrued_interest, :face_value, :reason, :uid)
           on conflict (bond_id, as_of) do update set clean_price_pct = excluded.clean_price_pct,
               accrued_interest = excluded.accrued_interest, face_value = excluded.face_value,
               reason = excluded.reason, created_by = excluded.created_by, created_at = now()
           returning *""",
        {**body.model_dump(), "uid": user_id},
    )


@router.delete(
    "/price-overrides/{bond_id}/{as_of}",
    status_code=204,
    summary="Снять корректировку среза",
    dependencies=[RISK],
)
def delete_override(bond_id: int, as_of: date, conn: Conn) -> Response:
    res = conn.execute(
        text("delete from risk.price_override where bond_id = :b and as_of = :d"),
        {"b": bond_id, "d": as_of},
    )
    if res.rowcount == 0:
        fetch_one(conn, "select 1 where false", {}, "override not found")
    return Response(status_code=204)


@router.get("/portfolios/{portfolio_id}/cash-adjustments", summary="Корректировки кассы")
def list_cash_adjustments(portfolio_id: int, conn: Conn) -> list[dict]:
    return fetch_all(
        conn,
        "select * from risk.cash_adjustment where portfolio_id = :p order by as_of nulls first, currency",
        {"p": portfolio_id},
    )


@router.post(
    "/portfolios/{portfolio_id}/cash-adjustments",
    status_code=201,
    summary="Целевой остаток кассы на дату или единый сдвиг по валюте",
    dependencies=[RISK],
)
def put_cash_adjustment(
    portfolio_id: int, body: CashAdjustmentIn, conn: Conn, user_id: UserId
) -> dict:
    fetch_one(
        conn,
        "select 1 from ops.portfolio where portfolio_id = :id",
        {"id": portfolio_id},
        "portfolio not found",
    )
    return fetch_one(
        conn,
        """insert into risk.cash_adjustment (portfolio_id, currency, as_of, target_balance, shift, reason, created_by)
           values (:p, :currency, :as_of, :target_balance, :shift, :reason, :uid)
           on conflict (portfolio_id, currency, as_of) do update set target_balance = excluded.target_balance,
               shift = excluded.shift, reason = excluded.reason, created_by = excluded.created_by, created_at = now()
           returning *""",
        {**body.model_dump(), "p": portfolio_id, "uid": user_id},
    )


@router.delete(
    "/cash-adjustments/{adjustment_id}",
    status_code=204,
    summary="Снять корректировку кассы",
    dependencies=[RISK],
)
def delete_cash_adjustment(adjustment_id: int, conn: Conn) -> Response:
    res = conn.execute(
        text("delete from risk.cash_adjustment where adjustment_id = :id"), {"id": adjustment_id}
    )
    if res.rowcount == 0:
        fetch_one(conn, "select 1 where false", {}, "adjustment not found")
    return Response(status_code=204)


@router.get("/synonyms", summary="Синонимы эмитентов и отраслей книги лимитов")
def list_synonyms(conn: Conn, kind: str | None = None) -> list[dict]:
    return fetch_all(
        conn,
        "select * from ref.name_synonym where cast(:k as text) is null or kind = :k order by kind, alias",
        {"k": kind},
    )


@router.post(
    "/synonyms",
    status_code=201,
    summary="Добавить синоним (хранится нормализованным)",
    dependencies=[RISK],
)
def put_synonym(body: SynonymIn, conn: Conn) -> dict:
    return fetch_one(
        conn,
        """insert into ref.name_synonym (kind, alias, canonical) values (:kind, ref.norm_name(:alias), ref.norm_name(:canonical))
           on conflict (kind, alias) do update set canonical = excluded.canonical returning *""",
        body.model_dump(),
    )


@router.delete(
    "/synonyms/{kind}/{alias}", status_code=204, summary="Удалить синоним", dependencies=[RISK]
)
def delete_synonym(kind: str, alias: str, conn: Conn) -> Response:
    res = conn.execute(
        text("delete from ref.name_synonym where kind = :k and alias = ref.norm_name(:a)"),
        {"k": kind, "a": alias},
    )
    if res.rowcount == 0:
        fetch_one(conn, "select 1 where false", {}, "synonym not found")
    return Response(status_code=204)
