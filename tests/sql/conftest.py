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
    f = create_fixture("SQLT")
    yield f
    drop_fixture("SQLT")
