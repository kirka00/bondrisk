"""Исправления целостности: снятие нарушений, неизменяемость сделок, шорт в триггере, НКД без графика, права аудита.

Revision ID: 0007
Revises: 0006
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import DB_DIR, run_sql  # noqa: E402

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql("schema/0007_integrity_fixes.sql")
    for f in sorted((DB_DIR / "functions").glob("*.sql")):
        run_sql(f"functions/{f.name}")
    run_sql("triggers/010_trade.sql")


def downgrade() -> None:
    raise NotImplementedError
