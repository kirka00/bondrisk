from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter
from sqlalchemy import text

from bondrisk.api.deps import Conn
from bondrisk.api.routers._util import fetch_all, today_or

router = APIRouter(prefix="/market", tags=["market"])
MSK = timezone(timedelta(hours=3))


@router.get("/curve", summary="Кривая бескупонной доходности на дату")
def curve(conn: Conn, as_of: date | None = None) -> dict:
    d = today_or(as_of)
    cd = conn.execute(text("select risk.curve_date_at(:d)"), {"d": d}).scalar()
    points = (
        fetch_all(
            conn,
            "select tenor_years, rate_pct from ts.yield_curve where ts = :cd order by tenor_years",
            {"cd": cd},
        )
        if cd
        else []
    )
    return {"as_of": d, "curve_date": cd, "points": points}


@router.get("/fx", summary="Курсы валют к рублю на дату")
def fx(conn: Conn, as_of: date | None = None) -> list[dict]:
    return fetch_all(
        conn,
        """
        select distinct on (currency) currency, rate_rub, ts, source
          from ts.fx_rate where ts <= :d order by currency, ts desc""",
        {"d": today_or(as_of)},
    )


def expected_market_date(now: datetime) -> date:
    """Последний торговый день, итоги которого уже должны быть: сегодня после 21:00 МСК, иначе вчера
    (выходные пропускаются; праздники биржи не учитываются: отставание на день в праздник — норма).
    """
    d = now.date() if now.time() >= time(21, 0) else now.date() - timedelta(days=1)
    while d.isoweekday() > 5:
        d -= timedelta(days=1)
    return d


def _lag(d: date | None, expected: date) -> int | None:
    """Отставание в рабочих днях."""
    if d is None:
        return None
    n, cur = 0, d
    while cur < expected:
        cur += timedelta(days=1)
        n += cur.isoweekday() <= 5
    return n


@router.get(
    "/freshness",
    summary="Актуальность данных: до какой даты загружены ряды и когда было обновление",
)
def freshness(conn: Conn) -> dict:
    from bondrisk.loader.update import FRESHNESS_SQL

    r = conn.execute(text(FRESHNESS_SQL)).mappings().one()
    now = datetime.now(MSK)
    expected = expected_market_date(now)
    lag = _lag(r["prices"], expected)
    status = "unknown" if lag is None else "fresh" if lag == 0 else "late" if lag <= 2 else "stale"
    sources = [
        {"key": "prices", "name": "Котировки MOEX", "as_of": r["prices"], "lag_days": lag},
        {
            "key": "curve",
            "name": "Кривая КБД",
            "as_of": r["curve"],
            "lag_days": _lag(r["curve"], expected),
        },
        {"key": "fx", "name": "Курсы ЦБ РФ", "as_of": r["fx"], "lag_days": _lag(r["fx"], expected)},
        {
            "key": "eod",
            "name": "Расчёт риска (EOD)",
            "as_of": r["eod"],
            "lag_days": _lag(r["eod"], expected),
        },
        {"key": "ratings", "name": "Рейтинги агентств", "loaded_at": r["ratings_loaded_at"]},
        {
            "key": "reference",
            "name": "Справочник и графики платежей",
            "loaded_at": r["reference_loaded_at"],
        },
    ]
    return {
        "status": status,
        # дата оценки по умолчанию: есть и котировки, и кривая (КБД приходит раньше цен)
        "data_as_of": min((d for d in (r["prices"], r["curve"]) if d), default=None),
        "expected_as_of": expected,
        "updated_at": r["updated_at"],
        "last_update_errors": r["last_update_errors"],
        "sources": sources,
    }
