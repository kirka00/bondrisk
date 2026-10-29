"""Временные ряды: цены закрытия, кривая КБД, курсы ЦБ."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from typing import Any

from sqlalchemy import text

from bondrisk.loader import cbr
from bondrisk.loader.db import LoadRun, copy_rows, tx
from bondrisk.loader.moex import MoexClient

log = logging.getLogger("bondrisk.market")

PRICE_COLS = (
    "secid",
    "ts",
    "close_pct",
    "yield_close",
    "duration_days",
    "volume",
    "accrued_interest",
    "face_value",
)


def _history_rows(secid: str, hist: list[dict[str, Any]]) -> list[tuple]:
    out = []
    for h in hist:
        close = h.get("CLOSE") or h.get("WAPRICE") or h.get("LEGALCLOSEPRICE")
        if not close or float(close) <= 0:
            continue
        out.append(
            (
                secid,
                h["TRADEDATE"],
                float(close),
                h.get("YIELDCLOSE"),
                int(h["DURATION"]) if h.get("DURATION") is not None else None,
                h.get("VOLUME"),
                h.get("ACCINT"),
                h.get("FACEVALUE"),
            )
        )
    return out


# Доска «Д» (TQRD) — торги после дефолта/реструктуризации: до перевода бумага торговалась на основной
# доске, и без этой истории дефолтные выпуски выпадают из ретроспективы (эффект выжившего в ВДО).
PREVIOUS_BOARDS: dict[str, tuple[str, ...]] = {"TQRD": ("TQCB", "TQIR")}


def load_prices(
    date_from: date, date_to: date, secids: list[str] | None = None, workers: int = 4
) -> None:
    run = LoadRun("load prices", {"from": str(date_from), "to": str(date_to)})
    client = MoexClient()
    with tx() as c:
        bonds = [
            dict(r)
            for r in c.execute(
                text(
                    "select secid, board, issue_date from ref.bond where status = 'trading'"
                    + (" and secid = any(:s)" if secids else "")
                ),
                {"s": secids},
            ).mappings()
        ]
    log.info("prices: %d bonds, %s..%s", len(bonds), date_from, date_to)

    def fetch(b: dict[str, Any]) -> tuple[str, list[tuple]]:
        start = max(date_from, b["issue_date"]) if b["issue_date"] else date_from
        by_day: dict[str, dict[str, Any]] = {}
        for board in [b["board"], *PREVIOUS_BOARDS.get(b["board"], ())]:
            for h in client.history(b["secid"], board, str(start), str(date_to)):
                by_day.setdefault(h["TRADEDATE"], h)  # день на двух досках — приоритет текущей
        return b["secid"], _history_rows(b["secid"], list(by_day.values()))

    batch: list[tuple] = []
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = [ex.submit(fetch, b) for b in bonds]
        for fut in as_completed(futures):
            try:
                secid, rows = fut.result()
                batch.extend(rows)
            except Exception as e:  # noqa: BLE001
                run.error(f"history failed: {e}")
                continue
            done += 1
            if len(batch) >= 20000 or done == len(bonds):
                run.ok += _flush_prices(batch)
                batch = []
                log.info("prices: %d/%d bonds, rows so far %d", done, len(bonds), run.ok)
    normalize_fx_accrued(date_from, date_to, secids)
    run.finish()


def _flush_prices(rows: list[tuple]) -> int:
    if not rows:
        return 0
    with tx() as c:
        c.execute(text("delete from stg.price_history"))
        copy_rows(c, "stg.price_history", PRICE_COLS, rows)
        n = c.execute(
            text(
                """
                insert into ts.price_history (ts, bond_id, close_pct, yield_close, duration_days, volume, accrued_interest, face_value)
                select s.ts, b.bond_id, s.close_pct, s.yield_close, s.duration_days, s.volume, s.accrued_interest, s.face_value
                  from stg.price_history s join ref.bond b on b.secid = s.secid
                 where s.close_pct > 0
                on conflict (bond_id, ts) do update set
                    close_pct = excluded.close_pct, yield_close = excluded.yield_close, duration_days = excluded.duration_days,
                    volume = excluded.volume, accrued_interest = excluded.accrued_interest, face_value = excluded.face_value
                """
            )
        ).rowcount
        c.execute(text("delete from stg.price_history"))
    return n


def load_curve(date_from: date, date_to: date, workers: int = 4) -> None:
    run = LoadRun("load curve", {"from": str(date_from), "to": str(date_to)})
    client = MoexClient()
    days = [
        date_from + timedelta(days=i)
        for i in range((date_to - date_from).days + 1)
        if (date_from + timedelta(days=i)).isoweekday() < 6
    ]
    rows: list[tuple] = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for d, res in zip(days, ex.map(lambda d: client.zcyc(str(d)), days), strict=True):
            for r in res:
                # кривая сохраняется только под своей датой торгов: на неторговый день MOEX отдаёт пусто
                if r.get("tradedate") not in (None, str(d)):
                    continue
                if r.get("value") is not None and r.get("period"):
                    rows.append((d, float(r["period"]), float(r["value"])))
    with tx() as c:
        for i in range(0, len(rows), 5000):
            c.execute(
                text(
                    "insert into ts.yield_curve (ts, tenor_years, rate_pct) values (:ts, :t, :r) "
                    "on conflict (ts, tenor_years) do update set rate_pct = excluded.rate_pct"
                ),
                [{"ts": a, "t": b, "r": r} for a, b, r in rows[i : i + 5000]],
            )
    run.ok = len(rows)
    run.finish()


def load_fx(date_from: date, date_to: date) -> None:
    run = LoadRun("load fx", {"from": str(date_from), "to": str(date_to)})
    for cur in cbr.CBR_CODES:
        try:
            rows = cbr.fx_dynamic(cur, date_from, date_to)
        except Exception as e:  # noqa: BLE001
            run.error(f"cbr {cur}: {e}")
            continue
        with tx() as c:
            c.execute(
                text(
                    "insert into ts.fx_rate (ts, currency, rate_rub) values (:ts, :c, :r) "
                    "on conflict (currency, ts) do update set rate_rub = excluded.rate_rub"
                ),
                [{"ts": d, "c": cur, "r": v} for d, cur, v in rows],
            )
        run.ok += len(rows)
    run.finish()


FX_ACCRUED_SQL = """
update ts.price_history p
   set accrued_interest = p.accrued_interest / risk.fx_on(b.currency, p.ts)
  from ref.bond b
 where p.bond_id = b.bond_id
   -- явные bond_id и период: сжатые чанки распаковываются только по нужным сегментам и датам
   and p.bond_id = any(:ids)
   and p.ts between :d0 and :d1
   and p.accrued_interest > 0
   and risk.fx_on(b.currency, p.ts) > 1
   -- НКД MOEX — на дату расчётов биржи (T+1); значение в рублях узнаётся по тому, что после деления на курс
   -- оно ближе к расчёту по графику купонов в валюте выпуска, чем само значение
   and abs(p.accrued_interest / risk.fx_on(b.currency, p.ts)
           - ref.accrued_interest(b.bond_id, ref.add_business_days(p.ts, 1)))
       < abs(p.accrued_interest - ref.accrued_interest(b.bond_id, ref.add_business_days(p.ts, 1)))
"""


def normalize_fx_accrued(
    date_from: date = date(2000, 1, 1), date_to: date | None = None, secids: list[str] | None = None
) -> int:
    """MOEX отдаёт НКД валютных бумаг (замещающие, ОФЗ в CNY) в рублях расчётов → переводим в валюту по
    курсу ЦБ на дату. Оценка (§3) берёт НКД по графику на дату расчётов, это значение — для истории торгов.
    Пересчёт ограничен загруженными валютными выпусками и периодом: проход по всей истории упирался в
    предел распаковки сжатых чанков TimescaleDB (100 000 строк на транзакцию) и откатывал загрузку."""
    with tx() as c:
        ids = c.execute(
            text(
                "select array_agg(bond_id) from ref.bond where currency <> 'RUB'"
                + (" and secid = any(:s)" if secids else "")
            ),
            {"s": secids},
        ).scalar()
        if not ids:
            return 0
        # перезагрузка длинной истории может задеть сжатые чанки сверх предела — снимаем его только
        # в этой транзакции: объём и так ограничен валютными выпусками
        c.execute(text("set local timescaledb.max_tuples_decompressed_per_dml_transaction = 0"))
        n = c.execute(
            text(FX_ACCRUED_SQL), {"ids": ids, "d0": date_from, "d1": date_to or date.today()}
        ).rowcount
    log.info("fx accrued normalized: %d rows", n)
    return n
