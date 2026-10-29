"""Единое отображение ошибок СУБД в HTTP-ответы (контракт docs/api-contract.md)."""

import logging
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError

log = logging.getLogger("bondrisk.api")

BUSINESS_409 = {"BR001", "BR002", "BR003", "BR004", "BR006"}
FORBIDDEN_403 = {"BR005"}
# нарушения целостности и бизнес-правил данных — конфликт с состоянием БД
INTEGRITY_409 = {"23505", "23P01", "23514", "23503", "23001"}
# некорректный ввод, дошедший до СУБД: не тот формат/диапазон/даты, обязательное поле = null
INPUT_422 = {"22P02", "22003", "22007", "22008", "23502"}
RETRYABLE_409 = {"40001", "40P01"}
NOT_FOUND = {"BR404"}


def _message(exc: DBAPIError) -> str:
    orig = exc.orig
    diag = getattr(orig, "diag", None)
    msg = getattr(diag, "message_primary", None) or str(orig)
    msg = re.sub(r"^(ERROR|ОШИБКА):\s*", "", msg).split("\n")[0]
    return msg


def db_error_handler(_: Request, exc: DBAPIError) -> JSONResponse:
    sqlstate = getattr(exc.orig, "sqlstate", None) or ""
    detail = _message(exc)
    if sqlstate in FORBIDDEN_403:
        return JSONResponse(status_code=403, content={"detail": detail, "code": sqlstate})
    if sqlstate in INPUT_422:
        return JSONResponse(status_code=422, content={"detail": detail, "code": sqlstate})
    if sqlstate in BUSINESS_409 or sqlstate in INTEGRITY_409:
        return JSONResponse(status_code=409, content={"detail": detail, "code": sqlstate})
    if sqlstate in RETRYABLE_409:
        return JSONResponse(
            status_code=409, content={"detail": detail, "code": sqlstate, "retryable": True}
        )
    if sqlstate in NOT_FOUND:
        return JSONResponse(status_code=404, content={"detail": detail, "code": sqlstate})
    log.error("database error %s: %s", sqlstate, detail)
    return JSONResponse(status_code=500, content={"detail": "database error", "code": sqlstate})


class ApiError(Exception):
    """Ошибка приложения в том же формате, что и ошибки СУБД: {"detail", "code"}."""

    def __init__(self, status: int, detail: str, code: str | None = None) -> None:
        super().__init__(detail)
        self.status, self.detail, self.code = status, detail, code


def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    body = {"detail": exc.detail} | ({"code": exc.code} if exc.code else {})
    return JSONResponse(status_code=exc.status, content=body)


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DBAPIError, db_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
