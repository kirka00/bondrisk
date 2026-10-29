"""Автообновление: актуальность данных и расписание."""

from datetime import date, datetime

from bondrisk.api.routers.market import MSK, _lag, expected_market_date
from bondrisk.loader.scheduler import next_run


def test_freshness(client):
    r = client.get("/api/v1/market/freshness")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in {"fresh", "late", "stale", "unknown"}
    keys = {s["key"] for s in body["sources"]}
    assert keys == {"prices", "curve", "fx", "eod", "ratings", "reference"}
    prices = next(s for s in body["sources"] if s["key"] == "prices")
    curve = next(s for s in body["sources"] if s["key"] == "curve")
    # дата оценки по умолчанию не опережает ни котировки, ни кривую
    assert body["data_as_of"] == min(prices["as_of"], curve["as_of"])


def test_expected_market_date():
    # итоги дня ждём после 21:00 МСК; до этого — предыдущий рабочий день, выходные пропускаются
    assert expected_market_date(datetime(2026, 10, 28, 18, 0, tzinfo=MSK)) == date(2026, 10, 27)
    assert expected_market_date(datetime(2026, 10, 28, 21, 30, tzinfo=MSK)) == date(2026, 10, 28)
    assert expected_market_date(datetime(2026, 10, 26, 9, 0, tzinfo=MSK)) == date(2026, 10, 23)
    assert expected_market_date(datetime(2026, 10, 25, 23, 0, tzinfo=MSK)) == date(2026, 10, 23)


def test_lag_counts_business_days():
    assert _lag(date(2026, 10, 23), date(2026, 10, 23)) == 0
    assert _lag(date(2026, 10, 23), date(2026, 10, 26)) == 1  # пятница → понедельник
    assert _lag(date(2026, 10, 23), date(2026, 10, 28)) == 3
    assert _lag(None, date(2026, 10, 28)) is None


def test_next_run():
    times = ["21:00", "07:30"]
    assert next_run(datetime(2026, 10, 28, 18, 0, tzinfo=MSK), times) == datetime(
        2026, 10, 28, 21, 0, tzinfo=MSK
    )
    assert next_run(datetime(2026, 10, 28, 21, 0, tzinfo=MSK), times) == datetime(
        2026, 10, 29, 7, 30, tzinfo=MSK
    )
