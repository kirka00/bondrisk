"""Журнал и производные остатки, история лимитов, рейтинг на дату: процедуры учёта — SECURITY DEFINER,
у роли приложения нет прямой записи в позиции и кассу, сверка остатков с журналами; лимит — цепочка
редакций (SCD2) с периодом [valid_from, valid_to) без пересечений; канонический рейтинг на дату оценки;
статус сделки всегда settled (отмена — встречной сделкой).

Revision ID: 0014
Revises: 0013
"""

import sys
from pathlib import Path

from alembic import op

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _sqlfile import run_sql  # noqa: E402

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql("schema/0014_ledger_history.sql")
    for f in ("030_ratings.sql", "040_valuation.sql", "050_limits.sql", "060_procedures.sql", "070_analytics.sql"):
        run_sql(f"functions/{f}", check_bodies=True)
    run_sql("triggers/010_trade.sql")
    # в представлении лимитов — редакции; матвью зависит только от снапшотов, но файл пересоздаёт оба
    op.execute("drop view if exists risk.v_limit_utilization")
    run_sql("views/010_views.sql")


def downgrade() -> None:
    raise NotImplementedError
