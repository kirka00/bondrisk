"""Хелперы загрузчика: журнал запусков, ошибки, COPY, пакетный upsert."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable, Sequence
from contextlib import contextmanager
from typing import Any

from sqlalchemy import Connection, text

from bondrisk.db.engine import connect

log = logging.getLogger("bondrisk.loader")


def _json(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, default=str)


class LoadRun:
    """Запись в stg.load_run + накопление ошибок в stg.load_error."""

    def __init__(self, source: str, params: dict[str, Any] | None = None) -> None:
        self.source = source
        self.params = params or {}
        self.ok = 0
        self.failed = 0
        with connect() as c:
            self.run_id = c.execute(
                text(
                    "insert into stg.load_run (source, params) values (:s, cast(:p as jsonb)) returning run_id"
                ),
                {"s": source, "p": _json(self.params)},
            ).scalar_one()

    def error(self, reason: str, payload: Any = None, conn: Connection | None = None) -> None:
        self.failed += 1
        log.warning("%s: %s", self.source, reason)
        sql = text(
            "insert into stg.load_error (run_id, source, payload, reason) "
            "values (:r, :s, cast(:p as jsonb), :reason)"
        )
        params = {"r": self.run_id, "s": self.source, "p": _json(payload), "reason": reason[:2000]}
        if conn is not None:
            conn.execute(sql, params)
        else:
            with connect() as c:
                c.execute(sql, params)

    def finish(self) -> None:
        with connect() as c:
            c.execute(
                text(
                    "update stg.load_run set finished_at = now(), rows_ok = :ok, rows_failed = :f "
                    "where run_id = :r"
                ),
                {"ok": self.ok, "f": self.failed, "r": self.run_id},
            )
        log.info("%s: ok=%d failed=%d (run %d)", self.source, self.ok, self.failed, self.run_id)


@contextmanager
def tx():
    """Транзакция приложения (роль app_rw)."""
    with connect() as c:
        yield c


def copy_rows(
    conn: Connection, table: str, columns: Sequence[str], rows: Iterable[Sequence[Any]]
) -> int:
    """COPY FROM STDIN через psycopg; возвращает число строк."""
    raw = conn.connection.driver_connection  # psycopg.Connection
    n = 0
    with raw.cursor() as cur, cur.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN") as cp:
        for row in rows:
            cp.write_row(row)
            n += 1
    return n


def scalar(sql: str, **params: Any) -> Any:
    with connect() as c:
        return c.execute(text(sql), params).scalar()


def rows(sql: str, **params: Any) -> list[dict[str, Any]]:
    with connect() as c:
        return [dict(r) for r in c.execute(text(sql), params).mappings()]


def execute(sql: str, **params: Any) -> int:
    with connect() as c:
        return c.execute(text(sql), params).rowcount
