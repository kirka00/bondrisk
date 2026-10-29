"""Статус «погашен» у выпусков с прошедшей датой погашения; сделки по ним допустимы до погашения.

Revision ID: 0009
Revises: 0008
"""

import sys
from pathlib import Path

from alembic import op

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import run_sql  # noqa: E402

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql("triggers/010_trade.sql")
    op.execute(
        "update ref.bond set status = 'matured'"
        " where status = 'trading' and maturity_date < current_date"
    )


def downgrade() -> None:
    raise NotImplementedError
