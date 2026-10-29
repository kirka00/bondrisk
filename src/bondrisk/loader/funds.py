"""Реальный портфель БПИФ BOND (УК ДОХОДЪ) по опубликованному составу; общие помощники для индексных портфелей."""

from __future__ import annotations

import logging
import math
import subprocess
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import text

from bondrisk.loader.bonds import bond_from_description, load_schedules, upsert_bond
from bondrisk.loader.db import LoadRun, rows, scalar, tx
from bondrisk.loader.market import load_prices
from bondrisk.loader.moex import MoexClient
from bondrisk.loader.xlsx import xlsx_rows
from bondrisk.settings import get_settings

log = logging.getLogger("bondrisk.funds")

DOHOD_URL = (
    "https://www.dohod.ru/assets/components/dohod/connectorweb.php"
    "?resId=1153&action=fundstructure/get&title=BOND&dataType=excel"
)
UA = "Mozilla/5.0 (bondrisk study project)"
INDEXES = {
    "RGBI": ("RGBITR", "Индекс ОФЗ RGBITR", 1_000_000_000, "RUB"),
    "RUCB": ("RUCBTRNS", "Индекс корп. облигаций RUCBTRNS", 1_000_000_000, "RUB"),
    "RUHY": ("RUCBHYTR", "Индекс ВДО RUCBHYTR", 1_000_000_000, "RUB"),
    "RUCNY": ("RUCNYTR", "Индекс юаневых облигаций RUCNYTR", 100_000_000, "CNY"),
}
SYNC_DRIFT = 0.02  # BOND: позиции с отклонением от нового состава меньше 2 % не перекладываются
USER_TRADER = "select user_id from ops.app_user where login = 'trader'"
USER_RISK = "select user_id from ops.app_user where login = 'risk'"


def _raw_dir(as_of: date) -> Path:
    p = Path(get_settings().raw_dir) / "funds" / as_of.isoformat()
    p.mkdir(parents=True, exist_ok=True)
    return p


# ------------------------------------------------------------------ источники
def fetch_dohod_bond(as_of: date) -> tuple[date, list[dict[str, Any]], float]:
    """Состав БПИФ BOND: (дата состава, [{isin, name, kind, amount_rub, share_pct}], денежные средства)."""
    cache = _raw_dir(as_of) / "dohod_BOND.xlsx"
    if not (get_settings().raw_cache and cache.exists()):
        subprocess.run(
            ["curl", "-sS", "--max-time", "120", "-A", UA, DOHOD_URL, "-o", str(cache)], check=True
        )
    recs = xlsx_rows(cache.read_bytes())
    struct_date = as_of
    for r in recs[:3]:
        for v in r.values():
            m = __import__("re").search(r"(\d{2})\.(\d{2})\.(\d{4})", str(v))
            if m:
                struct_date = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    bonds, cash = [], 0.0
    for r in recs:
        isin = (r.get("B") or "").strip()
        kind = (r.get("C") or "").strip()
        try:
            amount = float(str(r.get("D") or "0").replace(",", "."))
        except ValueError:
            continue
        if len(isin) == 12 and isin[:2].isalpha() and isin[-1].isdigit():
            bonds.append(
                {
                    "isin": isin,
                    "name": (r.get("A") or "").strip(),
                    "kind": kind,
                    "amount_rub": amount,
                    "share_pct": float(str(r.get("E") or "0").replace(",", ".") or 0),
                }
            )
        elif r.get("D") and not str(r.get("A", "")).startswith(("Наименование", "BOND")):
            cash += amount  # денежные средства, репо, требования по сделкам, начисленные проценты
    return struct_date, bonds, cash


# ------------------------------------------------------------------ догрузка бумаг
def ensure_bonds(client: MoexClient, keys: list[str], run: LoadRun) -> dict[str, int | None]:
    """ISIN/secid → bond_id; отсутствующие выпуски догружаются (карточка, график, цены с 2022-01-01)."""
    known = {r["isin"]: r["bond_id"] for r in rows("select isin, bond_id from ref.bond")}
    known.update({r["secid"]: r["bond_id"] for r in rows("select secid, bond_id from ref.bond")})
    result: dict[str, int | None] = {}
    new_secids: list[str] = []
    for key in keys:
        if key in known:
            result[key] = known[key]
            continue
        idx = client.lookup(key)
        secid = (idx or {}).get("secid") or key
        try:
            desc = client.description(secid)
        except Exception as e:  # noqa: BLE001
            run.error(f"description failed for {key}: {e}", {"key": key})
            result[key] = None
            continue
        if not desc.get("ISIN"):
            run.error(f"{key}: security not found on MOEX", {"key": key})
            result[key] = None
            continue
        primary = (
            next((b["boardid"] for b in client.boards(secid) if b.get("is_primary")), None)
            or (idx or {}).get("primary_boardid")
            or "TQCB"
        )
        built = bond_from_description(secid, desc, primary, idx)
        if built is None:
            run.error(
                f"{key}: excluded (type/currency/maturity): {desc.get('BOND_TYPE')} {desc.get('FACEUNIT')} {desc.get('MATDATE')}",
                {"key": key},
            )
            result[key] = None
            continue
        bond, issuer = built
        try:
            with tx() as c:
                bid = upsert_bond(c, bond, issuer)
            known[key] = bid
            known[bond["isin"]] = bid
            result[key] = bid
            new_secids.append(secid)
            run.ok += 1
        except Exception as e:  # noqa: BLE001
            run.error(f"{key}: upsert failed: {str(e).splitlines()[0]}", bond)
            result[key] = None
    if new_secids:
        log.info("new bonds: %d → schedules, prices", len(new_secids))
        load_schedules(new_secids)
        load_prices(date(2022, 1, 1), date.today(), new_secids)
    return result


# ------------------------------------------------------------------ портфели
def _metrics(bond_id: int, as_of: date) -> dict[str, Any] | None:
    r = rows("select * from ref.bond_metrics(:b, :d)", b=bond_id, d=as_of)
    return r[0] if r and r[0]["clean_price_pct"] else None


def _build_portfolio(
    code: str,
    name: str,
    as_of: date,
    targets: list[tuple[int, float]],
    base_cur: str,
    cash_target: float | None,
    run: LoadRun,
) -> int | None:
    """targets: [(bond_id, целевая сумма в валюте выпуска по грязной цене)] → депозит, сделки, остаток кассы."""
    if scalar(
        "select 1 from ops.portfolio p where code = :c and exists (select 1 from ops.trade t where t.portfolio_id = p.portfolio_id)",
        c=code,
    ):
        log.info("%s already built — skipping", code)
        return scalar("select portfolio_id from ops.portfolio where code = :c", c=code)
    trader = scalar(USER_TRADER)
    plan: list[tuple[int, int, float, str, float]] = []  # bond_id, qty, clean, currency, leg
    skipped = 0
    for bond_id, amount in targets:
        m = _metrics(bond_id, as_of)
        cur = scalar("select currency from ref.bond where bond_id = :b", b=bond_id)
        if m is None or not m["dirty_price"]:
            skipped += 1
            run.error(f"{code}: no price within 90 days of {as_of}", {"bond_id": bond_id})
            continue
        qty = max(1, int(amount / float(m["dirty_price"])))
        plan.append((bond_id, qty, float(m["clean_price_pct"]), cur, qty * float(m["dirty_price"])))
    if not plan:
        run.error(f"{code}: nothing to buy")
        return None
    need: dict[str, float] = {}
    for _, _, _, cur, leg in plan:
        need[cur] = need.get(cur, 0) + leg
    with tx() as c:
        pid = c.execute(
            text("select portfolio_id from ops.portfolio where code = :c"), {"c": code}
        ).scalar()
        if pid is None:
            pid = c.execute(
                text(
                    "insert into ops.portfolio (code, name, manager_id, allow_short, base_currency) values (:c, :n, :m, false, :bc) returning portfolio_id"
                ),
                {"c": code, "n": name, "m": trader, "bc": base_cur},
            ).scalar()
        for cur, amt in need.items():
            c.execute(
                text(
                    "call ops.deposit_cash(cast(:p as bigint), cast(:c as char(3)), cast(:a as numeric), cast(:u as bigint), cast(:note as text), cast(:d as date))"
                ),
                {
                    "p": pid,
                    "c": cur,
                    "a": round(amt * 1.01 + (cash_target or 0), 2)
                    if cur == base_cur
                    else round(amt * 1.01, 2),
                    "u": trader,
                    "note": f"фондирование под состав на {as_of}",
                    "d": as_of - timedelta(days=1),
                },
            )
        done = 0
        for bond_id, qty, clean, _cur, _ in plan:
            try:
                with c.begin_nested():
                    c.execute(
                        text(
                            "select ops.execute_trade_fn(cast(:p as bigint), cast(:b as bigint), 'buy', cast(:q as bigint), cast(:pr as numeric), cast(:u as bigint), cast(:d as date), 0, 0, :cp, false)"
                        ),
                        {
                            "p": pid,
                            "b": bond_id,
                            "q": qty,
                            "pr": round(clean, 6),
                            "u": trader,
                            "d": as_of,
                            "cp": f"{code} composition",
                        },
                    )
                done += 1
            except Exception as e:  # noqa: BLE001
                run.error(
                    f"{code}: trade failed: {str(e).splitlines()[0][:160]}",
                    {"bond_id": bond_id, "qty": qty},
                    conn=c,
                )
        # излишек фондирования выводим, чтобы касса соответствовала источнику
        for cur in need:  # noqa: B007
            bal = c.execute(
                text(
                    "select balance from ops.cash_account where portfolio_id = :p and currency = :c"
                ),
                {"p": pid, "c": cur},
            ).scalar()
            target = (cash_target or 0) if cur == base_cur else 0
            if bal is not None and float(bal) - target > 0.01:
                c.execute(
                    text(
                        "call ops.deposit_cash(cast(:p as bigint), cast(:c as char(3)), cast(:a as numeric), cast(:u as bigint), cast(:note as text), cast(:d as date))"
                    ),
                    {
                        "p": pid,
                        "c": cur,
                        "a": -round(float(bal) - target, 2),
                        "u": trader,
                        "note": "возврат излишка фондирования",
                        "d": as_of,
                    },
                )
    run.ok += done
    log.info("%s: %d positions bought, %d skipped (no price)", code, done, skipped)
    return pid


def _seed_limits(pid: int, as_of: date) -> None:
    risk_uid = scalar(USER_RISK)
    m = rows("select * from risk.portfolio_metrics(:p, :d)", p=pid, d=as_of)[0]
    # Политика риск-менеджера на старте портфеля: DV01 и VaR — в % от брутто-стоимости с запасом 1,5×
    # (рост портфеля сам по себе лимит не съедает), дюрация — стартовая + 1 год (предупреждение с 95 %),
    # эмитент — 10 % брутто или стартовый вес + 2 п.п., если индекс уже концентрированнее (жёсткий),
    # ведущая отрасль — 40 %. Нарушения возникают, когда меняется сам риск, а не размер портфеля.
    gross = float(m["mv_gross"] or 0) or 1.0
    lim: list[tuple] = [
        ("dv01", None, None, None, round(abs(float(m["dv01"])) / gross * 150, 4), False, 80),
        ("duration", None, None, round(float(m["duration_mac"] or 3) + 1.0, 1), None, False, 95),
        ("var_99", None, None, None, round(float(m["var_99_1d"]) / gross * 150, 4), False, 80),
    ]
    for t in rows(
        "select issuer_id, sum(abs(mv_rub)) mv from risk.position_valuation(:p, :d) where not is_sovereign group by issuer_id order by mv desc limit 3",
        p=pid,
        d=as_of,
    ):
        w = float(t["mv"]) / gross * 100
        lim.append(("conc_issuer", t["issuer_id"], None, None, max(10, math.ceil(w) + 2), True, 80))
    sec = rows(
        "select sector, sum(abs(mv_rub)) mv from risk.position_valuation(:p, :d) where not is_sovereign group by sector order by mv desc limit 1",
        p=pid,
        d=as_of,
    )
    # «Прочее» — не отрасль, а отсутствие классификации у эмитента: лимит на неё ничего не ограничивает
    if sec and sec[0]["sector"] != "Прочее":
        lim.append(("conc_sector", None, sec[0]["sector"], None, 40, False, 80))
    with tx() as c:
        # повторный запуск не трогает существующие лимиты: их могли изменить в интерфейсе, а удаление
        # каскадом стёрло бы историю нарушений вместе со снятиями
        if c.execute(
            text("select 1 from risk.risk_limit where portfolio_id = :p limit 1"), {"p": pid}
        ).first():
            log.info("portfolio %s already has limits — keeping them", pid)
            return
        for metric, iss, sector, abs_, pct, hard, warn in lim:
            c.execute(
                text(
                    "insert into risk.risk_limit (portfolio_id, metric, scope_issuer_id, scope_sector, threshold_abs, threshold_pct, is_hard, warning_pct, created_by, valid_from) "
                    "values (:p, cast(:m as risk.limit_metric), :i, :s, :a, :pc, :h, :w, :u, :d)"
                ),
                {
                    "p": pid,
                    "m": metric,
                    "i": iss,
                    "s": sector,
                    "a": abs_,
                    "pc": pct,
                    "h": hard,
                    "w": warn,
                    "u": risk_uid,
                    "d": as_of,
                },
            )


def load_funds(as_of: date | None = None) -> None:
    as_of = as_of or date.today()
    client = MoexClient()
    run = LoadRun("load funds", {"as_of": str(as_of)})
    built: list[tuple[int, date]] = []

    # 1. БПИФ BOND (ДОХОДЪ)
    try:
        struct_date, items, cash = fetch_dohod_bond(as_of)
        # сделки бронируются последним торговым днём не позже даты состава (состав может быть выходным днём)
        last_px = rows("select max(ts) as d from ts.price_history")[0]["d"]
        trade_day = min(struct_date, last_px) if last_px else struct_date
        ids = ensure_bonds(client, [i["isin"] for i in items], run)
        targets = [(ids[i["isin"]], i["amount_rub"]) for i in items if ids.get(i["isin"])]
        missing = [i["isin"] for i in items if not ids.get(i["isin"])]
        log.info(
            "BOND: %d bonds in fund, %d resolved, %d missing %s, cash %.0f",
            len(items),
            len(targets),
            len(missing),
            missing[:5],
            cash,
        )
        pid = _build_portfolio(
            "BOND",
            f"БПИФ BOND (ДОХОДЪ), состав на {struct_date:%d.%m.%Y}",
            trade_day,
            targets,
            "RUB",
            cash,
            run,
        )
        if pid:
            built.append((pid, trade_day))
    except Exception as e:  # noqa: BLE001
        run.error(f"BOND failed: {e}")

    # индексные портфели строятся с настоящей историей: bondrisk load index-history (index_history.py)

    # 3. рейтинги для новых бумаг (только реальные), лимиты, EOD
    from bondrisk.loader.ratings import load_ratings

    load_ratings("all")
    for pid, d in built:
        _seed_limits(pid, d)
        with tx() as c:
            c.execute(text("call risk.run_eod(:p, :d)"), {"p": pid, "d": d})
    with tx() as c:
        c.execute(text("call risk.refresh_views()"))
    run.finish()


def sync_fund_bond(today: date, run: LoadRun) -> bool:
    """Новый опубликованный состав BOND → сделки до целевых количеств (продажи, затем покупки).
    Приток и отток паёв моделируется движением кассы: остаток подводится к денежной части состава."""
    pid, name = (
        rows("select portfolio_id, name from ops.portfolio where code = 'BOND'")[0].values()
        if scalar("select 1 from ops.portfolio where code = 'BOND'")
        else (None, "")
    )
    if pid is None:
        return False
    m = __import__("re").search(r"(\d{2})\.(\d{2})\.(\d{4})", name)
    held_date = date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None
    struct_date, items, cash = fetch_dohod_bond(today)
    if held_date and struct_date <= held_date:
        return False
    last_px = scalar("select max(ts) from ts.price_history")
    trade_day = min(struct_date, last_px)
    if trade_day <= (
        scalar("select max(trade_date) from ops.trade where portfolio_id = :p", p=pid) or trade_day
    ):
        return False  # цен на дату нового состава ещё нет
    client = MoexClient()
    ids = ensure_bonds(client, [i["isin"] for i in items], run)
    target: dict[int, int] = {}
    prices: dict[int, tuple[float, float, str]] = {}  # clean %, грязная в рублях, валюта

    def price(bid: int) -> tuple[float, float, str] | None:
        mt = _metrics(bid, trade_day)
        cur = scalar("select currency from ref.bond where bond_id = :b", b=bid)
        fx = scalar("select risk.fx_at(:c, :d)", c=cur, d=trade_day)
        if mt is None or not mt["dirty_price"] or fx is None:
            return None
        return float(mt["clean_price_pct"]), float(mt["dirty_price"]) * float(fx), cur

    for it in items:
        bid = ids.get(it["isin"])
        if bid and (px := price(bid)):
            prices[bid] = px
            target[bid] = target.get(bid, 0) + max(1, int(it["amount_rub"] / px[1]))
    held = {
        r["bond_id"]: int(r["qty"])
        for r in rows(
            "select bond_id, qty from ops.position where portfolio_id = :p and qty <> 0", p=pid
        )
    }
    for bid in held:
        if bid not in prices and (px := price(bid)):
            prices[bid] = px

    def small(b: int) -> bool:  # отклонение из-за смены цен, а не состава: позиция не трогается
        cur, want = held.get(b, 0), target.get(b, 0)
        return bool(cur and want and abs(want - cur) < SYNC_DRIFT * want)

    sells = [
        (b, q - target.get(b, 0))
        for b, q in held.items()
        if b in prices and q > target.get(b, 0) and not small(b)
    ]
    buys = [
        (b, q - held.get(b, 0)) for b, q in target.items() if q > held.get(b, 0) and not small(b)
    ]
    trader = scalar(USER_TRADER)
    need: dict[str, float] = {}
    for b, q in buys:
        need[prices[b][2]] = need.get(prices[b][2], 0) + q * prices[b][1]
    done = 0
    with tx() as c:

        def cash_move(cur: str, amount: float, note: str) -> None:
            c.execute(
                text(
                    "call ops.deposit_cash(cast(:p as bigint), cast(:c as char(3)), cast(:a as numeric), cast(:u as bigint), cast(:n as text), cast(:d as date))"
                ),
                {"p": pid, "c": cur, "a": round(amount, 2), "u": trader, "n": note, "d": trade_day},
            )

        for side, lst in (("sell", sells), ("buy", buys)):
            if side == "buy":
                for (
                    cur,
                    amt,
                ) in need.items():  # с запасом: валюта сделки пересчитывается по курсу ЦБ
                    cash_move(cur, amt * 1.02, f"приток паёв под состав на {struct_date:%d.%m.%Y}")
            for bid, qty in lst:
                try:
                    with c.begin_nested():
                        c.execute(
                            text(
                                "select ops.execute_trade_fn(cast(:p as bigint), cast(:b as bigint), cast(:s as ops.trade_side), cast(:q as bigint), cast(:pr as numeric), cast(:u as bigint), cast(:d as date), 0, 0, :cp, false)"
                            ),
                            {
                                "p": pid,
                                "b": bid,
                                "s": side,
                                "q": qty,
                                "pr": round(prices[bid][0], 6),
                                "u": trader,
                                "d": trade_day,
                                "cp": f"BOND состав {struct_date:%d.%m.%Y}",
                            },
                        )
                    done += 1
                except Exception as e:  # noqa: BLE001
                    run.error(
                        f"BOND: {side} {qty} of {bid} failed: {str(e).splitlines()[0][:160]}",
                        conn=c,
                    )
        for r in c.execute(
            text("select currency, balance from ops.cash_account where portfolio_id = :p"),
            {"p": pid},
        ).mappings():
            goal = cash if r["currency"] == "RUB" else 0.0
            if abs(float(r["balance"]) - goal) > 0.01:
                cash_move(
                    r["currency"], goal - float(r["balance"]), "отток/приток паёв: касса по составу"
                )
        c.execute(
            text("update ops.portfolio set name = :n where portfolio_id = :p"),
            {"n": f"БПИФ BOND (ДОХОДЪ), состав на {struct_date:%d.%m.%Y}", "p": pid},
        )
    log.info(
        "BOND: состав на %s, %d sells, %d buys, %d done", struct_date, len(sells), len(buys), done
    )
    return True
