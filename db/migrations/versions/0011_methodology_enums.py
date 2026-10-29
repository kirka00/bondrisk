"""Новые значения перечислений под методологию: книга лимитной политики (§16.2) и исторические стрессы (§13).

ALTER TYPE … ADD VALUE нельзя использовать в той же транзакции, где его добавили, поэтому значения
фиксируются отдельной миграцией в autocommit, до функций миграции 0012.

Revision ID: 0011
Revises: 0010
"""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

VALUES = {
    "risk.limit_metric": ("conc_portfolio", "credit_spread", "new_issuer_rating"),
    "risk.scenario_kind": ("fx_hist", "ofz_index", "equity_index"),
}


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for enum, values in VALUES.items():
            for v in values:
                op.execute(f"alter type {enum} add value if not exists '{v}'")


def downgrade() -> None:
    raise NotImplementedError
