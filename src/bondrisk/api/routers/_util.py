"""Общие помощники роутеров."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import Connection, text


def clean_row(row: Any) -> dict:
    """numeric → float, чтобы JSON отдавал числа, а не строки."""
    return {k: (float(v) if isinstance(v, Decimal) else v) for k, v in dict(row).items()}


def fetch_one(
    conn: Connection, sql: str, params: dict[str, Any], not_found: str = "not found"
) -> dict:
    row = conn.execute(text(sql), params).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail=not_found)
    return clean_row(row)


def fetch_all(conn: Connection, sql: Any, params: dict[str, Any] | None = None) -> list[dict]:
    stmt = text(sql) if isinstance(sql, str) else sql
    return [clean_row(r) for r in conn.execute(stmt, params or {}).mappings().all()]


def build_update(
    table: str, pk: str, pk_value: Any, data: dict[str, Any], allowed: set[str]
) -> tuple[str, dict]:
    """UPDATE только по белому списку колонок; значения — bind-параметры."""
    cols = {k: v for k, v in data.items() if k in allowed}
    if not cols:
        raise HTTPException(status_code=422, detail="nothing to update")
    sets = ", ".join(f"{k} = :{k}" for k in cols)
    return f"update {table} set {sets} where {pk} = :_pk returning *", {**cols, "_pk": pk_value}


MARKET_TZ = ZoneInfo("Europe/Moscow")


def today_or(d: date | None) -> date:
    """«Сегодня» — по московскому времени биржи: контейнер живёт в UTC, и с 00:00 до 03:00 МСК
    date.today() вернул бы вчерашнюю дату для сделок, EOD и отчётов."""
    return d or datetime.now(MARKET_TZ).date()
