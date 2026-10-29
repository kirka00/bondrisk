import pytest
from sqlalchemy import text

from bondrisk.db.engine import connect
from tests._fixtures import Fixture, create_fixture, drop_fixture


@pytest.fixture(scope="session")
def fx() -> Fixture:
    try:
        with connect(admin=True) as c:
            c.execute(text("select 1"))
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"БД недоступна: {e}")
    f = create_fixture("CONC")
    yield f
    drop_fixture("CONC")


@pytest.fixture
def clean_position(fx):
    """Перед каждым сценарием: позиция 1000 шт. PAR, касса 10 млн, лимитов нет."""
    with connect(admin=True) as c:
        c.execute(text("alter table ops.trade disable trigger trade_immutable"))
        c.execute(
            text(
                "delete from risk.limit_breach where limit_id in (select limit_id from risk.risk_limit where portfolio_id = :p)"
            ),
            {"p": fx.portfolio},
        )
        c.execute(text("delete from risk.risk_limit where portfolio_id = :p"), {"p": fx.portfolio})
        c.execute(
            text(
                "delete from ops.cash_movement where cash_account_id in (select cash_account_id from ops.cash_account where portfolio_id = :p)"
            ),
            {"p": fx.portfolio},
        )
        c.execute(text("delete from ops.trade where portfolio_id = :p"), {"p": fx.portfolio})
        c.execute(text("alter table ops.trade enable trigger trade_immutable"))
        c.execute(text("delete from ops.position where portfolio_id = :p"), {"p": fx.portfolio})
        c.execute(
            text("update ops.cash_account set balance = 0 where portfolio_id = :p"),
            {"p": fx.portfolio},
        )
        c.execute(
            text("call ops.deposit_cash(:p, 'RUB', 10000000, :u)"),
            {"p": fx.portfolio, "u": fx.user_trader},
        )
        c.execute(
            text("select ops.execute_trade_fn(:p, :b, 'buy', 1000, 100, :u, '2035-10-25'::date)"),
            {"p": fx.portfolio, "b": fx.bond_par, "u": fx.user_trader},
        )
    return fx
