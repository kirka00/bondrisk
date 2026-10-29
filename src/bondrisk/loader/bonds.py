"""Справочники: эмитенты, выпуски, графики платежей (MOEX ISS)."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import text

from bondrisk.loader.db import LoadRun, rows, tx
from bondrisk.loader.moex import MoexClient

log = logging.getLogger("bondrisk.bonds")

MINFIN = {
    "name": "Минфин России",
    "inn": "7710168360",
    "sector": "Государственные",
    "is_sovereign": True,
}
CUR = {"SUR": "RUB", "RUB": "RUB", "USD": "USD", "EUR": "EUR", "CNY": "CNY"}
FX_APPROX = {"RUB": 1.0, "USD": 80.0, "EUR": 90.0, "CNY": 11.0}
EXCLUDE_TYPES = ("Структурная", "Линкер", "индексируемым")
EXCLUDE_WORDS = ("суборд", "сфо ", "ипотеч", "иос", "структ", "бессроч")


def _d(v: Any) -> date | None:
    if not v or v in ("0000-00-00",):
        return None
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _freq(period_days: Any) -> int:
    if not period_days:
        return 2
    f = round(365 / float(period_days))
    return min((1, 2, 3, 4, 6, 12), key=lambda x: abs(x - f))


def _valid_isin(isin: str | None) -> bool:
    return bool(isin) and len(isin) == 12 and isin[:2].isalpha() and isin[-1].isdigit()


def select_bonds(client: MoexClient, boards: list[str], max_corporate: int) -> list[dict[str, Any]]:
    today = date.today()
    chosen: list[dict[str, Any]] = []
    corporate: list[dict[str, Any]] = []
    for board in boards:
        for s in client.board_bonds(board):
            if not _valid_isin(s.get("ISIN")):
                continue
            cur = CUR.get(s.get("FACEUNIT") or "")
            mat = _d(s.get("MATDATE"))
            if cur is None or mat is None or mat < today + timedelta(days=90):
                continue
            btype = s.get("BONDTYPE") or ""
            if s["SECID"].startswith("SU") and board == "TQOB":
                if not any(w in btype for w in EXCLUDE_TYPES):  # ОФЗ-ИН (линкеры) вне контура
                    chosen.append(s)
                continue
            name = f"{s.get('SHORTNAME') or ''} {s.get('SECNAME') or ''}".lower()
            if any(w in btype for w in EXCLUDE_TYPES) or any(w in name for w in EXCLUDE_WORDS):
                continue
            if s.get("BONDSUBTYPE") == "Бессрочные" or not s.get("PREVPRICE"):
                continue
            prev = _d(s.get("PREVDATE"))
            if prev is None or prev < today - timedelta(days=14):
                continue
            size_rub = (
                float(s.get("ISSUESIZE") or 0) * float(s.get("FACEVALUE") or 0) * FX_APPROX[cur]
            )
            s["_liq"] = (float(s.get("VALTODAY") or 0) > 0, float(s.get("VALTODAY") or 0), size_rub)
            s["_cur"] = cur
            corporate.append(s)
    corporate.sort(key=lambda s: (s["_liq"][0], s["_liq"][1], s["_liq"][2]), reverse=True)
    fx = [s for s in corporate if s["_cur"] != "RUB"][:25]
    rub = [s for s in corporate if s["_cur"] == "RUB"]
    chosen.extend(fx)
    chosen.extend(rub[: max(0, max_corporate - len(fx))])
    return chosen


def load_bonds(boards: list[str], max_corporate: int) -> None:
    run = LoadRun("load bonds", {"boards": boards, "max_corporate": max_corporate})
    client = MoexClient()
    selected = select_bonds(client, boards, max_corporate)
    log.info("selected %d bonds", len(selected))
    index = client.securities_index()
    for s in selected:
        secid = s["SECID"]
        try:
            desc = client.description(secid)
        except Exception as e:  # noqa: BLE001
            run.error(f"description failed: {e}", {"secid": secid})
            continue
        cur = CUR[s["FACEUNIT"]]
        sovereign = secid.startswith("SU") and s["BOARD"] == "TQOB"
        idx = index.get(s["ISIN"]) or {}
        issuer = (
            MINFIN
            if sovereign
            else {
                "name": idx.get("emitent_title") or s.get("SECNAME") or s["SHORTNAME"],
                "inn": (idx.get("emitent_inn") or None),
                "sector": "Прочее",
                "is_sovereign": False,
            }
        )
        issuer["moex_emitter_id"] = (
            int(idx.get("emitent_id") or desc.get("EMITTER_ID") or 0) or None
        )
        if issuer["inn"] is not None and not str(issuer["inn"]).isdigit():
            issuer["inn"] = None
        face_init = float(desc.get("INITIALFACEVALUE") or s.get("FACEVALUE") or 1000)
        is_amort = "Амортизируемая" in (s.get("BONDTYPE") or "")
        offer = _d(s.get("PUTOPTIONDATE")) or (
            _d(s.get("OFFERDATE")) if "put" in (s.get("BONDSUBTYPE") or "") else None
        )
        if offer and offer <= date.today():
            offer = None
        coupon_rate = s.get("COUPONPERCENT")
        coupon_type = "floating" if "плавающим" in (s.get("BONDTYPE") or "") else "fixed"
        freq = int(desc.get("COUPONFREQUENCY") or 0) or _freq(s.get("COUPONPERIOD"))
        if freq not in (1, 2, 3, 4, 6, 12):
            freq = _freq(s.get("COUPONPERIOD"))
        bond = {
            "isin": s["ISIN"],
            "secid": secid,
            "short_name": s["SHORTNAME"],
            "full_name": s.get("SECNAME"),
            "currency": cur,
            "face": face_init,
            "coupon_type": coupon_type,
            "coupon_rate": coupon_rate,
            "freq": freq,
            "issue_date": _d(desc.get("ISSUEDATE")),
            "maturity": _d(s["MATDATE"]),
            "is_amort": is_amort,
            "board": s["BOARD"],
            "list_level": int(s["LISTLEVEL"]) if s.get("LISTLEVEL") else None,
            "offer": offer,
            "issue_size": int(float(s["ISSUESIZE"])) if s.get("ISSUESIZE") else None,
        }
        try:
            with tx() as c:
                upsert_bond(c, bond, issuer)
            run.ok += 1
        except Exception as e:  # noqa: BLE001
            run.error(f"bond upsert failed: {e}", bond)
    run.finish()


BOND_UPSERT_SQL = text(
    """
    insert into ref.bond (isin, secid, issuer_id, short_name, full_name, currency, face_value_initial,
        coupon_type, coupon_rate_pct, coupon_freq, issue_date, maturity_date, is_amortizing, board,
        list_level, offer_date, issue_size, status)
    values (:isin, :secid, :issuer_id, :short_name, :full_name, :currency, :face,
        cast(:coupon_type as ref.coupon_type), :coupon_rate, :freq, :issue_date, :maturity, :is_amort,
        :board, :list_level, :offer, :issue_size,
        case when cast(:maturity as date) < current_date then 'matured' else 'trading' end::ref.bond_status)
    on conflict (isin) do update set
        secid = excluded.secid, issuer_id = excluded.issuer_id, short_name = excluded.short_name,
        full_name = excluded.full_name, currency = excluded.currency,
        face_value_initial = excluded.face_value_initial, coupon_rate_pct = excluded.coupon_rate_pct,
        coupon_freq = excluded.coupon_freq, issue_date = excluded.issue_date,
        maturity_date = excluded.maturity_date, is_amortizing = excluded.is_amortizing,
        board = excluded.board, list_level = excluded.list_level, offer_date = excluded.offer_date,
        issue_size = coalesce(excluded.issue_size, ref.bond.issue_size),
        status = case when excluded.maturity_date < current_date then 'matured'::ref.bond_status
                      else ref.bond.status end
    returning bond_id
    """
)


def upsert_bond(c, bond: dict[str, Any], issuer: dict[str, Any]) -> int:
    """Upsert эмитента и выпуска; возвращает bond_id."""
    issuer_id = upsert_issuer(c, issuer)
    return c.execute(BOND_UPSERT_SQL, {**bond, "issuer_id": issuer_id}).scalar()


def bond_from_description(
    secid: str, desc: dict[str, str], board: str, index: dict[str, Any] | None
) -> tuple[dict, dict] | None:
    """Параметры выпуска и эмитента только по карточке `iss/securities/{secid}` (для бумаг вне досок TQOB/TQCB)."""
    cur = CUR.get(desc.get("FACEUNIT") or "")
    mat = _d(desc.get("MATDATE"))
    btype = desc.get("BOND_TYPE") or ""
    if cur is None or mat is None or any(w in btype for w in EXCLUDE_TYPES):
        return None
    sovereign = (desc.get("TYPENAME") or "").startswith("Государственная") or secid.startswith("SU")
    idx = index or {}
    issuer = (
        dict(MINFIN)
        if sovereign
        else {
            "name": idx.get("emitent_title") or desc.get("NAME") or desc.get("SHORTNAME") or secid,
            "inn": (idx.get("emitent_inn") or None),
            "sector": "Прочее",
            "is_sovereign": False,
        }
    )
    issuer["moex_emitter_id"] = int(idx.get("emitent_id") or desc.get("EMITTER_ID") or 0) or None
    if issuer.get("inn") is not None and not str(issuer["inn"]).isdigit():
        issuer["inn"] = None
    freq = int(desc.get("COUPONFREQUENCY") or 0)
    if freq not in (1, 2, 3, 4, 6, 12):
        freq = 2
    bond = {
        "isin": desc.get("ISIN"),
        "secid": secid,
        "short_name": desc.get("SHORTNAME") or secid,
        "full_name": desc.get("NAME"),
        "currency": cur,
        "face": float(desc.get("INITIALFACEVALUE") or desc.get("FACEVALUE") or 1000),
        "coupon_type": "floating" if "плавающим" in btype else "fixed",
        "coupon_rate": float(desc["COUPONPERCENT"]) if desc.get("COUPONPERCENT") else None,
        "freq": freq,
        "issue_date": _d(desc.get("ISSUEDATE")),
        "maturity": mat,
        "is_amort": "Амортизируемая" in btype,
        "board": board,
        "list_level": int(desc["LISTLEVEL"]) if desc.get("LISTLEVEL") else None,
        "offer": None,
        "issue_size": int(float(desc["ISSUESIZE"])) if desc.get("ISSUESIZE") else None,
    }
    if not _valid_isin(bond["isin"]):
        return None
    return bond, issuer


def upsert_issuer(c, issuer: dict[str, Any]) -> int:
    if issuer.get("inn"):
        row = c.execute(
            text(
                """
                insert into ref.issuer (name, inn, sector, is_sovereign, moex_emitter_id)
                values (:name, :inn, :sector, :is_sovereign, :moex_emitter_id)
                on conflict (inn) do update set name = excluded.name,
                    moex_emitter_id = coalesce(ref.issuer.moex_emitter_id, excluded.moex_emitter_id)
                returning issuer_id
                """
            ),
            {
                k: issuer.get(k)
                for k in ("name", "inn", "sector", "is_sovereign", "moex_emitter_id")
            },
        ).scalar()
        return row
    key_sql = (
        "select issuer_id from ref.issuer where moex_emitter_id = :m"
        if issuer.get("moex_emitter_id")
        else "select issuer_id from ref.issuer where name = :name"
    )
    found = c.execute(
        text(key_sql), {"m": issuer.get("moex_emitter_id"), "name": issuer["name"]}
    ).scalar()
    if found:
        return found
    return c.execute(
        text(
            "insert into ref.issuer (name, sector, is_sovereign, moex_emitter_id) "
            "values (:name, :sector, :is_sovereign, :moex_emitter_id) returning issuer_id"
        ),
        {k: issuer.get(k) for k in ("name", "sector", "is_sovereign", "moex_emitter_id")},
    ).scalar()


# ---------------------------------------------------------------- графики платежей
FLOATER_WORDS = ("пк", "флоат", "кс+", "ruonia", "кс ", "flo")


def _is_floater(coupons: list[dict[str, Any]], name: str, declared: str) -> bool:
    """Признак флоутера в порядке методологии (§8).
    1. История купонов: ставка менялась между смежными прошедшими периодами не менее двух раз и не менее
       чем в 40 % переходов (|Δc| > 0,05 п.п.); ступенчатый купон и переустановка по оферте (одна-две
       ступени) флоутером не считаются. При недостатке истории (меньше трёх прошедших периодов) признак
       не определяется — следующий источник.
    2. Справочник выпусков (тип купона MOEX).
    3. Упрощённое правило: разброс ставок по всему графику, включая будущие периоды, больше 0,01 п.п.,
       либо признаки плавающей ставки в наименовании."""
    today = date.today().isoformat()
    rates = [
        float(c["valueprc"])
        for c in coupons
        if c.get("coupondate") and c["coupondate"] <= today and c.get("valueprc") is not None
    ]
    if len(rates) >= 3:
        changes = sum(1 for a, b in zip(rates, rates[1:], strict=False) if abs(a - b) > 0.05)
        return changes >= 2 and changes / (len(rates) - 1) >= 0.4
    if declared == "floating":
        return True
    known = [float(c["valueprc"]) for c in coupons if c.get("valueprc") is not None]
    if known and max(known) - min(known) > 0.01:
        return True
    return any(w in name.lower() for w in FLOATER_WORDS)


def load_schedules(secids: list[str] | None = None) -> None:
    run = LoadRun("load schedules")
    client = MoexClient()
    with tx() as c:
        bonds = [
            dict(r)
            for r in c.execute(
                text(
                    "select bond_id, secid, isin, short_name, full_name, issue_date, coupon_type, coupon_freq, "
                    "face_value_initial, coupon_rate_pct from ref.bond where status = 'trading'"
                    + (" and secid = any(:s)" if secids else "")
                ),
                {"s": secids},
            ).mappings()
        ]
    for i, b in enumerate(bonds, 1):
        try:
            data = client.bondization(b["secid"])
        except Exception as e:  # noqa: BLE001
            run.error(f"bondization failed: {e}", {"secid": b["secid"]})
            continue
        coupons = sorted(
            (x for x in data["coupons"] if x.get("coupondate")), key=lambda x: x["coupondate"]
        )
        rows: list[dict[str, Any]] = []
        prev_end: date | None = b["issue_date"]
        for cp in coupons:
            end = _d(cp["coupondate"])
            start = _d(cp.get("startdate")) or prev_end
            if end is None or start is None or start >= end:
                start = (
                    (end - timedelta(days=round(365 / (b["coupon_freq"] or 2)))) if end else None
                )
            if end is None or start is None:
                continue
            rows.append(
                {
                    "flow_type": "coupon",
                    "p_start": start,
                    "p_end": end,
                    "pay_date": end,
                    "rate_pct": cp.get("valueprc"),
                    "amount": cp.get("value"),
                    "face_after": None,
                }
            )
            prev_end = end
        has_amort = False
        for am in data["amortizations"]:
            d = _d(am.get("amortdate"))
            if d is None or am.get("value") is None:
                continue
            is_mat = am.get("data_source") == "maturity"
            has_amort = has_amort or not is_mat
            rows.append(
                {
                    "flow_type": "redemption" if is_mat else "amortization",
                    "p_start": None,
                    "p_end": None,
                    "pay_date": d,
                    "rate_pct": None,
                    "amount": am["value"],
                    "face_after": (float(am["facevalue"]) - float(am["value"]))
                    if am.get("facevalue")
                    else None,
                }
            )
        for of in data["offers"]:
            d = _d(of.get("offerdate"))
            otype = (of.get("offertype") or "").lower()
            if d is None or "call" in otype:
                continue
            rows.append(
                {
                    "flow_type": "offer",
                    "p_start": None,
                    "p_end": None,
                    "pay_date": d,
                    "rate_pct": None,
                    "amount": None,
                    "face_after": None,
                }
            )
        name = f"{b['short_name']} {b['full_name'] or ''}"
        floater = _is_floater(coupons, name, b["coupon_type"])
        all_zero = (
            coupons
            and all((cp.get("valueprc") or 0) == 0 for cp in coupons)
            and not (b["coupon_rate_pct"] or 0)
        )
        ctype = "floating" if floater else ("zero" if all_zero else "fixed")
        try:
            with tx() as c:
                c.execute(
                    text("delete from ref.cash_flow_schedule where bond_id = :b"),
                    {"b": b["bond_id"]},
                )
                for r in rows:
                    c.execute(
                        text(
                            """
                            insert into ref.cash_flow_schedule (bond_id, flow_type, period, pay_date, rate_pct, amount, face_value_after)
                            values (:bond_id, cast(:flow_type as ref.flow_type),
                                    case when cast(:p_start as date) is null then null else daterange(cast(:p_start as date), cast(:p_end as date), '[)') end,
                                    :pay_date, :rate_pct, :amount, :face_after)
                            on conflict (bond_id, flow_type, pay_date) do update
                                set period = excluded.period, rate_pct = excluded.rate_pct, amount = excluded.amount,
                                    face_value_after = excluded.face_value_after
                            """
                        ),
                        {**r, "bond_id": b["bond_id"]},
                    )
                if (
                    ctype != "floating"
                ):  # условия флоутера снимаются до смены типа купона (правило П5)
                    c.execute(
                        text("delete from ref.floater_terms where bond_id = :b"),
                        {"b": b["bond_id"]},
                    )
                c.execute(
                    text(
                        "update ref.bond set coupon_type = cast(:t as ref.coupon_type), is_amortizing = :a, "
                        "coupon_rate_pct = case when :t = 'zero' then null else coupon_rate_pct end "
                        "where bond_id = :b"
                    ),
                    {"t": ctype, "a": has_amort, "b": b["bond_id"]},
                )
                if ctype == "floating":
                    ref_rate = "RUONIA" if b["secid"].startswith("SU") else "KEY_RATE"
                    c.execute(
                        text(
                            "insert into ref.floater_terms (bond_id, reference_rate, reset_period_months) "
                            "values (:b, :r, :m) on conflict (bond_id) do update set reference_rate = excluded.reference_rate"
                        ),
                        {
                            "b": b["bond_id"],
                            "r": ref_rate,
                            "m": {1: 12, 2: 6, 4: 3, 12: 1}.get(b["coupon_freq"], 3),
                        },
                    )
                else:
                    c.execute(
                        text("delete from ref.floater_terms where bond_id = :b"),
                        {"b": b["bond_id"]},
                    )
            run.ok += 1
        except Exception as e:  # noqa: BLE001
            run.error(
                f"schedule failed: {str(e).splitlines()[0]}",
                {"secid": b["secid"], "rows": len(rows)},
            )
        if i % 50 == 0:
            log.info("schedules: %d/%d", i, len(bonds))
    run.finish()


def backfill_issue_size() -> int:
    """Объём выпуска в штуках (ISSUESIZE) для бумаг, добавленных не из списка досок (§16.2: доля эмиссии)."""
    run = LoadRun("load issue size")
    client = MoexClient()
    for r in rows(
        "select bond_id, secid from ref.bond where issue_size is null and status = 'trading'"
    ):
        try:
            size = client.description(r["secid"]).get("ISSUESIZE")
        except Exception as e:  # noqa: BLE001
            run.error(f"description failed: {e}", {"secid": r["secid"]})
            continue
        if size and float(size) > 0:
            with tx() as c:
                c.execute(
                    text("update ref.bond set issue_size = :n where bond_id = :b"),
                    {"n": int(float(size)), "b": r["bond_id"]},
                )
            run.ok += 1
    run.finish()
    return run.ok
