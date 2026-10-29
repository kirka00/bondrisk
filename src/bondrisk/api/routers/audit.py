from typing import Annotated

from fastapi import APIRouter, Depends

from bondrisk.api.deps import Conn
from bondrisk.api.pagination import PageParams, page_params, paginate
from bondrisk.api.schemas import Page

router = APIRouter(prefix="/audit", tags=["audit"])

BASE = """
select a.audit_id, a.table_name, a.op, a.row_pk, a.old_data, a.new_data, a.db_user, a.app_user_id,
       u.login as app_user_login, a.changed_at
  from audit.audit_log a left join ops.app_user u on u.user_id = a.app_user_id
"""
SORT = {"changed_at": "changed_at", "audit_id": "audit_id", "table_name": "table_name"}


@router.get("", response_model=Page, summary="Журнал изменений")
def list_audit(
    conn: Conn,
    page: Annotated[PageParams, Depends(page_params)],
    table: str | None = None,
    op: str | None = None,
    row_pk: str | None = None,
) -> dict:
    where, params = [], {}
    if table:
        where.append("table_name = :table")
        params["table"] = table
    if op:
        where.append("op = :op")
        params["op"] = op.upper()
    if row_pk:
        where.append("row_pk = :row_pk")
        params["row_pk"] = row_pk
    if page.sort is None:
        page.order = "desc"
    return paginate(conn, BASE, where, params, SORT, page, "changed_at", "audit_id")
