"""Пагинация, сортировка и фильтры коллекций: только bind-параметры и белые списки полей."""
# ruff: noqa: E501  — длинные SQL-строки

from typing import Annotated, Any

from fastapi import HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Connection, text

from bondrisk.api.routers._util import clean_row


class PageParams(BaseModel):
    limit: int = 50
    offset: int = 0
    sort: str | None = None
    order: str = "asc"


def page_params(
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    sort: str | None = None,
    order: Annotated[str, Query(pattern="^(asc|desc)$")] = "asc",
) -> PageParams:
    return PageParams(limit=limit, offset=offset, sort=sort, order=order)


def paginate(
    conn: Connection,
    base_sql: str,
    where: list[str],
    params: dict[str, Any],
    sort_map: dict[str, str],
    page: PageParams,
    default_sort: str,
    pk: str,
) -> dict[str, Any]:
    """`base_sql` — подзапрос без ORDER BY; имена сортировки берутся только из sort_map.
    `pk` дописывается последним ключом: без уникального хвоста LIMIT/OFFSET по неуникальной колонке
    отдаёт строки на соседних страницах повторно, а часть строк не отдаёт вовсе."""
    sort_key = page.sort or default_sort
    if sort_key not in sort_map:
        raise HTTPException(422, f"sort must be one of {sorted(sort_map)}")
    direction = "desc" if page.order == "desc" else "asc"
    cols = [c.strip() for c in sort_map[sort_key].split(",")]
    if pk not in cols:
        cols.append(pk)
    order_by = ", ".join(f"{col} {direction}" for col in cols)
    where_sql = (" where " + " and ".join(where)) if where else ""
    total = conn.execute(
        text(f"select count(*) from ({base_sql}) q{where_sql}"), params
    ).scalar_one()
    rows = (
        conn.execute(
            text(
                f"select * from ({base_sql}) q{where_sql} order by {order_by} limit :_limit offset :_offset"
            ),
            {**params, "_limit": page.limit, "_offset": page.offset},
        )
        .mappings()
        .all()
    )
    return {
        "items": [clean_row(r) for r in rows],
        "total": total,
        "limit": page.limit,
        "offset": page.offset,
    }
