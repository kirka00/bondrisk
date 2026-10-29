"""Изменение требований: флоутеры (1:1 floater_terms) и оферты (bond.offer_date).

Данные сохраняются.

Revision ID: 0002
Revises: 0001
"""

import sys
from pathlib import Path

from alembic import op

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import run_sql  # noqa: E402

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql("schema/0002_floaters_offers.sql")


def downgrade() -> None:
    op.execute("drop table ref.floater_terms")
    op.execute("alter table ref.bond drop column offer_date")
