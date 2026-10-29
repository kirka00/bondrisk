"""Про-форма в лимитах и стресс-тесте: параметр даты состава у limit_facts и stress_pnl.

Revision ID: 0006
Revises: 0005
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import DB_DIR, run_sql  # noqa: E402

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql("schema/0006_proforma_reports.sql")
    for f in sorted((DB_DIR / "functions").glob("*.sql")):
        run_sql(f"functions/{f.name}")


def downgrade() -> None:
    raise NotImplementedError
