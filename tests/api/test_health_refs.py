"""Служебные эндпоинты и CRUD справочников."""

from tests.conftest import TAG


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["timescaledb"].startswith("2.")
    assert body["alembic_revision"] is not None
    assert client.get("/health").status_code == 200


def test_openapi(client):
    r = client.get("/api/v1/openapi.json")
    assert r.status_code == 200 and "/api/v1/portfolios/{portfolio_id}/trades" in r.json()["paths"]


def test_users(client):
    users = client.get("/api/v1/users").json()
    assert {u["login"] for u in users} >= {"admin", "trader", "risk"}


def test_issuer_crud(client, admin_client):
    body = {"name": f"TEST CRUD Issuer {TAG}", "inn": "7701234567", "sector": "Тест"}
    r = admin_client.post("/api/v1/issuers", json=body)
    assert r.status_code == 201, r.text
    iid = r.json()["issuer_id"]
    assert client.get(f"/api/v1/issuers/{iid}").json()["name"] == body["name"]
    # уникальность ИНН → 409
    r2 = admin_client.post("/api/v1/issuers", json={**body, "name": "другой"})
    assert r2.status_code == 409 and r2.json()["code"] == "23505"
    # валидация → 422
    assert admin_client.post("/api/v1/issuers", json={"name": "x", "inn": "12"}).status_code == 422
    r3 = admin_client.patch(f"/api/v1/issuers/{iid}", json={"sector": "Тест-2"})
    assert r3.json()["sector"] == "Тест-2"
    # фильтр и пагинация
    lst = client.get("/api/v1/issuers", params={"q": f"CRUD Issuer {TAG}", "limit": 5}).json()
    assert lst["total"] == 1 and lst["items"][0]["issuer_id"] == iid and lst["limit"] == 5
    assert admin_client.delete(f"/api/v1/issuers/{iid}").status_code == 204
    assert client.get(f"/api/v1/issuers/{iid}").status_code == 404


def test_bond_crud_and_restrict(client, admin_client, fx):
    body = {
        "isin": f"RU000C{TAG}9",
        "secid": f"TCRUD{TAG}",
        "issuer_id": fx["corp"],
        "short_name": "TEST CRUD",
        "face_value_initial": 1000,
        "coupon_type": "fixed",
        "coupon_rate_pct": 9.5,
        "coupon_freq": 2,
        "maturity_date": "2040-01-01",
    }
    r = admin_client.post("/api/v1/bonds", json=body)
    assert r.status_code == 201, r.text
    bid = r.json()["bond_id"]
    assert r.json()["rating_grade"] == "BBB+" and r.json()["rating_source"] == "issuer"
    # CHECK: zero-купон со ставкой → 409 check_violation
    bad = {
        **body,
        "isin": f"RU000D{TAG}8",
        "secid": f"TBAD{TAG}",
        "coupon_type": "zero",
        "coupon_rate_pct": 5,
    }
    r_bad = admin_client.post("/api/v1/bonds", json=bad)
    assert r_bad.status_code == 409 and r_bad.json()["code"] == "23514"
    # неизвестный эмитент → 409 FK
    assert (
        admin_client.post(
            "/api/v1/bonds", json={**bad, "coupon_type": "fixed", "issuer_id": 999999999}
        ).status_code
        == 409
    )
    # удалить эмитента с выпусками нельзя (RESTRICT)
    r_del = admin_client.delete(f"/api/v1/issuers/{fx['corp']}")
    assert r_del.status_code == 409 and r_del.json()["code"] in ("23503", "23001")
    assert (
        admin_client.patch(f"/api/v1/bonds/{bid}", json={"list_level": 2}).json()["list_level"] == 2
    )
    assert client.get(f"/api/v1/bonds/{bid}/schedule").json() == []
    assert admin_client.delete(f"/api/v1/bonds/{bid}").status_code == 204


def test_bonds_list_filters_sort(client, fx):
    r = client.get(
        "/api/v1/bonds",
        params={"issuer_id": fx["corp"], "sort": "short_name", "order": "desc", "limit": 1},
    )
    body = r.json()
    assert (
        body["total"] == 2
        and len(body["items"]) == 1
        and body["items"][0]["short_name"] == "TEST USD 10% 2y"
    )
    r2 = client.get("/api/v1/bonds", params={"issuer_id": fx["corp"], "currency": "USD"}).json()
    assert r2["total"] == 1 and r2["items"][0]["currency"] == "USD"
    assert client.get("/api/v1/bonds", params={"sort": "drop table"}).status_code == 422
    q = client.get("/api/v1/bonds", params={"q": f"TPAR{TAG}"}).json()
    assert q["total"] == 1


def test_bond_metrics_schedule_ratings_prices(client, fx):
    zero, par, usd = fx["bonds"]
    m = client.get(f"/api/v1/bonds/{zero}/metrics", params={"as_of": fx["as_of"]}).json()
    # цена задана под 21 % на год от даты оценки; потоки считаются от расчётов T+2 (за 363 дня)
    t = 363 / 365
    assert abs(m["ytm_pct"] - (1.21 ** (1 / t) - 1) * 100) < 0.01
    assert abs(m["duration_mac"] - t) < 1e-6
    assert m["rating"]["source"] == "sovereign" and m["rating"]["grade"] == "AAA"
    m2 = client.get(f"/api/v1/bonds/{par}/metrics", params={"as_of": fx["as_of"]}).json()
    assert abs(m2["ytm_pct"] - 10.0) < 0.05 and 1.90 < m2["duration_mac"] < 1.92
    assert m2["g_spread_bp"] is not None
    sched = client.get(f"/api/v1/bonds/{par}/schedule").json()
    assert (
        len(sched) == 4
        and sched[0]["flow_type"] == "coupon"
        and sched[0]["period_start"] == "2034-01-15"
    )
    hist = client.get(f"/api/v1/bonds/{par}/ratings").json()
    assert [h["grade"] for h in hist] == ["BBB+", "BBB"] and hist[1]["status"] == "superseded"
    assert hist[0]["action"] == "upgraded"
    prices = client.get(
        f"/api/v1/bonds/{par}/prices", params={"date_from": "2035-01-01", "date_to": "2035-01-31"}
    ).json()
    assert len(prices) == 1 and prices[0]["close_pct"] == 100.0
    monthly = client.get(
        f"/api/v1/bonds/{par}/prices",
        params={"bucket": "month", "date_from": "2035-01-01", "date_to": "2035-01-31"},
    ).json()
    assert len(monthly) == 1
    dyn = client.get(
        f"/api/v1/bonds/{par}/dynamics", params={"date_from": "2035-01-01", "date_to": "2035-01-31"}
    ).json()
    assert dyn[0]["running_max"] == 100.0
    gap = client.get(
        f"/api/v1/bonds/{par}/gapfill", params={"date_from": "2035-01-13", "date_to": "2035-01-17"}
    ).json()
    assert len(gap) == 5 and gap[-1]["close_filled"] == 100.0 and gap[-1]["close_actual"] is None


def test_market(client, fx):
    c = client.get("/api/v1/market/curve", params={"as_of": fx["as_of"]}).json()
    assert c["curve_date"] == str(fx["as_of"]) and len(c["points"]) == 5
    fxr = client.get("/api/v1/market/fx", params={"as_of": fx["as_of"]}).json()
    assert any(x["currency"] == "USD" and x["rate_rub"] == 80.0 for x in fxr)
