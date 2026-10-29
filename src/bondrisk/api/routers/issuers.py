# ruff: noqa: E501  — длинные SQL-строки
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import text

from bondrisk.api.deps import ADMIN, Conn
from bondrisk.api.pagination import PageParams, page_params, paginate
from bondrisk.api.routers._util import build_update, clean_row, fetch_one
from bondrisk.api.schemas import IssuerIn, IssuerPatch, Page

router = APIRouter(prefix="/issuers", tags=["issuers"])

BASE = """
select i.issuer_id, i.name, i.short_name, i.inn, i.sector, i.country, i.is_sovereign, i.moex_emitter_id, i.created_at,
       (select count(*) from ref.bond b where b.issuer_id = i.issuer_id) as bonds_count
  from ref.issuer i
"""
SORT = {"name": "name", "issuer_id": "issuer_id", "sector": "sector", "bonds_count": "bonds_count"}


@router.get("", response_model=Page, summary="Список эмитентов")
def list_issuers(
    conn: Conn,
    page: Annotated[PageParams, Depends(page_params)],
    q: str | None = None,
    sector: str | None = None,
    is_sovereign: bool | None = None,
    inn: Annotated[str | None, Query(pattern=r"^\d{10}(\d{2})?$")] = None,
) -> dict:
    where, params = [], {}
    if q:
        where.append("(name ilike :q or short_name ilike :q)")
        params["q"] = f"%{q}%"
    if sector:
        where.append("sector = :sector")
        params["sector"] = sector
    if is_sovereign is not None:
        where.append("is_sovereign = :sov")
        params["sov"] = is_sovereign
    if inn:
        where.append("inn = :inn")
        params["inn"] = inn
    return paginate(conn, BASE, where, params, SORT, page, "name", "issuer_id")


@router.post("", status_code=201, summary="Создать эмитента", dependencies=[ADMIN])
def create_issuer(body: IssuerIn, conn: Conn) -> dict:
    row = (
        conn.execute(
            text("""
        insert into ref.issuer (name, short_name, inn, sector, country, is_sovereign, moex_emitter_id)
        values (:name, :short_name, :inn, :sector, :country, :is_sovereign, :moex_emitter_id)
        returning *"""),
            body.model_dump(),
        )
        .mappings()
        .one()
    )
    return clean_row(row)


@router.get("/{issuer_id}", summary="Эмитент")
def get_issuer(issuer_id: int, conn: Conn) -> dict:
    return fetch_one(conn, BASE + " where i.issuer_id = :id", {"id": issuer_id}, "issuer not found")


@router.patch("/{issuer_id}", summary="Изменить эмитента", dependencies=[ADMIN])
def patch_issuer(issuer_id: int, body: IssuerPatch, conn: Conn) -> dict:
    sql, params = build_update(
        "ref.issuer",
        "issuer_id",
        issuer_id,
        body.model_dump(exclude_unset=True),
        {"name", "short_name", "inn", "sector", "country", "is_sovereign"},
    )
    return fetch_one(conn, sql, params, "issuer not found")


@router.delete(
    "/{issuer_id}",
    status_code=204,
    summary="Удалить эмитента (RESTRICT при наличии выпусков)",
    dependencies=[ADMIN],
)
def delete_issuer(issuer_id: int, conn: Conn) -> Response:
    res = conn.execute(text("delete from ref.issuer where issuer_id = :id"), {"id": issuer_id})
    if res.rowcount == 0:
        fetch_one(conn, "select 1 where false", {}, "issuer not found")
    return Response(status_code=204)
