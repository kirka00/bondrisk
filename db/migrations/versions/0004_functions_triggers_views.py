"""Серверная логика: функции расчётного ядра, процедуры, триггеры, представления.

Revision ID: 0004
Revises: 0003
"""

import sys
from pathlib import Path

from alembic import op

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import DB_DIR, run_sql  # noqa: E402

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for sub in ("functions", "triggers", "views"):
        for f in sorted((DB_DIR / sub).glob("*.sql")):
            run_sql(f"{sub}/{f.name}", optional=sub == "views")
    op.execute("grant select on alembic_version to app_rw, app_ro")


def downgrade() -> None:
    raise NotImplementedError
