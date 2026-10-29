"""Эксперименты производительности (ТЗ §6): EXPLAIN (ANALYZE, BUFFERS) характерных запросов
в нескольких вариантах хранения/индексации на наборах perf разного масштаба (tests/perf/dataset.py);
результат — Markdown-таблица в reports/perf/.

Запуск (после загрузки данных): .venv/bin/python -m tests.perf.explain_report --scales 1,3,10
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

from sqlalchemy import text

from bondrisk.db.engine import get_engine
from tests.perf.dataset import build

OUT = Path("reports/perf")


def explain(conn, sql: str, params: dict | None = None) -> dict:
    rows = (
        conn.execute(text(f"explain (analyze, buffers, format text) {sql}"), params or {})
        .scalars()
        .all()
    )
    plan = "\n".join(rows)

    def grab(pattern):
        m = re.search(pattern, plan)
        return float(m.group(1)) if m else None

    return {
        "planning_ms": grab(r"Planning Time: ([\d.]+) ms"),
        "execution_ms": grab(r"Execution Time: ([\d.]+) ms"),
        "shared_hit": grab(r"shared hit=(\d+)"),
        "shared_read": grab(r"shared read=(\d+)"),
        "node": re.search(r"^\s*(?:->\s*)?([A-Za-z ]+?)(?: on| using|\s+\()", plan.splitlines()[0])
        .group(1)
        .strip()
        if plan
        else "",
        "chunks": len(re.findall(r"_hyper_\d+_\d+_chunk", plan)),
        "plan": plan,
    }


def run(conn, label: str, sql: str, params: dict, repeat: int = 3) -> dict:
    best = None
    for _ in range(repeat):  # лучший из трёх прогонов — убирает прогрев кэша
        r = explain(conn, sql, params)
        if best is None or r["execution_ms"] < best["execution_ms"]:
            best = r
    best["label"] = label
    return best


def measure(c, pf: int, as_of, bond: int) -> tuple[list[dict], tuple[str, str]]:
    """Запросы A–D на текущем наборе схемы perf (см. tests/perf/dataset.py)."""
    results: list[dict] = []
    bonds_sql = "select distinct bond_id from ops.trade where portfolio_id = :pf"

    # A. Цена закрытия всех бумаг портфеля на дату D с fallback 90 дней
    fallback = """
        select b.bond_id, p.close_pct, p.ts
          from ({bonds}) b
          cross join lateral (select close_pct, ts from {tbl}
                               where bond_id = b.bond_id and ts <= :d and ts > :d - 90 and close_pct is not null
                               order by ts desc limit 1) p"""
    for label, tbl in (
        ("A1 обычная таблица, без индекса", "perf.price_plain"),
        ("A2 обычная таблица + btree(bond_id, ts)", "perf.price_btree"),
        ("A3 hypertable (chunk exclusion + индекс)", "perf.price_history"),
    ):
        results.append(
            run(c, label, fallback.format(bonds=bonds_sql, tbl=tbl), {"pf": pf, "d": as_of})
        )
    results.append(
        run(
            c,
            "A4 hypertable, last() по GROUP BY за 90 дней",
            f"""select bond_id, last(close_pct, ts) from perf.price_history
                           where bond_id in ({bonds_sql}) and ts <= :d and ts > :d - 90 and close_pct is not null group by bond_id""",
            {"pf": pf, "d": as_of},
        )
    )

    # B. Ряд одной бумаги за 2 года + скользящее среднее 20 дней
    series = """
        select ts, close_pct, avg(close_pct) over (order by ts rows between 19 preceding and current row)
          from {tbl} where bond_id = :b and ts > :d - 730 and ts <= :d order by ts"""
    for label, tbl in (
        ("B1 обычная таблица, без индекса", "perf.price_plain"),
        ("B2 обычная таблица + btree", "perf.price_btree"),
        ("B3 hypertable", "perf.price_history"),
    ):
        results.append(run(c, label, series.format(tbl=tbl), {"b": bond, "d": as_of}))
    # сжатие чанков старше года и повтор B3
    c.execute(
        text(
            "select compress_chunk(c, if_not_compressed => true)"
            " from show_chunks('perf.price_history', older_than => (:d - interval '1 year')::date) c"
        ),
        {"d": as_of},
    )
    results.append(
        run(
            c,
            "B4 hypertable, старые чанки сжаты",
            series.format(tbl="perf.price_history"),
            {"b": bond, "d": as_of},
        )
    )
    size = c.execute(
        text(
            "select pg_size_pretty(before_compression_total_bytes), pg_size_pretty(after_compression_total_bytes)"
            " from hypertable_compression_stats('perf.price_history')"
        )
    ).one()

    # C. История стоимости портфеля за год: позиции × цены × курс, по неделям
    hist = """
        with pos as (select bond_id, sum(case when side='buy' then qty else -qty end) qty
                       from ops.trade where portfolio_id = :pf and trade_date <= :d group by bond_id having sum(case when side='buy' then qty else -qty end) <> 0)
        select {bucket} as wk, sum(pos.qty * p.close_pct / 100.0 * b.face_value_initial * coalesce(fx.rate_rub, 1)) mv
          from pos join ref.bond b using (bond_id)
          join {tbl} p on p.bond_id = pos.bond_id and p.ts > :d - 365 and p.ts <= :d
          left join ts.fx_rate fx on fx.currency = b.currency and fx.ts = p.ts
         group by 1 order by 1"""
    results.append(
        run(
            c,
            "C1 обычная таблица + btree, date_trunc",
            hist.format(bucket="date_trunc('week', p.ts)", tbl="perf.price_btree"),
            {"pf": pf, "d": as_of},
        )
    )
    results.append(
        run(
            c,
            "C2 hypertable, time_bucket",
            hist.format(bucket="time_bucket('1 week', p.ts)", tbl="perf.price_history"),
            {"pf": pf, "d": as_of},
        )
    )
    # бумаги портфеля уходят в условие индекса (bond_id = any(...)) вместо соединения со всем годом
    results.append(
        run(
            c,
            "C3 hypertable, time_bucket + bond_id = any(бумаги портфеля)",
            hist.format(bucket="time_bucket('1 week', p.ts)", tbl="perf.price_history").replace(
                "p.bond_id = pos.bond_id and",
                "p.bond_id = pos.bond_id and p.bond_id = any(array(select bond_id from pos)) and",
            ),
            {"pf": pf, "d": as_of},
        )
    )

    # D. Стоимость вставки (влияние индексов на запись): 500 бумаг × 100 дней после даты оценки
    ids = c.execute(
        text(
            "select array_agg(bond_id) from (select distinct bond_id from ts.price_history limit 500) x"
        )
    ).scalar_one()
    for label, tbl in (
        ("D1 вставка 50 000 строк: обычная без индекса", "perf.price_plain"),
        ("D2 вставка 50 000 строк: обычная + btree", "perf.price_btree"),
        ("D3 вставка 50 000 строк: hypertable, 3 индекса", "perf.price_history"),
    ):
        best = None
        for _ in range(3):  # каждый прогон откатывается, иначе второй упрётся в PK
            c.execute(text("savepoint sp"))
            r = run(
                c,
                label,
                f"insert into {tbl} (ts, bond_id, close_pct)"
                " select d::date, b, 100 from generate_series(cast(:d as date) + 1, cast(:d as date) + 100, interval '1 day') d,"
                " unnest(cast(:ids as bigint[])) b",
                {"d": as_of, "ids": ids},
                repeat=1,
            )
            c.execute(text("rollback to savepoint sp"))
            if best is None or r["execution_ms"] < best["execution_ms"]:
                best = r
        results.append(best)
    return results, size


def main() -> None:
    ap = argparse.ArgumentParser(
        description="EXPLAIN (ANALYZE, BUFFERS) на наборах разного масштаба"
    )
    ap.add_argument("--scales", default="1,3,10", help="масштабы набора perf через запятую")
    scales = [int(s) for s in ap.parse_args().scales.split(",")]
    eng = get_engine(admin=True)
    OUT.mkdir(parents=True, exist_ok=True)
    with eng.connect() as c:
        pf = (
            c.execute(text("select portfolio_id from ops.portfolio where code = 'RUCB'")).scalar()
            or c.execute(text("select min(portfolio_id) from ops.portfolio")).scalar_one()
        )
        as_of = c.execute(text("select max(ts) from ts.price_history")).scalar_one()
        bond = c.execute(
            text(
                "select bond_id from ts.price_history group by bond_id order by count(*) desc limit 1"
            )
        ).scalar_one()

    runs = []
    for s in scales:
        with eng.begin() as c:
            meta = build(c, s)
        with eng.begin() as c:
            results, size = measure(c, pf, as_of, bond)
        runs.append((meta, results, size))
        print(
            f"масштаб {s}: {meta['rows']:,} строк, построен за {meta['build_s']} с", file=sys.stderr
        )
    with eng.begin() as c:  # набор нужен только на время замеров; пересобрать — tests.perf.dataset
        c.execute(text("drop schema perf cascade"))

    stamp = dt.date.today().isoformat()
    lines = [
        f"# Производительность — {stamp}",
        "",
        f"Набор `perf` (tests/perf/dataset.py): S копий настоящей ts.price_history; портфель {pf}, дата {as_of}, бумага {bond}.",
        "",
        "## Время выполнения, мс (лучший из трёх прогонов)",
        "",
        "| Вариант | "
        + " | ".join(f"S={m['scale']}: {m['rows']:,} строк" for m, _, _ in runs)
        + " |",
        "|---|" + "---|" * len(runs),
    ]
    for i, r in enumerate(runs[0][1]):
        lines.append(
            f"| {r['label']} | " + " | ".join(str(x[1][i]["execution_ms"]) for x in runs) + " |"
        )
    lines += [
        "",
        "Сжатие perf.price_history (чанки старше года): "
        + "; ".join(f"S={m['scale']}: {sz[0]} → {sz[1]}" for m, _, sz in runs)
        + ".",
    ]
    for meta, results, _ in runs:
        lines += [
            "",
            f"## S={meta['scale']}: {meta['rows']:,} строк, построение {meta['build_s']} с",
            "",
            "| Вариант | Узел плана | Чанков | Planning, мс | Execution, мс | shared hit | shared read |",
            "|---|---|---|---|---|---|---|",
        ]
        for r in results:
            lines.append(
                f"| {r['label']} | {r['node']} | {r['chunks']} | {r['planning_ms']} | {r['execution_ms']} | {r['shared_hit']} | {r['shared_read']} |"
            )
    (OUT / f"explain_{stamp}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT / f"plans_{stamp}.txt").write_text(
        "\n\n".join(
            f"=== S={meta['scale']} · {r['label']}\n{r['plan']}"
            for meta, results, _ in runs
            for r in results
        ),
        encoding="utf-8",
    )
    print("\n".join(lines))


if __name__ == "__main__":
    main()
