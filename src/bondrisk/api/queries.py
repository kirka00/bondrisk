"""Аналитические SQL-запросы читаются из db/queries/*.sql (кэш в памяти)."""

from functools import lru_cache
from pathlib import Path

from sqlalchemy import TextClause, text

QUERIES_DIR = Path(__file__).resolve().parents[3] / "db" / "queries"


@lru_cache
def _load(name: str) -> str:
    matches = sorted(QUERIES_DIR.glob(f"{name}_*.sql")) or sorted(QUERIES_DIR.glob(f"{name}.sql"))
    if not matches:
        raise FileNotFoundError(f"query {name} not found in {QUERIES_DIR}")
    return matches[0].read_text(encoding="utf-8")


def q(name: str) -> TextClause:
    """q('q03') → текст запроса db/queries/q03_*.sql как TextClause."""
    return text(_load(name))
