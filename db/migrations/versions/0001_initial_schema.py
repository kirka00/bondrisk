"""Схема v1: справочники, операции, временные ряды (обычные таблицы), риск, аудит, staging.

Revision ID: 0001
Revises:
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import run_sql  # noqa: E402

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql("schema/0001_initial.sql")
    run_sql("seed/0001_static.sql")


def downgrade() -> None:
    raise NotImplementedError("откат начальной схемы — пересоздание базы (docker compose down -v)")
