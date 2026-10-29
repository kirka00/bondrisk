"""Индексы MOEX и исторические стресс-сценарии (методология §13, §22).

Ряды: индекс гособлигаций полной доходности RGBITR, индекс акций IMOEX, ставка овернайт-фондирования в
юанях RUSFAR CNY (ts.index_value); курсы ЦБ — ts.fx_rate. Набор исторических эпизодов фиксирован:
кризисные периоды × горизонты от одного дня до года; для каждого фактора берётся окно с наибольшим
падением (неблагоприятное для длинной позиции: в индексе, курсе и облигациях портфели проекта длинные),
начинающееся внутри кризисного периода.
"""

from __future__ import annotations

import logging
from bisect import bisect_left
from datetime import date

from sqlalchemy import text

from bondrisk.loader.db import LoadRun, rows, tx
from bondrisk.loader.moex import MoexClient

log = logging.getLogger("bondrisk.indexes")

INDEXES = ("RGBITR", "IMOEX", "RUSFARCNY")
EPISODES = (
    ("2014", "Рублёвый кризис 2014", date(2014, 11, 1), date(2015, 2, 27)),
    ("2020", "COVID-19, март 2020", date(2020, 2, 20), date(2020, 4, 30)),
    ("2022", "Февраль — июнь 2022", date(2022, 2, 14), date(2022, 6, 30)),
    ("2023", "Девальвация лета 2023", date(2023, 7, 1), date(2023, 10, 31)),
    ("2024", "Ноябрь 2024: санкции и ключевая 21 %", date(2024, 10, 15), date(2024, 12, 31)),
)
HORIZONS = ((1, "1 день"), (5, "1 неделя"), (21, "1 месяц"), (63, "3 месяца"), (252, "1 год"))
# вид сценария, фактор, ряд, подпись
FACTORS = (
    ("fx_hist", "CNY", "fx:CNY", "юань"),
    ("fx_hist", "USD", "fx:USD", "доллар"),
    ("ofz_index", None, "idx:RGBITR", "индекс гособлигаций RGBITR"),
    ("equity_index", None, "idx:IMOEX", "индекс акций IMOEX, β = 0,15"),
)
EQUITY_BETA = 0.15  # §13: по умолчанию, настраивается в risk.stress_scenario.beta


def load_indexes(date_from: date, date_to: date) -> None:
    run = LoadRun("load indexes", {"from": str(date_from), "to": str(date_to)})
    client = MoexClient()
    for code in INDEXES:
        out: list[dict] = []
        start = 0
        while True:
            d = client.get(
                f"history/engines/stock/markets/index/securities/{code}",
                **{
                    "from": str(date_from),
                    "till": str(date_to),
                    "start": start,
                    "iss.only": "history",
                    "history.columns": "TRADEDATE,CLOSE",
                },
            )
            page = client.rows(d.get("history"))
            out.extend(r for r in page if r.get("CLOSE") is not None)
            if len(page) < 100:
                break
            start += 100
        with tx() as c:
            for i in range(0, len(out), 2000):
                c.execute(
                    text(
                        "insert into ts.index_value (index_code, ts, value) values (:c, :t, :v) "
                        "on conflict (index_code, ts) do update set value = excluded.value"
                    ),
                    [
                        {"c": code, "t": r["TRADEDATE"], "v": float(r["CLOSE"])}
                        for r in out[i : i + 2000]
                    ],
                )
        run.ok += len(out)
        log.info("%s: %d values", code, len(out))
    run.finish()


def _series(key: str) -> tuple[list[date], list[float]]:
    kind, code = key.split(":")
    sql = (
        "select ts, rate_rub as v from ts.fx_rate where currency = :c order by ts"
        if kind == "fx"
        else "select ts, value as v from ts.index_value where index_code = :c order by ts"
    )
    r = rows(sql, c=code)
    return [x["ts"] for x in r], [float(x["v"]) for x in r]


def _worst_window(
    ds: list[date], vs: list[float], a: date, b: date, h: int
) -> tuple[date, date, float] | None:
    """Окно в h наблюдений, начинающееся в [a, b], с наименьшим изменением v_end / v_start − 1."""
    best: tuple[date, date, float] | None = None
    for i in range(bisect_left(ds, a), len(ds)):
        if ds[i] > b or i + h >= len(ds):
            break
        ch = vs[i + h] / vs[i] - 1
        if best is None or ch < best[2]:
            best = (ds[i], ds[i + h], ch)
    return best


def build_historical_scenarios() -> int:
    """Фиксированный набор исторических эпизодов → risk.stress_scenario (идемпотентно по коду)."""
    series = {f[2]: _series(f[2]) for f in FACTORS}
    n = 0
    with tx() as c:
        for ep, ep_name, a, b in EPISODES:
            for h, h_name in HORIZONS:
                for kind, cur, key, label in FACTORS:
                    ds, vs = series[key]
                    w = _worst_window(ds, vs, a, b, h)
                    if w is None:
                        continue
                    code = f"H{ep}-{key.split(':')[1]}-{h}D"
                    c.execute(
                        text(
                            """
                            insert into risk.stress_scenario (code, name, kind, fx_currency, episode, horizon_days,
                                                              date_from, date_to, change_pct, beta)
                            values (:code, :name, cast(:kind as risk.scenario_kind), :cur, :ep, :h, :d0, :d1, :ch, :beta)
                            on conflict (code) do update set
                                name = excluded.name, episode = excluded.episode, horizon_days = excluded.horizon_days,
                                date_from = excluded.date_from, date_to = excluded.date_to,
                                change_pct = excluded.change_pct, beta = coalesce(risk.stress_scenario.beta, excluded.beta)
                            """
                        ),
                        {
                            "code": code,
                            "name": f"{ep_name}: {label}, {h_name}",
                            "kind": kind,
                            "cur": cur,
                            "ep": ep_name,
                            "h": h,
                            "d0": w[0],
                            "d1": w[1],
                            "ch": round(w[2] * 100, 4),
                            "beta": EQUITY_BETA if kind == "equity_index" else None,
                        },
                    )
                    n += 1
    log.info("historical scenarios: %d", n)
    return n
