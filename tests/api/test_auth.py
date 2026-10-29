"""Права доступа: заголовок пользователя обязателен, изменения — только своим ролям."""

from fastapi.testclient import TestClient

TRADE = {"bond_id": 1, "side": "buy", "qty": 1, "clean_price_pct": 100, "trade_date": "2035-01-15"}


def test_missing_or_unknown_user_rejected(fx):
    from bondrisk.api.main import app

    anon = TestClient(app)
    # без заголовка запрос раньше выполнялся как администратор
    assert (
        anon.post("/api/v1/breaches/999999/waive", json={"reason": "проверка"}).status_code == 422
    )
    assert anon.get("/api/v1/portfolios").status_code == 422
    ghost = TestClient(app, headers={"X-User-Id": "99999999"})
    assert ghost.get("/api/v1/portfolios").status_code == 401


def test_roles_on_mutations(client, risk_client, viewer_client, fx):
    pf = fx["pf"]
    r = viewer_client.post(f"/api/v1/portfolios/{pf}/trades", json=TRADE)
    assert r.status_code == 403 and r.json()["code"] == "BR005"
    assert (
        viewer_client.post(
            f"/api/v1/portfolios/{pf}/eod", params={"as_of": "2035-01-15"}
        ).status_code
        == 403
    )
    assert client.delete("/api/v1/limits/999999").status_code == 403
    assert risk_client.delete("/api/v1/limits/999999").status_code == 404
    assert client.post("/api/v1/issuers", json={"name": "x", "sector": "y"}).status_code == 403
    assert (
        risk_client.post(
            f"/api/v1/portfolios/{pf}/cash/deposit", json={"currency": "RUB", "amount": 1}
        ).status_code
        == 403
    )
    # отключить проверку жёстких лимитов трейдер не может
    r = client.post(f"/api/v1/portfolios/{pf}/trades", json={**TRADE, "check_limits": False})
    assert r.status_code == 403 and r.json()["code"] == "BR005"
    # снятие нарушения трейдером — отказ СУБД (BR005) → 403
    assert client.post(
        "/api/v1/breaches/999999/waive", json={"reason": "хочу и всё"}
    ).status_code in (403, 404)


def test_bad_input_is_422_not_500(client):
    assert client.get("/api/v1/bonds", params={"status": "foo"}).status_code == 422
    assert client.get("/api/v1/portfolios/1/risk", params={"days": 100_000_000}).status_code == 422
    assert client.get("/api/v1/portfolios/999999999/trades").status_code == 404
    assert client.get("/api/v1/bonds/999999999/prices").status_code == 404
