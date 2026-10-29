"""Про-форма: признак is_proforma у снапшотов, дата состава в функциях оценки, run_eod с ретроспективой.

Revision ID: 0005
Revises: 0004
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import DB_DIR, run_sql  # noqa: E402

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql("schema/0005_proforma.sql")
    for f in sorted((DB_DIR / "functions").glob("*.sql")):
        run_sql(f"functions/{f.name}")
    run_sql("schema/0005_proforma_views.sql")


def downgrade() -> None:
    raise NotImplementedError
