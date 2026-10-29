"""Приведение к методологии риск-дашборда (ред. 25.10.2026): ручные корректировки, касса на дату сделки,
книга лимитной политики, исторические стресс-сценарии, дисконтная маржа, Z-спред, P&L, ОВП, аналитика §22.

Revision ID: 0012
Revises: 0011
"""

import sys
from pathlib import Path

from alembic import op

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import DB_DIR, run_sql  # noqa: E402

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql("schema/0012_methodology.sql")
    for f in sorted((DB_DIR / "functions").glob("*.sql")):
        run_sql(f"functions/{f.name}", check_bodies=True)  # схема уже на месте
    # в сводку добавлены дисконтная маржа и доля флоутеров: матвью пересоздаётся
    op.execute("drop materialized view if exists risk.mv_portfolio_risk")
    run_sql("views/010_views.sql")


def downgrade() -> None:
    raise NotImplementedError
