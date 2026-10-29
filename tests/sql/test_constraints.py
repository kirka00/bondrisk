"""Ограничения целостности и бизнес-правила: каждая некорректная операция должна быть отклонена
с ожидаемым SQLSTATE (ТЗ §2.1, §4, §8). Каждый случай выполняется в собственной транзакции и откатывается.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from bondrisk.db.engine import get_engine

CASES = [
    (
        "номинал ≤ 0",
        "insert into ref.bond (isin, secid, issuer_id, short_name, face_value_initial, maturity_date)"
        " values ('RU000CTST900', 'X900', {corp}, 'x', 0, '2039-01-01')",
        "23514",
    ),
    (
        "неверный формат ISIN",
        "insert into ref.bond (isin, secid, issuer_id, short_name, face_value_initial, maturity_date)"
        " values ('bad-isin-001', 'X901', {corp}, 'x', 1000, '2039-01-01')",
        "23514",
    ),
    (
        "дубликат ISIN",
        "insert into ref.bond (isin, secid, issuer_id, short_name, face_value_initial, maturity_date)"
        " values ((select isin from ref.bond where bond_id = {par}), 'X902', {corp}, 'x', 1000, '2039-01-01')",
        "23505",
    ),
    (
        "погашение раньше размещения",
        "insert into ref.bond (isin, secid, issuer_id, short_name, face_value_initial, issue_date, maturity_date)"
        " values ('RU000CTST903', 'X903', {corp}, 'x', 1000, '2039-01-01', '2038-01-01')",
        "23514",
    ),
    (
        "оферта после погашения",
        "update ref.bond set offer_date = '2038-01-01' where bond_id = {par}",
        "23514",
    ),
    (
        "дисконтная бумага со ставкой",
        "update ref.bond set coupon_type = 'zero', coupon_rate_pct = 5 where bond_id = {par}",
        "23514",
    ),
    (
        "пересечение купонных периодов (EXCLUDE gist)",
        "insert into ref.cash_flow_schedule (bond_id, flow_type, period, pay_date, rate_pct, amount)"
        " values ({par}, 'coupon', daterange('2036-01-01','2036-06-01'), '2036-06-01', 10, 50)",
        "23P01",
    ),
    (
        "сумма амортизаций больше номинала (отложенный триггер)",
        "insert into ref.cash_flow_schedule (bond_id, flow_type, pay_date, amount) values ({par}, 'amortization', '2036-10-25', 500)",
        "BR006",
    ),
    (
        "рейтинг без объекта",
        "insert into ref.credit_rating (agency_id, grade, assigned_on) values (2, 'A', '2035-01-01')",
        "23514",
    ),
    (
        "рейтинг с двумя объектами",
        "insert into ref.credit_rating (agency_id, issuer_id, bond_id, grade, assigned_on)"
        " values (2, {corp}, {par}, 'A', '2035-01-01')",
        "23514",
    ),
    (
        "несуществующий грейд",
        "insert into ref.credit_rating (agency_id, issuer_id, grade, assigned_on) values (2, {corp}, 'AAAA', '2035-01-01')",
        "23503",
    ),
    (
        "условия флоутера у фиксированного купона",
        "insert into ref.floater_terms (bond_id, reference_rate) values ({par}, 'KEY_RATE')",
        "BR006",
    ),
    (
        "лимит без порога",
        "insert into risk.risk_limit (portfolio_id, metric) values ({pf}, 'dv01')",
        "23514",
    ),
    (
        "лимит концентрации без объекта",
        "insert into risk.risk_limit (portfolio_id, metric, threshold_abs) values ({pf}, 'conc_issuer', 1)",
        "23514",
    ),
    (
        "порог предупреждения вне (0;100)",
        "insert into risk.risk_limit (portfolio_id, metric, threshold_abs, warning_pct) values ({pf}, 'dv01', 1, 100)",
        "23514",
    ),
    (
        "расчёты раньше сделки",
        "insert into ops.trade (portfolio_id, bond_id, trade_date, settlement_date, side, qty, clean_price_pct)"
        " values ({pf}, {par}, '2035-10-25', '2035-10-24', 'buy', 1, 100)",
        "23514",
    ),
    (
        "количество ≤ 0",
        "insert into ops.trade (portfolio_id, bond_id, trade_date, settlement_date, side, qty, clean_price_pct)"
        " values ({pf}, {par}, '2035-10-25', '2035-10-26', 'buy', 0, 100)",
        "23514",
    ),
    (
        "сделка после погашения",
        "insert into ops.trade (portfolio_id, bond_id, trade_date, settlement_date, side, qty, clean_price_pct)"
        " values ({pf}, {par}, '2038-01-01', '2029-01-02', 'buy', 1, 100)",
        "BR004",
    ),
    (
        "касса в минус без овердрафта",
        "update ops.cash_account set balance = -1 where portfolio_id = {pf}",
        "23514",
    ),
    (
        "продажа без позиции через процедуру",
        "select ops.execute_trade_fn({pf}, {par}, 'sell', 10, 100, {trader}, '2035-10-25'::date)",
        "BR001",
    ),
    (
        "покупка без денег через процедуру",
        "select ops.execute_trade_fn({pf}, {par}, 'buy', 100000, 100, {trader}, '2035-10-25'::date)",
        "BR002",
    ),
    (
        "удаление эмитента с выпусками (RESTRICT)",
        "delete from ref.issuer where issuer_id = {corp}",
        "23001",
    ),
    (
        "снятие нарушения трейдером",
        "call risk.waive_breach(1, {trader}, 'причина достаточно длинная')",
        "BR005",
    ),
    ("пустое обоснование снятия", "call risk.waive_breach(1, {risk}, 'x')", "BR005"),
]


@pytest.mark.parametrize(("title", "sql", "sqlstate"), CASES, ids=[c[0] for c in CASES])
def test_rejected(fx, title, sql, sqlstate):
    stmt = sql.format(
        corp=fx.issuer_corp,
        par=fx.bond_par,
        zero=fx.bond_zero,
        pf=fx.portfolio,
        trader=fx.user_trader,
        risk=fx.user_risk,
    )
    with get_engine(admin=True).connect() as c:
        tx = c.begin()
        with pytest.raises(DBAPIError) as ei:
            c.execute(text(stmt))
            tx.commit()  # отложенные ограничения срабатывают на COMMIT
        assert ei.value.orig.sqlstate == sqlstate, f"{title}: {ei.value.orig}"
        if tx.is_active:
            tx.rollback()


def test_trade_immutable(fx):
    """Сделку нельзя изменить или удалить; запрет — триггером (BR005)."""
    with get_engine(admin=True).connect() as c:
        tx = c.begin()
        tid = c.execute(
            text("select ops.execute_trade_fn(:pf, :b, 'buy', 10, 100, :u, '2035-10-25'::date)"),
            {"pf": fx.portfolio, "b": fx.bond_par, "u": fx.user_trader},
        ).scalar_one()
        for stmt in (
            f"update ops.trade set qty = 1 where trade_id = {tid}",
            # статус и комиссия тоже: проводка позиции и кассы сделана при вставке и не пересчитывается
            f"update ops.trade set status = 'cancelled' where trade_id = {tid}",
            f"update ops.trade set fee = 999999 where trade_id = {tid}",
            f"delete from ops.trade where trade_id = {tid}",
        ):
            sp = c.begin_nested()
            with pytest.raises(DBAPIError) as ei:
                c.execute(text(stmt))
            assert ei.value.orig.sqlstate == "BR005"
            sp.rollback()
        c.execute(text(f"update ops.trade set counterparty = 'NSD' where trade_id = {tid}"))
        tx.rollback()


def _sqlstate(c, stmt: str, params: dict) -> str | None:
    sp = c.begin_nested()
    try:
        c.execute(text(stmt), params)
    except DBAPIError as e:
        sp.rollback()
        return e.orig.sqlstate
    sp.rollback()
    return None


def test_db_level_business_rules(fx):
    """Правила, которые раньше держал только API или только процедура сделки."""
    with get_engine(admin=True).connect() as c:
        tx = c.begin()
        p = {"pf": fx.portfolio, "b": fx.bond_par, "u": fx.user_trader}
        c.execute(
            text("select ops.execute_trade_fn(:pf, :b, 'buy', 10, 100, :u, '2035-10-25'::date)"), p
        )
        # шорт прямой вставкой мимо execute_trade — отклоняет триггер
        assert (
            _sqlstate(
                c,
                "insert into ops.trade (portfolio_id, bond_id, trade_date, settlement_date, side, qty,"
                " clean_price_pct) values (:pf, :b, '2035-10-25', '2035-10-26', 'sell', 100000, 100)",
                p,
            )
            == "BR001"
        )
        # наблюдатель не проводит сделки даже при прямом вызове процедуры
        viewer = c.execute(
            text("select user_id from ops.app_user where role = 'viewer' limit 1")
        ).scalar_one()
        assert (
            _sqlstate(
                c,
                "select ops.execute_trade_fn(:pf, :b, 'buy', 1, 100, :v, '2035-10-25'::date)",
                {**p, "v": viewer},
            )
            == "BR005"
        )
        # про-форма не затирает фактический EOD той же даты
        c.execute(text("call risk.run_eod(:pf, '2035-10-25')"), p)
        assert _sqlstate(c, "call risk.run_eod(:pf, '2035-10-25', '2035-01-01')", p) == "BR006"
        assert (
            c.execute(
                text(
                    "select is_proforma from risk.risk_snapshot where portfolio_id = :pf and as_of = '2035-10-25'"
                ),
                p,
            ).scalar_one()
            is False
        )
        tx.rollback()


def test_audit_log_append_only_for_app():
    with get_engine().connect() as c:  # роль приложения app_rw
        tx = c.begin()
        assert (
            _sqlstate(
                c,
                "delete from audit.audit_log where audit_id = (select min(audit_id) from audit.audit_log)",
                {},
            )
            == "42501"
        )
        tx.rollback()


def test_rating_supersede_and_history(fx):
    """Новый действующий рейтинг закрывает предыдущий; тип действия выводится автоматически."""
    with get_engine(admin=True).connect() as c:
        tx = c.begin()
        c.execute(
            text(
                "insert into ref.credit_rating (agency_id, issuer_id, grade, assigned_on) values (3, :i, 'BBB', '2034-01-01')"
            ),
            {"i": fx.issuer_corp},
        )
        c.execute(
            text(
                "insert into ref.credit_rating (agency_id, issuer_id, grade, assigned_on) values (3, :i, 'BB+', '2035-01-01')"
            ),
            {"i": fx.issuer_corp},
        )
        rows = c.execute(
            text(
                "select grade, status::text, action::text from ref.credit_rating where issuer_id = :i and agency_id = 3 order by assigned_on"
            ),
            {"i": fx.issuer_corp},
        ).all()
        assert [tuple(r) for r in rows] == [
            ("BBB", "superseded", "assigned"),
            ("BB+", "active", "downgraded"),
        ]
        active = c.execute(
            text(
                "select count(*) from ref.credit_rating where issuer_id = :i and agency_id = 3 and status = 'active'"
            ),
            {"i": fx.issuer_corp},
        ).scalar_one()
        assert active == 1
        tx.rollback()


def test_eod_books_coupons_once(fx):
    """Фактический EOD зачисляет купон по графику MOEX держателю на дату выплаты; повторный EOD не задваивает."""
    with get_engine(admin=True).connect() as c:
        tx = c.begin()
        p = {"pf": fx.portfolio, "b": fx.bond_par, "u": fx.user_trader}
        c.execute(
            text(
                "select ops.execute_trade_fn(:pf, :b, 'buy', 10, 100, :u, '2035-01-15'::date, 0, 0, null, false)"
            ),
            p,
        )
        coupons = (
            "select count(*), coalesce(sum(m.amount), 0) from ops.cash_movement m join ops.cash_account a"
            " using (cash_account_id) where a.portfolio_id = :pf and m.kind = 'coupon'"
        )
        for _ in range(2):
            c.execute(text("call risk.run_eod(:pf, '2035-10-25')"), p)
            n, amount = c.execute(text(coupons), p).one()
            assert (
                n == 1 and float(amount) == 10 * 100
            )  # купон 10 % на номинал 1000 — 100 на бумагу
        tx.rollback()
