"""Купоны, амортизация и погашения в кассе: ops.book_bond_flows, вызываемая из фактического EOD.

Revision ID: 0008
Revises: 0007
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import DB_DIR, run_sql  # noqa: E402

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for f in sorted((DB_DIR / "functions").glob("*.sql")):
        run_sql(f"functions/{f.name}")


def downgrade() -> None:
    raise NotImplementedError
