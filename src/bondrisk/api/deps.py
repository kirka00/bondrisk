"""Зависимости FastAPI: транзакция на запрос, пользователь из X-User-Id и проверка роли.

На сервере (docker-compose.prod.yml) пользователя определяет вход по логину и паролю в Caddy:
прокси передаёт логин в заголовке BONDRISK_AUTH_LOGIN_HEADER, а X-User-Id не учитывается."""

from collections.abc import Callable, Iterator
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, Header
from pydantic import BaseModel
from sqlalchemy import Connection, text

from bondrisk.api.errors import ApiError
from bondrisk.db.engine import get_engine
from bondrisk.settings import get_settings


class User(BaseModel):
    user_id: int
    role: str


def _user_from_header(x_user_id: Annotated[int, Header(alias="X-User-Id", ge=1)]) -> int:
    """Заголовок обязателен: без него запрос не «становится» администратором по умолчанию."""
    return x_user_id


@lru_cache(maxsize=64)
def _login_to_id(login: str) -> int | None:
    with get_engine().connect() as conn:
        return conn.execute(
            text("select user_id from ops.app_user where login = :l"), {"l": login}
        ).scalar()


LOGIN_HEADER = get_settings().auth_login_header


def _user_from_login(login: Annotated[str, Header(alias=LOGIN_HEADER or "X-Auth-Login")]) -> int:
    """Логин уже проверен прокси; неизвестный логин — 401, а не подмена пользователем 1."""
    user_id = _login_to_id(login)
    if user_id is None:
        raise ApiError(401, "unknown user")
    return user_id


get_user_id = _user_from_login if LOGIN_HEADER else _user_from_header


def get_conn(user_id: Annotated[int, Depends(get_user_id)]) -> Iterator[Connection]:
    """Одна транзакция на запрос; в сессии выставляется пользователь для аудита.
    Подключается с scope="function" (см. Conn): COMMIT выполняется до отправки ответа, поэтому
    ошибка фиксации не превращается в «201 Created» у клиента."""
    with get_engine().begin() as conn:
        active = conn.execute(
            text(
                "select is_active, set_config('bondrisk.user_id', :uid, true)"
                " from ops.app_user where user_id = cast(:uid as bigint)"
            ),
            {"uid": str(user_id)},
        ).scalar()
        if active is None:
            raise ApiError(401, "unknown user")
        if not active:
            raise ApiError(403, "user is inactive", "BR005")
        yield conn


Conn = Annotated[Connection, Depends(get_conn, scope="function")]
UserId = Annotated[int, Depends(get_user_id)]


def get_user(conn: Conn, user_id: UserId) -> User:
    """Роль текущего пользователя; существование и активность уже проверены в get_conn."""
    role = conn.execute(
        text("select role::text from ops.app_user where user_id = :u"), {"u": user_id}
    ).scalar_one()
    return User(user_id=user_id, role=role)


CurrentUser = Annotated[User, Depends(get_user)]


def require(*roles: str) -> Callable[[User], User]:
    """Зависимость маршрута: пускает только перечисленные роли (администратор — всегда)."""

    def check(user: CurrentUser) -> User:
        if user.role != "admin" and user.role not in roles:
            raise ApiError(403, f"role {user.role} is not allowed here", "BR005")
        return user

    return check


TRADER = Depends(require("trader"))
RISK = Depends(require("risk_manager"))
OPERATOR = Depends(require("trader", "risk_manager"))
ADMIN = Depends(require())
