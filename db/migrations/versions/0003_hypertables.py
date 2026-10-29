"""Временные ряды → hypertables TimescaleDB (migrate_data), сжатие, непрерывные агрегаты.

Revision ID: 0003
Revises: 0002
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import run_sql  # noqa: E402

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql("schema/0003_hypertables.sql")


def downgrade() -> None:
    raise NotImplementedError("обратное преобразование hypertable → таблица не предусмотрено")
