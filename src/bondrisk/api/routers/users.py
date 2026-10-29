from fastapi import APIRouter

from bondrisk.api.deps import LOGIN_HEADER, Conn, UserId
from bondrisk.api.routers._util import fetch_all, fetch_one

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", summary="Пользователи системы (для выбора действующего лица)")
def list_users(conn: Conn) -> list[dict]:
    return fetch_all(
        conn, "select user_id, login, full_name, role, is_active from ops.app_user order by user_id"
    )


@router.get("/me", summary="Текущий пользователь; fixed — задан входом и не переключается")
def me(conn: Conn, user_id: UserId) -> dict:
    row = fetch_one(
        conn,
        "select user_id, login, full_name, role, is_active from ops.app_user where user_id = :u",
        {"u": user_id},
    )
    return {**row, "fixed": LOGIN_HEADER is not None}
