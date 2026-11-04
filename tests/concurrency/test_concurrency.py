"""Конкурентный доступ (ТЗ §5): аномалия без защиты, защита в процедуре, очередь с расчётом конца дня,
атомарность, конфликт сериализации.

Каждый сценарий выполняется двумя независимыми подключениями, стартующими одновременно (barrier).
"""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from bondrisk.db.engine import get_engine


def _run_parallel(fn, n=2):
    barrier = threading.Barrier(n)
    with ThreadPoolExecutor(max_workers=n) as ex:
        return list(ex.map(lambda i: fn(i, barrier), range(n)))


def _position(fx):
    with get_engine(admin=True).connect() as c:
        return c.execute(
            text("select qty from ops.position where portfolio_id = :p and bond_id = :b"),
            {"p": fx.portfolio, "b": fx.bond_par},
        ).scalar_one()


def _outcome(fn):
    try:
        return ("ok", fn())
    except DBAPIError as e:
        return ("err", e.orig.sqlstate)


def test_naive_insert_guarded_by_trigger(clean_position):
    """Две сессии вставляют продажи напрямую в ops.trade, проверив остаток «вручную» в READ COMMITTED
    без блокировки: обе видят 1000 шт. и продают по 600. Без защиты в СУБД это потерянное обновление
    инварианта (позиция −200 при запрете шорта). Триггер trade_apply берёт строку позиции FOR UPDATE и
    проверяет allow_short после проводки: вторая вставка ждёт первую и отклоняется кодом BR001."""
    fx = clean_position

    def worker(i, barrier):
        with get_engine().connect() as c:
            tx = c.begin()
            qty = c.execute(
                text("select qty from ops.position where portfolio_id = :p and bond_id = :b"),
                {"p": fx.portfolio, "b": fx.bond_par},
            ).scalar_one()
            barrier.wait()  # обе сессии прочитали 1000
            assert qty >= 600
            res = _outcome(
                lambda: c.execute(
                    text(
                        "insert into ops.trade (portfolio_id, bond_id, trade_date, settlement_date, side, qty, clean_price_pct)"
                        " values (:p, :b, '2035-10-25', '2035-10-26', 'sell', 600, 100)"
                    ),
                    {"p": fx.portfolio, "b": fx.bond_par},
                )
            )
            tx.commit() if res[0] == "ok" else tx.rollback()
            return res

    results = _run_parallel(worker)
    assert sorted(r[1] if r[0] == "err" else "ok" for r in results) == ["BR001", "ok"]
    assert _position(fx) == 400  # инвариант сохранён


def test_procedure_prevents_oversell(clean_position):
    """ЗАЩИТА: ops.execute_trade берёт строку позиции FOR UPDATE — вторая сессия ждёт первую и
    получает актуальный остаток; ровно одна продажа проходит, вторая отклоняется кодом BR001."""
    fx = clean_position

    def worker(i, barrier):
        barrier.wait()
        with get_engine().begin() as c:
            return _outcome(
                lambda: c.execute(
                    text(
                        "select ops.execute_trade_fn(:p, :b, 'sell', 600, 100, :u, '2035-10-25'::date)"
                    ),
                    {"p": fx.portfolio, "b": fx.bond_par, "u": fx.user_trader},
                ).scalar_one()
            )

    results = _run_parallel(worker)
    assert sorted(r[0] for r in results) == ["err", "ok"]
    assert [r[1] for r in results if r[0] == "err"] == ["BR001"]
    assert _position(fx) == 400


def test_limit_double_pass_prevented(clean_position):
    """Лимит DV01 жёсткий: одна покупка проходит, две вместе — нарушение. Без сериализации обе проверки
    увидели бы «до» и обе прошли бы; advisory-lock портфеля в процедуре пропускает ровно одну."""
    fx = clean_position
    with get_engine(admin=True).begin() as c:
        dv01 = c.execute(
            text("select dv01 from risk.portfolio_metrics(:p, '2035-10-25'::date)"),
            {"p": fx.portfolio},
        ).scalar_one()
        per_bond = dv01 / 1000
        c.execute(
            text(
                "insert into risk.risk_limit (portfolio_id, metric, threshold_abs, is_hard, created_by) values (:p, 'dv01', :t, true, :u)"
            ),
            {"p": fx.portfolio, "t": round(dv01 + per_bond * 700, 2), "u": fx.user_risk},
        )

    def worker(i, barrier):
        barrier.wait()
        with get_engine().begin() as c:
            return _outcome(
                lambda: c.execute(
                    text(
                        "select ops.execute_trade_fn(:p, :b, 'buy', 500, 100, :u, '2035-10-25'::date)"
                    ),
                    {"p": fx.portfolio, "b": fx.bond_par, "u": fx.user_trader},
                ).scalar_one()
            )

    results = _run_parallel(worker)
    assert sorted(r[0] for r in results) == ["err", "ok"]
    assert [r[1] for r in results if r[0] == "err"] == ["BR003"]
    assert _position(fx) == 1500


def test_eod_waits_for_trades_queue(clean_position):
    """Расчёт конца дня встаёт в ту же очередь портфеля: пока run_eod не зафиксирован, сделка ждёт его
    advisory-lock, поэтому срез не видит «полусделку», а сделка проходит после расчёта."""
    fx = clean_position
    eod_locked, trade_started = threading.Event(), threading.Event()

    def eod():
        with get_engine().connect() as c:
            tx = c.begin()
            c.execute(text("call risk.run_eod(:p, '2035-10-25'::date)"), {"p": fx.portfolio})
            eod_locked.set()
            trade_started.wait()
            time.sleep(0.5)  # сделка в это время ждёт блокировку
            tx.commit()
            return time.monotonic()

    def trade():
        eod_locked.wait()
        trade_started.set()
        with get_engine().begin() as c:
            c.execute(
                text(
                    "select ops.execute_trade_fn(:p, :b, 'buy', 500, 100, :u, '2035-10-25'::date)"
                ),
                {"p": fx.portfolio, "b": fx.bond_par, "u": fx.user_trader},
            )
        return time.monotonic()

    with ThreadPoolExecutor(max_workers=2) as ex:
        eod_done, trade_done = ex.submit(eod), ex.submit(trade)
        assert trade_done.result() >= eod_done.result()  # сделка завершилась только после расчёта
    with get_engine(admin=True).connect() as c:
        snap_qty = c.execute(
            text(
                "select qty from risk.position_snapshot where portfolio_id = :p and bond_id = :b"
                " and as_of = '2035-10-25' and not is_proforma"
            ),
            {"p": fx.portfolio, "b": fx.bond_par},
        ).scalar_one()
    assert snap_qty == 1000  # срез — состояние до сделки
    assert _position(fx) == 1500


def test_failed_trade_is_atomic(clean_position):
    """Откат составной операции: покупка на сумму больше кассы падает на проверке кассы — ни сделки,
    ни движения по кассе, ни изменения позиции не остаётся."""
    fx = clean_position
    with get_engine(admin=True).connect() as c:
        before = c.execute(
            text(
                "select (select count(*) from ops.trade where portfolio_id = :p),"
                " (select count(*) from ops.cash_movement m join ops.cash_account a using (cash_account_id) where a.portfolio_id = :p),"
                " (select qty from ops.position where portfolio_id = :p and bond_id = :b),"
                " (select balance from ops.cash_account where portfolio_id = :p and currency = 'RUB')"
            ),
            {"p": fx.portfolio, "b": fx.bond_par},
        ).one()
    with get_engine().connect() as c:
        tx = c.begin()
        with pytest.raises(DBAPIError) as ei:
            c.execute(
                text(
                    "select ops.execute_trade_fn(:p, :b, 'buy', 100000, 100, :u, '2035-10-25'::date)"
                ),
                {"p": fx.portfolio, "b": fx.bond_par, "u": fx.user_trader},
            )
        assert ei.value.orig.sqlstate == "BR002"
        tx.rollback()
    with get_engine(admin=True).connect() as c:
        after = c.execute(
            text(
                "select (select count(*) from ops.trade where portfolio_id = :p),"
                " (select count(*) from ops.cash_movement m join ops.cash_account a using (cash_account_id) where a.portfolio_id = :p),"
                " (select qty from ops.position where portfolio_id = :p and bond_id = :b),"
                " (select balance from ops.cash_account where portfolio_id = :p and currency = 'RUB')"
            ),
            {"p": fx.portfolio, "b": fx.bond_par},
        ).one()
    assert tuple(before) == tuple(after)


def test_serializable_conflict_and_retry(clean_position):
    """Альтернативная стратегия — уровень изоляции SERIALIZABLE: обе сессии читают позицию и пишут,
    одна получает 40001 serialization_failure; приложение обязано повторить транзакцию."""
    fx = clean_position

    def worker(i, barrier):
        attempts = 0
        while True:
            attempts += 1
            try:
                # прямой UPDATE позиции — только у администратора: у роли приложения записи в ops.position нет
                with (
                    get_engine(admin=True)
                    .connect()
                    .execution_options(isolation_level="SERIALIZABLE") as c
                ):
                    tx = c.begin()
                    qty = c.execute(
                        text(
                            "select qty from ops.position where portfolio_id = :p and bond_id = :b"
                        ),
                        {"p": fx.portfolio, "b": fx.bond_par},
                    ).scalar_one()
                    if attempts == 1:
                        barrier.wait()
                    c.execute(
                        text(
                            "update ops.position set qty = :q where portfolio_id = :p and bond_id = :b"
                        ),
                        {"q": qty - 100, "p": fx.portfolio, "b": fx.bond_par},
                    )
                    tx.commit()
                    return ("ok", attempts)
            except DBAPIError as e:
                if e.orig.sqlstate == "40001" and attempts < 5:
                    continue
                raise

    results = _run_parallel(worker)
    assert sorted(r[1] for r in results) == [1, 2]  # одна прошла сразу, вторая — после повтора
    assert _position(fx) == 800
