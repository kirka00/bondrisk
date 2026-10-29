"""Соответствие методологии риск-дашборда: оценка (§3–§8, §10), рейтинг (§15), касса (§2), книга лимитной
политики (§16.2), исторические стрессы (§13), P&L (§17), ОВП (§18), what-if (§20), ручные корректировки."""

from datetime import date, timedelta

import pytest
from sqlalchemy import text

from bondrisk.db.engine import connect
from bondrisk.loader.index_history import drop_portfolio
from tests.conftest import AS_OF, TAG

D = AS_OF  # 2035-01-15, понедельник; день купона бумаги par
S2 = date(2035, 1, 17)  # T+2 рабочих дня


def q(sql: str, **p) -> list[dict]:
    with connect(admin=True) as c:
        c.execute(text("select set_config('bondrisk.user_id', '1', true)"))
        res = c.execute(text(sql), p)
        return [dict(r) for r in res.mappings()] if res.returns_rows else []


def one(sql: str, **p) -> dict:
    return q(sql, **p)[0]


@pytest.fixture(scope="module")
def mpf(fx):
    """Портфель со сделкой: 100 бумаг par по 99 % с расчётами T+2 (денежная нога — по дате сделки, §2)."""
    code = f"TEST-{TAG}M"
    with connect(admin=True) as c:
        pid = c.execute(
            text(
                "insert into ops.portfolio (code, name, manager_id, allow_short) values (:c, 'TEST методология', :m, true)"
                " returning portfolio_id"
            ),
            {"c": code, "m": fx["trader"]},
        ).scalar_one()
        c.execute(
            text("call ops.deposit_cash(:p, 'RUB', 1000000, :u, 'старт', :d)"),
            {"p": pid, "u": fx["trader"], "d": D},
        )
        c.execute(
            text("select ops.execute_trade_fn(:p, :b, 'buy', 100, 99, :u, :d, 2, 0, 'TEST', true)"),
            {"p": pid, "b": fx["bonds"][1], "u": fx["trader"], "d": D},
        )
    yield pid
    drop_portfolio(code)


@pytest.fixture(scope="module")
def empty_pf(fx):
    with connect(admin=True) as c:
        pid = c.execute(
            text(
                "insert into ops.portfolio (code, name, manager_id) values (:c, 'TEST пустой', :m) returning portfolio_id"
            ),
            {"c": f"TEST-{TAG}E", "m": fx["trader"]},
        ).scalar_one()
    return pid  # удаляется общей фикстурой по префиксу кода


# ------------------------------------------------------------------ §3, §20.1: НКД, дата расчётов, курс
def test_accrued_on_settlement_date(fx):
    par = fx["bonds"][1]
    qd = one("select * from ref.bond_quote(:b, :d)", b=par, d=D)
    assert qd["price_source"] == "close" and qd["accrued_interest"] == pytest.approx(100 * 2 / 365)
    later = one("select * from ref.bond_quote(:b, :d)", b=par, d=D + timedelta(days=3))
    assert later["price_source"] == "last" and later["price_date"] == D
    assert one("select ref.add_business_days(:d, 2) as s", d=D)["s"] == S2
    ai = one("select ref.accrued_at_settlement(:b, :d, :s) as v", b=par, d=D, s=S2)["v"]
    assert ai == pytest.approx(10 / 100 * 1000 * 2 / 365)
    sat = one("select * from ref.resolve_settlement(:d, 1, :m)", d=D, m=date(2035, 1, 20))
    assert sat["settlement_date"] == date(2035, 1, 22) and sat["shifted_from"] == date(2035, 1, 20)


def test_fx_previous_business_day_for_past_dates():
    r = one(
        "select risk.fx_at('USD', date '2026-10-27') as a, risk.fx_on('USD', date '2026-10-26') as b,"
        " risk.fx_at('USD', current_date) as c, risk.fx_on('USD', current_date) as d"
    )
    if r["b"] is None:
        pytest.skip("нет курсов ЦБ за октябрь 2026")
    assert r["a"] == r["b"] and r["c"] == r["d"]


def test_price_override_and_cost_fallback(fx, mpf):
    par = fx["bonds"][1]
    q(
        "insert into risk.price_override (bond_id, as_of, clean_price_pct, accrued_interest, reason)"
        " values (:b, :d, 95, 1.5, 'сверка теста')",
        b=par,
        d=D + timedelta(days=1),
    )
    try:
        o = one("select * from ref.bond_quote(:b, :d)", b=par, d=D + timedelta(days=1))
        assert (
            o["price_source"] == "override"
            and o["clean_price_pct"] == 95
            and o["accrued_interest"] == 1.5
        )
    finally:
        q("delete from risk.price_override where bond_id = :b", b=par)
    # котировки нет 90 дней → средняя цена постановки на учёт (99 %)
    far = D + timedelta(days=120)
    v = one(
        "select price_source, clean_price_pct, avg_cost_pct from risk.position_valuation(:p, :d)",
        p=mpf,
        d=far,
    )
    assert v["price_source"] == "cost" and v["clean_price_pct"] == pytest.approx(99)


# ------------------------------------------------------------------ §2: касса по дате сделки и корректировки
def test_cash_trade_date_basis_and_adjustments(mpf):
    bal = float(
        one("select balance from ops.cash_account where portfolio_id = :p", p=mpf)["balance"]
    )
    on_d = one("select amount from risk.cash_by_currency(:p, :d)", p=mpf, d=D)["amount"]
    assert on_d == pytest.approx(bal) and bal < 1_000_000  # нога T+2 учтена в день сделки
    q(
        "insert into risk.cash_adjustment (portfolio_id, currency, as_of, target_balance, reason)"
        " values (:p, 'RUB', :d, 12345, 'тест цели')",
        p=mpf,
        d=D + timedelta(days=1),
    )
    q(
        "insert into risk.cash_adjustment (portfolio_id, currency, shift, reason) values (:p, 'RUB', 100, 'тест сдвига')",
        p=mpf,
    )
    try:
        t = one("select amount from risk.cash_by_currency(:p, :d)", p=mpf, d=D + timedelta(days=1))
        assert t["amount"] == 12345
        past = one("select amount from risk.cash_by_currency(:p, date '2020-01-01')", p=mpf)
        assert past["amount"] == 100  # сдвиг — только исторические срезы
        assert one("select amount from risk.cash_by_currency(:p, :d)", p=mpf, d=D)[
            "amount"
        ] == pytest.approx(bal)
    finally:
        q("delete from risk.cash_adjustment where portfolio_id = :p", p=mpf)


# ------------------------------------------------------------------ §3, §6, §8, §10: потоки, конвексность, DM, Z
def test_convexity_section6_and_zspread(fx):
    par = fx["bonds"][1]
    m = one("select * from ref.bond_metrics(:b, :d)", b=par, d=D)
    # потоки после даты расчётов T+2, как в ref.bond_metrics
    flows = q(
        "select t_years, amount from ref.bond_cash_flows(:b, ref.add_business_days(:d, 2))",
        b=par,
        d=D,
    )
    y = m["ytm"]  # f = 1: n = t, i_p = y
    num = sum(
        f["amount"] * f["t_years"] * (f["t_years"] + 1) / (1 + y) ** (f["t_years"] + 2)
        for f in flows
    )
    den = sum(f["amount"] / (1 + y) ** f["t_years"] for f in flows)
    assert m["convexity"] == pytest.approx(num / den, rel=1e-9) and m["ytm_source"] == "calc"
    assert m["z_spread_bp"] is not None
    assert m["cs01_local"] == pytest.approx(m["dirty_price"] * m["duration_mod"] / 1e4, rel=0.05)


def test_amortization_schedule_control_and_floater_dm(fx):
    with connect(admin=True) as c:
        bad = c.execute(
            text(
                "insert into ref.bond (isin, secid, issuer_id, short_name, face_value_initial, coupon_type, coupon_rate_pct,"
                " coupon_freq, issue_date, maturity_date, board) values (:i, :s, :iss, 'TEST bad amort', 1000, 'fixed', 10, 1,"
                " '2034-01-15', '2037-01-15', 'TQCB') returning bond_id"
            ),
            {"i": f"RU000T{TAG}7", "s": f"TBAD{TAG}", "iss": fx["corp"]},
        ).scalar_one()
        # график больше номинала запрещает правило П2 — для проверки защиты в расчёте потоков (§3) оно
        # отключается на время вставки
        c.execute(text("alter table ref.cash_flow_schedule disable trigger amortization_check"))
        c.execute(
            text(
                "insert into ref.cash_flow_schedule (bond_id, flow_type, pay_date, amount) values"
                " (:b, 'amortization', '2036-01-15', 700), (:b, 'redemption', '2037-01-15', 700)"
            ),
            {"b": bad},
        )
        c.execute(text("alter table ref.cash_flow_schedule enable trigger amortization_check"))
        flt = c.execute(
            text(
                "insert into ref.bond (isin, secid, issuer_id, short_name, face_value_initial, coupon_type, coupon_rate_pct,"
                " coupon_freq, issue_date, maturity_date, board) values (:i, :s, :iss, 'TEST floater', 1000, 'floating', 15, 4,"
                " '2034-01-15', '2036-01-15', 'TQCB') returning bond_id"
            ),
            {"i": f"RU000T{TAG}8", "s": f"TFLT{TAG}", "iss": fx["corp"]},
        ).scalar_one()
        for k in range(4):
            a = date(2035, 1, 15) + timedelta(days=91 * k)
            c.execute(
                text(
                    "insert into ref.cash_flow_schedule (bond_id, flow_type, period, pay_date, rate_pct)"
                    " values (:b, 'coupon', daterange(:a, :e), :e, 15)"
                ),
                {"b": flt, "a": a, "e": a + timedelta(days=91)},
            )
        c.execute(
            text("insert into ts.price_history (ts, bond_id, close_pct) values (:d, :b, 100)"),
            {"d": D, "b": flt},
        )
    try:
        principal = q(
            "select amount from ref.bond_cash_flows(:b, :d) where kind <> 'coupon'", b=bad, d=D
        )
        assert [p["amount"] for p in principal] == [1000]  # график больше номинала — игнорируется
        m = one("select * from ref.bond_metrics(:b, :d)", b=flt, d=D)
        assert m["dm_bp"] is not None and abs(m["dm_bp"]) < 30  # цена у номинала ↔ маржа около нуля
        assert m["duration_mac"] == pytest.approx(89 / 365, rel=1e-6)  # до пересмотра купона от T+2
    finally:
        q("delete from ts.price_history where bond_id = :b", b=flt)
        q("delete from ref.bond where bond_id in (:a, :b)", a=bad, b=flt)


# ------------------------------------------------------------------ §15
def test_withdrawn_rating_keeps_last_known(fx):
    with connect(admin=True) as c:
        iss = c.execute(
            text("insert into ref.issuer (name, sector) values (:n, 'Тест') returning issuer_id"),
            {"n": f"TEST Отозванный {TAG}"},
        ).scalar_one()
        b = c.execute(
            text(
                "insert into ref.bond (isin, secid, issuer_id, short_name, face_value_initial, maturity_date, board)"
                " values (:i, :s, :iss, 'TEST withdrawn', 1000, '2037-01-15', 'TQCB') returning bond_id"
            ),
            {"i": f"RU000T{TAG}9", "s": f"TWDR{TAG}", "iss": iss},
        ).scalar_one()
        c.execute(
            text(
                "insert into ref.credit_rating (agency_id, issuer_id, grade, assigned_on, status, action)"
                " values (2, :i, 'BB+', '2034-05-01', 'withdrawn', 'withdrawn')"
            ),
            {"i": iss},
        )
    try:
        r = one("select * from risk.canonical_rating(:b)", b=b)
        assert r["grade"] == "BB+" and r["source"] == "withdrawn"
    finally:
        q("delete from ref.bond where bond_id = :b", b=b)
        q("delete from ref.issuer where issuer_id = :i", i=iss)


# ------------------------------------------------------------------ §16.2: книга лимитной политики
def _limit(pid: int, **kw) -> int:
    cols = ", ".join(kw)
    vals = ", ".join(f":{k}" for k in kw)
    return one(
        f"insert into risk.risk_limit (portfolio_id, valid_from, {cols}) values (:pid, '2034-01-01', {vals}) returning limit_id",
        pid=pid,
        **kw,
    )["limit_id"]


def _fact(pid: int, lid: int, extra_bond=None, extra_qty=0) -> dict:
    return one(
        "select * from risk.limit_facts(:p, :d, :b, :q) where limit_id = :l",
        p=pid,
        d=D,
        b=extra_bond,
        q=extra_qty,
        l=lid,
    )


def test_limit_book(fx, mpf, empty_pf):
    zero, par, _ = fx["bonds"]
    q("update ref.bond set issue_size = 1000 where bond_id = :b", b=par)
    try:
        by_name = _limit(
            mpf, metric="conc_issuer", scope_name=f"ооо «Test Нефтяник {TAG}»", threshold_abs=1e9
        )
        f = _fact(mpf, by_name)
        # по цене покупки: 100 × (99 % × 1000 + НКД сделки на T+2); рынок — рядом
        assert f["basis"] == "cost" and f["fact_value"] == pytest.approx(
            100 * (990 + 1000 * 0.1 * 2 / 365)
        )
        assert f["fact_market"] > f["fact_value"]
        share = _limit(mpf, metric="conc_issue", scope_bond_id=par, emission_share_pct=5)
        s = _fact(mpf, share)
        assert s["share_fact_pct"] == pytest.approx(10) and s["utilization_pct"] == pytest.approx(
            200
        )
        assert s["status"] == "breach"
        total = _limit(mpf, metric="conc_portfolio", threshold_abs=1_000_000)
        pct_total = _limit(
            mpf,
            metric="conc_sector",
            scope_sector="нефть и газ",
            threshold_pct=5,
            pct_base="total_limit",
        )
        assert _fact(mpf, pct_total)["limit_value"] == pytest.approx(50_000)
        assert _fact(mpf, total)["fact_value"] > 0
        short = _limit(mpf, metric="short_mv", threshold_abs=1e12)
        assert _fact(mpf, short, zero, -10)["status"] == "ok"  # шорт ОФЗ — по лимиту
        assert _fact(mpf, short, par, -200)["status"] == "breach"  # шорт не ОФЗ — нарушение всегда
        spread = _limit(mpf, metric="credit_spread", threshold_abs=10_000)
        assert _fact(mpf, spread)["fact_value"] is not None
        newcomer = _limit(empty_pf, metric="new_issuer_rating", min_grade="A")
        assert _fact(empty_pf, newcomer, par, 10)["status"] == "breach"  # BBB+ хуже A
        assert _fact(empty_pf, newcomer, zero, 10)["status"] == "ok"  # суверен — AAA
        assert _fact(empty_pf, newcomer)["status"] == "ok"
    finally:
        q("update ref.bond set issue_size = null where bond_id = :b", b=par)
        q("delete from risk.risk_limit where portfolio_id in (:a, :b)", a=mpf, b=empty_pf)


def test_committee_self_adjust_threshold(fx, mpf):
    lid = _limit(mpf, metric="dv01", threshold_abs=100_000, committee="IC", self_adjust_pct=10)
    try:
        with pytest.raises(Exception, match="board approval"):
            with connect(admin=True) as c:
                c.execute(
                    text("select set_config('bondrisk.user_id', :u, true)"), {"u": str(fx["risk"])}
                )
                c.execute(
                    text("update risk.risk_limit set threshold_abs = 150000 where limit_id = :l"),
                    {"l": lid},
                )
        with connect(admin=True) as c:
            c.execute(
                text("select set_config('bondrisk.user_id', :u, true)"), {"u": str(fx["risk"])}
            )
            c.execute(
                text("update risk.risk_limit set threshold_abs = 105000 where limit_id = :l"),
                {"l": lid},
            )
            c.execute(
                text("select set_config('bondrisk.user_id', :u, true)"), {"u": str(fx["admin"])}
            )
            c.execute(
                text("update risk.risk_limit set threshold_abs = 200000 where limit_id = :l"),
                {"l": lid},
            )
    finally:
        q("delete from risk.risk_limit where limit_id = :l", l=lid)


# ------------------------------------------------------------------ §13, §17, §18, §20 через API
def test_stress_fx_exposure_includes_cash(client, fx, empty_pf):
    q("call ops.deposit_cash(:p, 'USD', 1000, :u, 'тест', :d)", p=empty_pf, u=fx["trader"], d=D)
    rows = client.get(
        "/api/v1/reports/stress", params={"portfolio_id": empty_pf, "as_of": str(D)}
    ).json()
    usd = next(r for r in rows if r["code"] == "USD+20")
    assert usd["pnl_rub"] == pytest.approx(0.2 * 1000 * 80)
    hist = [r for r in rows if r["episode"]]
    assert {r["kind"] for r in hist} <= {"fx_hist", "ofz_index", "equity_index"}
    assert all(r["severity"] in {"ok", "warning", "critical"} for r in rows)


def test_pnl_attribution_and_fx_reports(client, mpf):
    with connect(admin=True) as c:
        for d in (D, D + timedelta(days=1)):
            c.execute(text("call risk.run_eod(:p, :d)"), {"p": mpf, "d": d})
    rows = client.get(
        "/api/v1/reports/pnl-attribution",
        params={
            "portfolio_id": mpf,
            "date_from": str(D + timedelta(days=1)),
            "date_to": str(D + timedelta(days=1)),
        },
    ).json()
    assert len(rows) == 1
    # цена та же, за день начислен купон 100 ₽ / 365 на бумагу — ценовая компонента по грязной цене
    assert rows[0]["price_pnl"] == pytest.approx(100 * 100 / 365, abs=0.01)  # MV среза — до копейки
    assert rows[0]["total"] == pytest.approx(rows[0]["price_pnl"], rel=1e-9)
    fxp = client.get(
        "/api/v1/reports/fx-position", params={"portfolio_id": mpf, "as_of": str(D)}
    ).json()
    assert [r["currency"] for r in fxp] == ["RUB"] and fxp[0]["revaluation_rub"] is None
    an = client.get(
        "/api/v1/reports/fx-analytics", params={"portfolio_id": mpf, "as_of": str(D)}
    ).json()
    assert an["breakeven"] == [] and an["scenarios"] == []
    cur = client.get(
        "/api/v1/reports/by-currency", params={"portfolio_id": mpf, "as_of": str(D)}
    ).json()
    # DV01 позиции в рублях округлён до рубля (§7), в валюте бумаги — нет
    assert cur[0]["currency"] == "RUB" and cur[0]["dv01_local"] == pytest.approx(
        cur[0]["dv01_rub"], abs=0.5
    )


def test_preview_settlement_and_price(client, fx, mpf):
    r = client.post(
        f"/api/v1/portfolios/{mpf}/trades/preview",
        json={
            "bond_id": fx["bonds"][1],
            "side": "buy",
            "qty": 10,
            "as_of": str(D),
            "clean_price_pct": 98,
            "settlement_date": "2035-01-20",
        },
    )
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["settlement_date"] == "2035-01-22" and b["settlement_shifted_from"] == "2035-01-20"
    assert b["accrued_at_settlement"] == pytest.approx(100 * 7 / 365)
    assert b["amount_rub"] == pytest.approx(10 * (980 + 100 * 7 / 365))


def test_corrections_require_risk_manager(client, risk_client, fx):
    body = {
        "bond_id": fx["bonds"][1],
        "as_of": "2035-02-01",
        "clean_price_pct": 97,
        "reason": "тест API",
    }
    assert client.post("/api/v1/price-overrides", json=body).status_code == 403
    r = risk_client.post("/api/v1/price-overrides", json=body)
    assert r.status_code == 201, r.text
    assert (
        risk_client.delete(f"/api/v1/price-overrides/{fx['bonds'][1]}/2035-02-01").status_code
        == 204
    )
    syn = risk_client.post(
        "/api/v1/synonyms",
        json={"kind": "issuer", "alias": f"ПАО «Тест {TAG}»", "canonical": f"Тест {TAG} Холдинг"},
    )
    assert syn.status_code == 201 and syn.json()["alias"] == f"тест {TAG.lower()}"
    assert risk_client.delete(f"/api/v1/synonyms/issuer/тест {TAG.lower()}").status_code == 204
