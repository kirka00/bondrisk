"""Потоки для доходности, дюрации, DM и Z-спреда — после даты расчётов T+2 (как и НКД): купон между сделкой
и расчётами получает продавец. Вырожденная биржевая доходность (≤ −50 %) не используется, DV01 без дюрации — NULL.

Revision ID: 0013
Revises: 0012
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import run_sql  # noqa: E402

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql("functions/020_bond_math.sql", check_bodies=True)


def downgrade() -> None:
    raise NotImplementedError
