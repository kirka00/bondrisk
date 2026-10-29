"""Сценарии: касса, сделки, бизнес-правила, лимиты, EOD, снятие нарушений, отчёты."""

import pytest

AS = {"as_of": "2035-01-15"}


@pytest.fixture(scope="module")
def pf(fx):
    return fx["pf"]


def test_portfolio_and_cash(client, pf, fx):
    p = client.get(f"/api/v1/portfolios/{pf}").json()
    assert p["code"].startswith("TEST-") and p["manager_id"] == fx["trader"]
    cash = client.get(f"/api/v1/portfolios/{pf}/cash").json()
    assert cash[0]["currency"] == "RUB" and float(cash[0]["balance"]) == 1_000_000
    r = client.post(
        f"/api/v1/portfolios/{pf}/cash/deposit", json={"currency": "USD", "amount": 5000}
    )
    assert r.status_code == 201 and {c["currency"] for c in r.json()} == {"RUB", "USD"}
    assert client.get("/api/v1/portfolios/999999999").status_code == 404
    lst = client.get("/api/v1/portfolios", params={"status": "active"}).json()
    assert any(x["portfolio_id"] == pf for x in lst["items"])


def test_buy_updates_position_and_cash(client, pf, fx):
    zero, par, usd = fx["bonds"]
    r = client.post(
        f"/api/v1/portfolios/{pf}/trades",
        json={
            "bond_id": par,
            "side": "buy",
            "qty": 500,
            "clean_price_pct": 100.0,
            "trade_date": "2035-01-15",
            "settlement_days": 0,
            "fee": 100,
            "counterparty": "TEST",
        },
    )
    assert r.status_code == 201, r.text
    t = r.json()
    assert (
        t["qty"] == 500 and t["side"] == "buy" and float(t["amount"]) == 500_000
    )  # T+0: НКД = 0 в дату купона
    r2 = client.post(
        f"/api/v1/portfolios/{pf}/trades",
        json={
            "bond_id": zero,
            "side": "buy",
            "qty": 200,
            "clean_price_pct": 82.6446,
            "trade_date": "2035-01-15",
            "settlement_days": 0,
        },
    )
    assert r2.status_code == 201
    pos = client.get(f"/api/v1/portfolios/{pf}/positions", params=AS).json()
    by = {i["bond_id"]: i for i in pos["items"]}
    # §3: в стоимости НКД на дату расчётов T+2 рабочих дня — 2 дня купона 100 ₽ в год на бумагу
    ai_t2 = 500 * 100 * 2 / 365
    assert by[par]["qty"] == 500 and abs(by[par]["mv_rub"] - (500_000 + ai_t2)) < 1e-6
    assert abs(by[zero]["mv_rub"] - 165_289.2) < 0.01
    assert (
        pos["totals"]["positions_count"] == 2
        and abs(pos["totals"]["mv_gross"] - (665_289.2 + ai_t2)) < 0.01
    )
    cash = {
        c["currency"]: float(c["balance"])
        for c in client.get(f"/api/v1/portfolios/{pf}/cash").json()
    }
    assert abs(cash["RUB"] - (1_000_000 - 500_000 - 100 - 165_289.2)) < 0.01
    blotter = client.get(
        f"/api/v1/portfolios/{pf}/trades", params={"side": "buy", "sort": "qty", "order": "asc"}
    ).json()
    assert blotter["total"] == 2 and blotter["items"][0]["qty"] == 200
    audit = client.get(
        "/api/v1/audit", params={"table": "ops.trade", "row_pk": str(t["trade_id"])}
    ).json()
    assert audit["total"] == 1 and audit["items"][0]["app_user_id"] == fx["trader"]


def test_proforma_holdings_date(client, pf):
    """holdings_date задаёт дату состава отдельно от рынка: состав на день до первой сделки пуст."""
    assert client.get(f"/api/v1/portfolios/{pf}").json()["inception_date"] == "2035-01-15"
    fact = client.get(f"/api/v1/portfolios/{pf}/positions", params=AS).json()
    assert fact["holdings_date"] is None and fact["totals"]["positions_count"] == 2
    same = client.get(
        f"/api/v1/portfolios/{pf}/positions", params={**AS, "holdings_date": "2035-01-15"}
    ).json()
    assert same["holdings_date"] == "2035-01-15" and same["totals"] == fact["totals"]
    early = {**AS, "holdings_date": "2035-01-14"}
    assert client.get(f"/api/v1/portfolios/{pf}/positions", params=early).json()["items"] == []
    stress = client.get("/api/v1/reports/stress", params={"portfolio_id": pf, **early}).json()
    # без позиций сценарии по ставкам и индексам нулевые; валютные видят кассу в долларах (§13: E включает K·FX)
    assert stress and all(not s["pnl_rub"] for s in stress if s["kind"] not in ("fx", "fx_hist"))
    stress_fact = client.get("/api/v1/reports/stress", params={"portfolio_id": pf, **AS}).json()
    assert any(s["pnl_rub"] for s in stress_fact)
    lim = client.get(f"/api/v1/portfolios/{pf}/limits", params=early)
    assert lim.status_code == 200


def test_oversell_rejected(client, pf, fx):
    r = client.post(
        f"/api/v1/portfolios/{pf}/trades",
        json={
            "bond_id": fx["bonds"][1],
            "side": "sell",
            "qty": 900,
            "clean_price_pct": 100,
            "trade_date": "2035-01-15",
        },
    )
    assert r.status_code == 409 and r.json()["code"] == "BR001"
    assert "insufficient position" in r.json()["detail"]


def test_insufficient_cash_rejected(admin_client, pf, fx):
    # без проверки лимитов сделку может провести только администратор
    r = admin_client.post(
        f"/api/v1/portfolios/{pf}/trades",
        json={
            "bond_id": fx["bonds"][1],
            "side": "buy",
            "qty": 5000,
            "clean_price_pct": 100,
            "trade_date": "2035-01-15",
            "check_limits": False,
        },
    )
    assert r.status_code == 409 and r.json()["code"] == "BR002"


def test_limits_preview_and_hard_limit(client, risk_client, pf, fx):
    zero, par, usd = fx["bonds"]
    r = risk_client.post(
        "/api/v1/limits", json={"portfolio_id": pf, "metric": "dv01", "threshold_abs": 150}
    )
    assert r.status_code == 201, r.text
    lim_dv01 = r.json()["limit_id"]
    r = risk_client.post(
        "/api/v1/limits",
        json={
            "portfolio_id": pf,
            "metric": "conc_issuer",
            "scope_issuer_id": fx["corp"],
            "threshold_pct": 50,
            "is_hard": False,
        },
    )
    assert r.status_code == 201 and r.json()["scope"].startswith("Нефтяник")
    # неверный scope для метрики → CHECK → 409
    bad = risk_client.post(
        "/api/v1/limits", json={"portfolio_id": pf, "metric": "conc_sector", "threshold_abs": 1}
    )
    assert bad.status_code == 409 and bad.json()["code"] == "23514"
    facts = {
        f["metric"]: f for f in client.get(f"/api/v1/portfolios/{pf}/limits", params=AS).json()
    }
    assert (
        facts["dv01"]["status"] == "ok" and facts["conc_issuer"]["status"] == "breach"
    )  # 500k > 50 % от 665k
    prev = client.post(
        f"/api/v1/portfolios/{pf}/trades/preview",
        json={"bond_id": par, "side": "buy", "qty": 300, **AS},
    ).json()
    assert prev["blocked"] is True
    dv = next(x for x in prev["limits"] if x["limit_id"] == lim_dv01)
    assert dv["status_after"] == "breach" and dv["after"] > 150 > dv["before"]
    assert any(m["metric"] == "dv01" for m in prev["metrics"])
    r = client.post(
        f"/api/v1/portfolios/{pf}/trades",
        json={
            "bond_id": par,
            "side": "buy",
            "qty": 300,
            "clean_price_pct": 100,
            "trade_date": "2035-01-15",
        },
    )
    assert r.status_code == 409 and r.json()["code"] == "BR003" and "dv01" in r.json()["detail"]
    # мягкий лимит не блокирует маленькую сделку
    small = client.post(
        f"/api/v1/portfolios/{pf}/trades/preview",
        json={"bond_id": zero, "side": "buy", "qty": 10, **AS},
    ).json()
    assert small["blocked"] is False
    assert (
        risk_client.patch(f"/api/v1/limits/{lim_dv01}", json={"warning_pct": 60}).json()[
            "warning_pct"
        ]
        == 60.0
    )


def test_eod_breach_waive(client, risk_client, pf, fx):
    r = client.post(f"/api/v1/portfolios/{pf}/eod", params=AS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["snapshot"]["positions_count"] == 2 and float(
        body["snapshot"]["mv_gross"]
    ) == pytest.approx(665_289.2 + 500 * 100 * 2 / 365, abs=0.01)  # НКД на T+2 (§3)
    by_status = {b["status"]: b for b in body["breaches"]}
    assert set(by_status) == {
        "breach",
        "warning",
    }  # conc_issuer — нарушение, dv01 (порог 60 %) — предупреждение
    breach_id = by_status["breach"]["breach_id"]
    risk = client.get(f"/api/v1/portfolios/{pf}/risk").json()
    assert risk["latest"]["as_of"] == "2035-01-15" and float(
        risk["latest"]["dv01"]
    ) == pytest.approx(101, abs=1)
    # трейдер не может снять нарушение
    r = client.post(f"/api/v1/breaches/{breach_id}/waive", json={"reason": "хочу и всё"})
    assert r.status_code == 403 and r.json()["code"] == "BR005"
    assert (
        client.post(f"/api/v1/breaches/{breach_id}/waive", json={"reason": "x"}).status_code == 422
    )
    r = risk_client.post(
        f"/api/v1/breaches/{breach_id}/waive",
        json={"reason": "Согласовано ИК, позиция сокращается"},
    )
    assert (
        r.status_code == 200
        and r.json()["status"] == "waived"
        and r.json()["waived_by"] == fx["risk"]
    )
    # повторный EOD сохраняет снятие
    client.post(f"/api/v1/portfolios/{pf}/eod", params=AS)
    lst = client.get("/api/v1/breaches", params={"portfolio_id": pf, "status": "waived"}).json()
    assert lst["total"] == 1 and lst["items"][0]["breach_id"] == breach_id
    assert client.get("/api/v1/breaches", params={"portfolio_id": pf}).json()["total"] == 2
    summary = client.get("/api/v1/reports/summary").json()
    me = next(x for x in summary if x["portfolio_id"] == pf)
    assert me["breaches"] == 0 and me["warnings"] == 1 and me["positions_count"] == 2


def test_reports_structure_and_values(client, pf, fx):
    zero, par, usd = fx["bonds"]
    P = {"portfolio_id": pf, **AS}
    stress = client.get("/api/v1/reports/stress", params=P).json()
    assert {s["code"] for s in stress} >= {"P+100", "STEEP", "USD+20"}
    p100 = next(s for s in stress if s["code"] == "P+100")
    assert (
        p100["pnl_rub"] < 0 and abs(p100["pnl_rub"] + 100.56 * 100) < 200
    )  # −DV01·100 + выпуклость
    # ADV01: ОФЗ (AAA, coef 0.9) и BBB+ (бакет BBB, coef 1.25) — известные бакеты
    adv = client.get("/api/v1/reports/adv01", params=P).json()
    by = {a["bucket"]: a for a in adv}
    assert set(by) == {"AAA", "BBB"} and by["BBB"]["issuer_level_ratings"] == 1
    assert by["AAA"]["adv01"] == pytest.approx(by["AAA"]["net_dv01"] * 0.9, rel=1e-6)
    assert adv[0]["adv01_total"] == pytest.approx(sum(a["adv01"] for a in adv), rel=1e-6)
    spreads = client.get("/api/v1/reports/spreads", params=P).json()
    inc = {s["bond_id"]: s for s in spreads["items"]}
    assert inc[zero]["included"] is False and "суверен" in inc[zero]["exclusion_reason"]
    assert inc[par]["included"] is True and spreads["avg_spread_bp"] == inc[par]["g_spread_bp"]
    # стена реинвестирования: zero гасится через 12 мес → в 18-мес. горизонте только он (24.8 % MV)
    wall = client.get("/api/v1/reports/reinvestment-wall", params={**P, "months": 18}).json()
    assert len(wall["items"]) == 1 and wall["items"][0]["month"] == "2036-01-01"
    assert wall["share_pct"] == pytest.approx(
        165_289.2 / (665_289.2 + 500 * 100 * 2 / 365) * 100, rel=1e-6
    )
    wall36 = client.get("/api/v1/reports/reinvestment-wall", params={**P, "months": 36}).json()
    assert wall36["share_pct"] == pytest.approx(100, rel=1e-9) and wall36["items"][-1][
        "cumulative_pct"
    ] == pytest.approx(100, rel=1e-9)
    # P&L: куплено по цене = текущей → 0 по цене; остаётся НКД на дату расчётов T+2 (§3, §17)
    pnl = {x["bond_id"]: x for x in client.get("/api/v1/reports/pnl", params=P).json()}
    assert len(pnl) == 2 and abs(pnl[zero]["unrealized_rub"]) < 1e-6
    assert pnl[par]["unrealized_rub"] == pytest.approx(500 * 100 * 2 / 365, abs=1e-6)
    assert abs(pnl[par]["price_pnl_local"]) < 1e-6
    rank = client.get("/api/v1/reports/positions-rank", params=P).json()
    assert (
        rank[0]["mv_rank"] == 1
        and rank[0]["bond_id"] == par
        and rank[-1]["cum_weight_pct"] == pytest.approx(100, rel=1e-9)
    )
    cur = client.get("/api/v1/reports/by-currency", params=P).json()
    assert len(cur) == 1 and cur[0]["currency"] == "RUB" and cur[0]["positions"] == 2
    cov = client.get("/api/v1/reports/limit-coverage", params=P).json()
    assert cov == []  # у единственного несуверенного эмитента лимит есть
    gaps = client.get(
        "/api/v1/reports/price-gaps", params={"as_of": "2035-01-20", "portfolio_id": pf}
    ).json()
    assert len(gaps) == 2 and all(g["days_stale"] == 5 for g in gaps)
    mig = client.get("/api/v1/reports/rating-migrations", params={"issuer_id": fx["corp"]}).json()
    assert [m["migration"] for m in mig] == ["upgrade", "initial"] and mig[0]["notches"] == 1


def test_sell_reduces_position(client, pf, fx):
    par = fx["bonds"][1]
    r = client.post(
        f"/api/v1/portfolios/{pf}/trades",
        json={
            "bond_id": par,
            "side": "sell",
            "qty": 100,
            "clean_price_pct": 101,
            "trade_date": "2035-01-15",
        },
    )
    assert r.status_code == 201
    pos = client.get(f"/api/v1/portfolios/{pf}/positions", params=AS).json()
    assert next(i for i in pos["items"] if i["bond_id"] == par)["qty"] == 400
    pnl = client.get("/api/v1/reports/pnl", params={"portfolio_id": pf, **AS}).json()
    assert next(x for x in pnl if x["bond_id"] == par)["qty"] == 400
