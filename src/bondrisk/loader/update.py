"""Автообновление: догрузка рынка с последней даты в базе, EOD и ребалансировка по новым торговым дням.

Ежедневно (`bondrisk update`): цены закрытия, КБД, курсы ЦБ, рейтинги агентств → по каждому активному
портфелю EOD за торговые дни после последнего среза; у репликантов индексов в первый торговый день
месяца сначала ребалансировка по официальному составу, у фонда BOND — синхронизация с новым
опубликованным составом. Раз в неделю (`--reference`) ещё справочник выпусков и графики платежей.
Все шаги идемпотентны: повторный запуск за тот же день ничего не дублирует.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

from sqlalchemy import text

from bondrisk.db.engine import get_engine
from bondrisk.loader.db import LoadRun, rows, scalar, tx

log = logging.getLogger("bondrisk.update")

# MOEX и ЦБ уточняют итоги задним числом, а вечерний прогон может застать день неполным:
# каждый запуск перезагружает несколько последних дней
OVERLAP_DAYS = 5
RATINGS_EVERY = timedelta(hours=20)
LOCK_KEY = 0x626F6E64  # pg_advisory_lock: одновременно идёт только одно обновление


def update(reference: bool = False, today: date | None = None) -> dict[str, str]:
    """Полный цикл обновления; возвращает даты, до которых догружены данные."""
    from bondrisk.loader.bonds import backfill_issue_size, load_bonds, load_schedules
    from bondrisk.loader.indexes import build_historical_scenarios, load_indexes
    from bondrisk.loader.market import load_curve, load_fx, load_prices
    from bondrisk.loader.ratings import load_ratings

    today = today or date.today()
    with get_engine().connect() as lock:
        if not lock.execute(text("select pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar():
            log.warning("update: уже выполняется другим процессом — пропуск")
            return {}
        run = LoadRun("update", {"reference": reference, "today": str(today)})
        try:
            if reference:
                load_bonds(["TQOB", "TQCB"], 300)
                load_schedules()
                backfill_issue_size()
                mark_matured(today)
            load_prices(_since("select max(ts) from ts.price_history"), today)
            load_curve(_since("select max(ts) from ts.yield_curve"), today)
            # ЦБ устанавливает курс на следующий день накануне
            load_fx(_since("select max(ts) from ts.fx_rate"), today + timedelta(days=1))
            load_indexes(_since("select max(ts) from ts.index_value"), today)
            if not scalar("select count(*) from risk.stress_scenario where episode is not null"):
                build_historical_scenarios()
            # рейтинги меняются редко, а сайты агентств режут частые запросы — не чаще раза в сутки
            if _stale("load ratings %", RATINGS_EVERY):
                load_ratings("all")
            run.ok = update_portfolios(today, run)
        except Exception as e:  # noqa: BLE001
            run.error(f"update failed: {e}")
            raise
        finally:
            # источник, отдавший ошибку целиком (сеть, сертификат, формат), — в счётчик ошибок обновления;
            # отбракованные строки при успешной загрузке (stg.load_error) сюда не входят
            run.failed += scalar(
                "select count(*) from stg.load_run where run_id > :r and rows_ok = 0 and rows_failed > 0",
                r=run.run_id,
            )
            run.finish()
            lock.execute(text("select pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
    return freshness_dates()


def _since(sql: str) -> date:
    last = scalar(sql)
    return (last - timedelta(days=OVERLAP_DAYS)) if last else date(2022, 1, 1)


def _stale(source_like: str, every: timedelta) -> bool:
    """Последняя успешная загрузка источника старше every (или её не было)."""
    last = scalar(
        "select max(finished_at) from stg.load_run where source like :s and rows_ok > 0",
        s=source_like,
    )
    return last is None or datetime.now(last.tzinfo) - last >= every


def mark_matured(today: date) -> int:
    """Выпуски, ушедшие с доски после погашения, справочник сам не перечитывает — закрываем по дате."""
    with tx() as c:
        n = c.execute(
            text(
                "update ref.bond set status = 'matured' where status = 'trading' and maturity_date < :d"
            ),
            {"d": today},
        ).rowcount
    log.info("matured: %d bonds", n)
    return n


def update_portfolios(today: date, run: LoadRun) -> int:
    """EOD по торговым дням после последнего среза каждого портфеля (последний срез пересчитывается)."""
    from bondrisk.loader.eod import portfolio_ids, refresh_views, trading_days
    from bondrisk.loader.funds import INDEXES, sync_fund_bond
    from bondrisk.loader.index_history import extend_index_history

    n = 0
    for pid, code in portfolio_ids(None):
        last = scalar(
            "select max(as_of) from risk.risk_snapshot where portfolio_id = :p and not is_proforma",
            p=pid,
        )
        if last is None:
            continue  # портфель ещё не построен загрузчиком
        try:
            if code in INDEXES:
                n += extend_index_history(code, last, today)
                continue
            if code == "BOND":
                sync_fund_bond(today, run)
            days = trading_days(last, today)
            for d in days:  # run_eod сам проводит выплаты с прошлого среза
                with tx() as c:
                    c.execute(text("call risk.run_eod(:p, :d)"), {"p": pid, "d": d})
            n += len(days)
            log.info("%s: eod %d days up to %s", code, len(days), days[-1] if days else last)
        except Exception as e:  # noqa: BLE001 — сбой одного портфеля не останавливает остальные
            run.error(f"{code}: {str(e).splitlines()[0][:300]}")
    refresh_views()
    return n


# ------------------------------------------------------------------ актуальность
FRESHNESS_SQL = """
select (select max(ts) from ts.price_history)                         as prices,
       (select max(ts) from ts.yield_curve)                           as curve,
       (select max(ts) from ts.fx_rate)                               as fx,
       (select max(as_of) from risk.risk_snapshot where not is_proforma) as eod,
       (select max(finished_at) from stg.load_run
         where source like 'load ratings %' and finished_at is not null) as ratings_loaded_at,
       (select max(finished_at) from stg.load_run
         where source = 'load bonds' and finished_at is not null)      as reference_loaded_at,
       (select max(finished_at) from stg.load_run
         where source = 'update' and finished_at is not null)          as updated_at,
       (select rows_failed from stg.load_run
         where source = 'update' and finished_at is not null order by run_id desc limit 1) as last_update_errors
"""


def freshness_dates() -> dict[str, str]:
    r = rows(FRESHNESS_SQL)[0]
    return {k: (v.isoformat() if isinstance(v, date | datetime) else str(v)) for k, v in r.items()}
