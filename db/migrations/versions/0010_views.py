"""Неиспользуемые представления удалены; risk.v_limit_utilization — источник GET /limits.

Revision ID: 0010
Revises: 0009
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import run_sql  # noqa: E402

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql("schema/0010_views.sql")
    run_sql("views/010_views.sql", optional=True)


def downgrade() -> None:
    raise NotImplementedError
