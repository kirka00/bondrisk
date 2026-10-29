from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import text

from bondrisk.api.deps import Conn
from bondrisk.api.queries import q
from bondrisk.api.routers._util import fetch_all, fetch_one, today_or

router = APIRouter(prefix="/reports", tags=["reports"])


def _pf(conn, portfolio_id: int) -> None:
    fetch_one(
        conn,
        "select 1 from ops.portfolio where portfolio_id = :id",
        {"id": portfolio_id},
        "portfolio not found",
    )


@router.get("/stress", summary="Стресс-сценарии (q04)")
def stress(
    portfolio_id: int, conn: Conn, as_of: date | None = None, holdings_date: date | None = None
) -> list[dict]:
    _pf(conn, portfolio_id)
    return fetch_all(
        conn,
        q("q04"),
        {"portfolio_id": portfolio_id, "as_of": today_or(as_of), "holdings_date": holdings_date},
    )


@router.get("/adv01", summary="ADV01 по рейтинговым бакетам (q03, по последнему снапшоту ≤ as_of)")
def adv01(portfolio_id: int, conn: Conn, as_of: date | None = None) -> list[dict]:
    _pf(conn, portfolio_id)
    return fetch_all(conn, q("q03"), {"portfolio_id": portfolio_id, "as_of": today_or(as_of)})


@router.get("/spreads", summary="G-спреды и средний кредитный спред (q05)")
def spreads(portfolio_id: int, conn: Conn, as_of: date | None = None) -> dict:
    _pf(conn, portfolio_id)
    rows = fetch_all(conn, q("q05"), {"portfolio_id": portfolio_id, "as_of": today_or(as_of)})
    return {"avg_spread_bp": rows[0]["avg_spread_bp"] if rows else None, "items": rows}


@router.get("/reinvestment-wall", summary="Стена реинвестирования (q09)")
def reinvestment_wall(
    portfolio_id: int,
    conn: Conn,
    as_of: date | None = None,
    months: Annotated[int, Query(ge=1, le=120)] = 18,
) -> dict:
    _pf(conn, portfolio_id)
    rows = fetch_all(
        conn, q("q09"), {"portfolio_id": portfolio_id, "as_of": today_or(as_of), "months": months}
    )
    return {"months": months, "share_pct": rows[0]["share_pct"] if rows else 0, "items": rows}


@router.get("/pnl", summary="Нереализованный P&L по позициям (q11)")
def pnl(portfolio_id: int, conn: Conn, as_of: date | None = None) -> list[dict]:
    _pf(conn, portfolio_id)
    return fetch_all(conn, q("q11"), {"portfolio_id": portfolio_id, "as_of": today_or(as_of)})


@router.get("/price-gaps", summary="Бумаги без котировки на дату и fallback (q08)")
def price_gaps(
    conn: Conn, as_of: date | None = None, portfolio_id: int | None = None
) -> list[dict]:
    return fetch_all(conn, q("q08"), {"as_of": today_or(as_of), "portfolio_id": portfolio_id})


@router.get("/rating-migrations", summary="История и миграции рейтингов (q10)")
def rating_migrations(
    conn: Conn, issuer_id: int | None = None, limit: Annotated[int, Query(ge=1, le=1000)] = 500
) -> list[dict]:
    return fetch_all(conn, q("q10"), {"issuer_id": issuer_id, "lim": limit})


@router.get("/positions-rank", summary="Позиции с рангом и долей (q01)")
def positions_rank(portfolio_id: int, conn: Conn, as_of: date | None = None) -> list[dict]:
    _pf(conn, portfolio_id)
    return fetch_all(conn, q("q01"), {"portfolio_id": portfolio_id, "as_of": today_or(as_of)})


@router.get("/by-currency", summary="Агрегаты по валютам (q02)")
def by_currency(portfolio_id: int, conn: Conn, as_of: date | None = None) -> list[dict]:
    _pf(conn, portfolio_id)
    return fetch_all(conn, q("q02"), {"portfolio_id": portfolio_id, "as_of": today_or(as_of)})


@router.get("/limit-coverage", summary="Эмитенты без лимита концентрации (q06)")
def limit_coverage(portfolio_id: int, conn: Conn, as_of: date | None = None) -> list[dict]:
    _pf(conn, portfolio_id)
    return fetch_all(conn, q("q06"), {"portfolio_id": portfolio_id, "as_of": today_or(as_of)})


@router.get("/pnl-attribution", summary="Экономический P&L: цена, сделки, купоны, курс (q13, §17)")
def pnl_attribution(
    portfolio_id: int,
    conn: Conn,
    date_from: date,
    date_to: date | None = None,
    bucket: Literal["day", "week", "month"] = "day",
) -> list[dict]:
    _pf(conn, portfolio_id)
    return fetch_all(
        conn,
        q("q13"),
        {
            "portfolio_id": portfolio_id,
            "date_from": date_from,
            "date_to": today_or(date_to),
            "bucket": bucket,
        },
    )


@router.get("/closed-positions", summary="Позиции, закрытые внутри периода (q14, §17)")
def closed_positions(
    portfolio_id: int, conn: Conn, date_from: date, date_to: date | None = None
) -> list[dict]:
    _pf(conn, portfolio_id)
    return fetch_all(
        conn,
        q("q14"),
        {"portfolio_id": portfolio_id, "date_from": date_from, "date_to": today_or(date_to)},
    )


@router.get("/fx-position", summary="Открытая валютная позиция и переоценка (q15, §18)")
def fx_position(portfolio_id: int, conn: Conn, as_of: date | None = None) -> list[dict]:
    _pf(conn, portfolio_id)
    return fetch_all(conn, q("q15"), {"portfolio_id": portfolio_id, "as_of": today_or(as_of)})


@router.get(
    "/fx-analytics", summary="Валютная часть: breakeven-курс, рублёвая доходность, carry (§22)"
)
def fx_analytics(
    portfolio_id: int,
    conn: Conn,
    as_of: date | None = None,
    horizon_years: Annotated[float, Query(gt=0, le=30)] = 1,
    rub_rate_pct: float | None = None,
) -> dict:
    _pf(conn, portfolio_id)
    d = today_or(as_of)
    p = {"p": portfolio_id, "d": d}
    return {
        "breakeven": fetch_all(conn, q("q16"), {"portfolio_id": portfolio_id, "as_of": d}),
        "scenarios": fetch_all(
            conn,
            "select * from risk.fx_return_scenarios(:p, :d, :h, :r)",
            {**p, "h": horizon_years, "r": rub_rate_pct},
        ),
        "carry": next(iter(fetch_all(conn, "select * from risk.cny_carry(:p, :d)", p)), None),
    }


@router.get("/summary", summary="Сводка риска по портфелям (материализованное представление)")
def summary(conn: Conn) -> list[dict]:
    return fetch_all(conn, text("select * from risk.mv_portfolio_risk order by code"))
