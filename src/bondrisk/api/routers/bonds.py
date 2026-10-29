# ruff: noqa: E501  — длинные SQL-строки
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text

from bondrisk.api.deps import ADMIN, Conn
from bondrisk.api.pagination import PageParams, page_params, paginate
from bondrisk.api.queries import q
from bondrisk.api.routers._util import build_update, clean_row, fetch_all, fetch_one, today_or
from bondrisk.api.schemas import BondIn, BondPatch, Page

router = APIRouter(prefix="/bonds", tags=["bonds"])

BASE = """
select b.bond_id, b.isin, b.secid, b.short_name, b.full_name, b.issuer_id, i.name as issuer_name, i.sector,
       i.is_sovereign, b.currency, b.face_value_initial, b.coupon_type, b.coupon_rate_pct, b.coupon_freq,
       b.issue_date, b.maturity_date, b.offer_date, b.is_amortizing, b.board, b.list_level, b.status,
       r.grade as rating_grade, r.source as rating_source, r.agency_code as rating_agency,
       lp.close_pct as last_price_pct, lp.price_date as last_price_date
  from ref.bond b
  join ref.issuer i on i.issuer_id = b.issuer_id
  cross join lateral risk.canonical_rating(b.bond_id) r
  left join lateral (select ph.close_pct, ph.ts as price_date from ts.price_history ph
                      where ph.bond_id = b.bond_id and ph.close_pct is not null
                      order by ph.ts desc limit 1) lp on true
"""
SORT = {
    "maturity_date": "maturity_date",
    "short_name": "short_name",
    "isin": "isin",
    "bond_id": "bond_id",
    "coupon_rate_pct": "coupon_rate_pct",
    "issuer_name": "issuer_name",
    "rating_grade": "rating_grade",
}


@router.get("", response_model=Page, summary="Список выпусков")
def list_bonds(
    conn: Conn,
    page: Annotated[PageParams, Depends(page_params)],
    issuer_id: int | None = None,
    currency: str | None = None,
    coupon_type: Literal["fixed", "floating", "zero"] | None = None,
    status: str | None = None,
    board: str | None = None,
    q: str | None = None,
) -> dict:
    where, params = [], {}
    if q:
        where.append(
            "(isin ilike :q or secid ilike :q or short_name ilike :q or issuer_name ilike :q)"
        )
        params["q"] = f"%{q}%"
    for col, val in (
        ("issuer_id", issuer_id),
        ("currency", currency),
        ("coupon_type", coupon_type),
        ("status", status),
        ("board", board),
    ):
        if val is not None:
            where.append(f"{col} = :{col}")
            params[col] = val
    return paginate(conn, BASE, where, params, SORT, page, "maturity_date", "bond_id")


@router.post("", status_code=201, summary="Создать выпуск", dependencies=[ADMIN])
def create_bond(body: BondIn, conn: Conn) -> dict:
    row = conn.execute(
        text("""
        insert into ref.bond (isin, secid, issuer_id, short_name, full_name, currency, face_value_initial,
                              coupon_type, coupon_rate_pct, coupon_freq, issue_date, maturity_date, offer_date,
                              is_amortizing, board, list_level, status)
        values (:isin, :secid, :issuer_id, :short_name, :full_name, :currency, :face_value_initial,
                :coupon_type, :coupon_rate_pct, :coupon_freq, :issue_date, :maturity_date, :offer_date,
                :is_amortizing, :board, :list_level, :status)
        returning bond_id"""),
        body.model_dump(),
    ).scalar_one()
    return fetch_one(conn, BASE + " where b.bond_id = :id", {"id": row})


@router.get("/{bond_id}", summary="Выпуск")
def get_bond(bond_id: int, conn: Conn) -> dict:
    return fetch_one(conn, BASE + " where b.bond_id = :id", {"id": bond_id}, "bond not found")


@router.patch("/{bond_id}", summary="Изменить выпуск", dependencies=[ADMIN])
def patch_bond(bond_id: int, body: BondPatch, conn: Conn) -> dict:
    sql, params = build_update(
        "ref.bond",
        "bond_id",
        bond_id,
        body.model_dump(exclude_unset=True),
        {
            "short_name",
            "full_name",
            "coupon_type",
            "coupon_rate_pct",
            "coupon_freq",
            "maturity_date",
            "offer_date",
            "is_amortizing",
            "board",
            "list_level",
            "status",
        },
    )
    fetch_one(conn, sql, params, "bond not found")
    return fetch_one(conn, BASE + " where b.bond_id = :id", {"id": bond_id})


@router.delete(
    "/{bond_id}",
    status_code=204,
    summary="Удалить выпуск (RESTRICT при сделках/ценах)",
    dependencies=[ADMIN],
)
def delete_bond(bond_id: int, conn: Conn) -> Response:
    res = conn.execute(text("delete from ref.bond where bond_id = :id"), {"id": bond_id})
    if res.rowcount == 0:
        fetch_one(conn, "select 1 where false", {}, "bond not found")
    return Response(status_code=204)


@router.get("/{bond_id}/schedule", summary="График платежей")
def schedule(bond_id: int, conn: Conn) -> list[dict]:
    fetch_one(
        conn, "select bond_id from ref.bond where bond_id = :id", {"id": bond_id}, "bond not found"
    )
    return fetch_all(
        conn,
        """
        select flow_id, flow_type, lower(period) as period_start, upper(period) as period_end, pay_date,
               rate_pct, amount, face_value_after, source
          from ref.cash_flow_schedule where bond_id = :id order by pay_date, flow_type""",
        {"id": bond_id},
    )


@router.get(
    "/{bond_id}/metrics", summary="Метрики бумаги на дату (цена, НКД, YTM, дюрация, DV01, G-спред)"
)
def metrics(bond_id: int, conn: Conn, as_of: date | None = None) -> dict:
    d = today_or(as_of)
    fetch_one(
        conn, "select bond_id from ref.bond where bond_id = :id", {"id": bond_id}, "bond not found"
    )
    m = (
        conn.execute(text("select * from ref.bond_metrics(:id, :d)"), {"id": bond_id, "d": d})
        .mappings()
        .first()
    )
    r = (
        conn.execute(text("select * from risk.canonical_rating(:id)"), {"id": bond_id})
        .mappings()
        .one()
    )
    out: dict = {
        "bond_id": bond_id,
        "as_of": d,
        "rating": {"grade": r["grade"], "source": r["source"], "agency": r["agency_code"]},
    }
    if m is None:
        out.update({"clean_price_pct": None, "note": "нет котировки в окне 90 дней"})
        return out
    curve = conn.execute(
        text("select risk.curve_rate_at(:d, :dm)"), {"d": d, "dm": m["duration_mod"]}
    ).scalar()
    ytm_pct = m["ytm"] * 100 if m["ytm"] is not None else None
    out.update(clean_row(m))
    out["ytm_pct"] = ytm_pct
    out["curve_rate_pct"] = curve
    out["g_spread_bp"] = (
        round((ytm_pct - curve) * 100) if ytm_pct is not None and curve is not None else None
    )
    out.pop("ytm", None)
    return out


@router.get(
    "/{bond_id}/prices", summary="Ряд цен (день — hypertable; неделя/месяц — непрерывные агрегаты)"
)
def prices(
    bond_id: int,
    conn: Conn,
    bucket: Literal["day", "week", "month"] = "day",
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    _bond(conn, bond_id)
    to = today_or(date_to)
    frm = date_from or (to - timedelta(days=365))
    p = {"id": bond_id, "f": frm, "t": to}
    if bucket == "day":
        return fetch_all(
            conn,
            """
            select ts, close_pct, yield_close, volume, accrued_interest, duration_days
              from ts.price_history where bond_id = :id and ts between :f and :t order by ts""",
            p,
        )
    cagg = "ts.price_1w" if bucket == "week" else "ts.price_1m"
    rows = fetch_all(
        conn,
        f"""
        select bucket as ts, close_pct, avg_yield as yield_close, trading_days
          from {cagg} where bond_id = :id and bucket between :f and :t order by bucket""",
        p,
    )
    if rows:
        return rows
    # агрегат ещё не обновлён политикой — считаем по сырой таблице тем же time_bucket
    width = "1 week" if bucket == "week" else "1 month"
    return fetch_all(
        conn,
        f"""
        select time_bucket(interval '{width}', ts) as ts, last(close_pct, ts) as close_pct,
               avg(yield_close) as yield_close, count(*) as trading_days
          from ts.price_history where bond_id = :id and ts between :f and :t
         group by 1 order by 1""",
        p,
    )


def _bond(conn, bond_id: int) -> None:
    fetch_one(
        conn, "select bond_id from ref.bond where bond_id = :id", {"id": bond_id}, "bond not found"
    )


@router.get("/{bond_id}/ratings", summary="История рейтингов выпуска и его эмитента")
def ratings(bond_id: int, conn: Conn) -> list[dict]:
    fetch_one(
        conn, "select bond_id from ref.bond where bond_id = :id", {"id": bond_id}, "bond not found"
    )
    return fetch_all(
        conn,
        """
        select r.rating_id, a.code as agency, a.name as agency_name, r.grade, r.outlook, r.action, r.assigned_on,
               r.status, r.source, case when r.bond_id is not null then 'issue' else 'issuer' end as scope
          from ref.credit_rating r join ref.rating_agency a on a.agency_id = r.agency_id
         where r.bond_id = :id or r.issuer_id = (select issuer_id from ref.bond where bond_id = :id)
         order by r.assigned_on desc, r.rating_id desc""",
        {"id": bond_id},
    )


@router.get("/{bond_id}/dynamics", summary="Динамика цены: LAG, MA20, просадка (запрос q07)")
def dynamics(
    bond_id: int, conn: Conn, date_from: date | None = None, date_to: date | None = None
) -> list[dict]:
    _bond(conn, bond_id)
    to = today_or(date_to)
    return fetch_all(
        conn,
        q("q07"),
        {"bond_id": bond_id, "date_from": date_from or to - timedelta(days=365), "date_to": to},
    )


@router.get(
    "/{bond_id}/gapfill", summary="Календарный ряд с заполнением пропусков locf (запрос q08b)"
)
def gapfill(
    bond_id: int, conn: Conn, date_from: date | None = None, date_to: date | None = None
) -> list[dict]:
    _bond(conn, bond_id)
    to = today_or(date_to)
    return fetch_all(
        conn,
        q("q08b"),
        {"bond_id": bond_id, "date_from": date_from or to - timedelta(days=90), "date_to": to},
    )
