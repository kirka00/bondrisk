"""Масштабируемый набор для исследования производительности (ТЗ п. 2.2 и §6) в отдельной схеме perf.

Набор масштаба S — S копий настоящей истории котировок ts.price_history: копия k получает
bond_id + k·10⁷ и цену, сдвинутую на k б.п. Распределение по датам и бумагам остаётся реальным,
объём растёт линейно (S = 1 — 546 600 строк, S = 10 — 5,5 млн). Варианты хранения для сравнения:
  perf.price_history — hypertable как ts.price_history (чанк 30 дней, сжатие segmentby bond_id);
  perf.price_plain   — обычная таблица без индексов;
  perf.price_btree   — обычная таблица + btree(bond_id, ts desc).
Рабочие схемы, портфели и интерфейс набор не затрагивает; удалить — drop schema perf cascade.

Запуск: .venv/bin/python -m tests.perf.dataset --scale 5
"""

from __future__ import annotations

import argparse
import time

from sqlalchemy import text

from bondrisk.db.engine import get_engine

COPY_STEP = 10_000_000  # больше любого настоящего bond_id — копии не пересекаются


def build(conn, scale: int) -> dict:
    """Пересоздаёт схему perf с набором масштаба scale; возвращает объём и время построения."""
    if scale < 1:
        raise ValueError("scale ≥ 1")
    t0 = time.perf_counter()
    conn.execute(text("drop schema if exists perf cascade; create schema perf"))
    conn.execute(
        text(
            "create table perf.price_history (like ts.price_history including defaults including constraints including indexes)"
        )
    )
    conn.execute(
        text("select create_hypertable('perf.price_history', by_range('ts', interval '30 days'))")
    )
    conn.execute(
        text(
            "alter table perf.price_history set (timescaledb.compress,"
            " timescaledb.compress_segmentby = 'bond_id', timescaledb.compress_orderby = 'ts desc')"
        )
    )
    conn.execute(
        text(
            """insert into perf.price_history
                 (ts, bond_id, close_pct, yield_close, duration_days, volume, accrued_interest, face_value, source)
               select p.ts, p.bond_id + k * :step, p.close_pct * (1 + k * 0.0001), p.yield_close,
                      p.duration_days, p.volume, p.accrued_interest, p.face_value, 'perf'
                 from ts.price_history p cross join generate_series(0, :s - 1) k"""
        ),
        {"s": scale, "step": COPY_STEP},
    )
    conn.execute(text("create table perf.price_plain as select * from perf.price_history"))
    conn.execute(text("create table perf.price_btree as select * from perf.price_history"))
    conn.execute(text("create index on perf.price_btree (bond_id, ts desc)"))
    conn.execute(
        text("analyze perf.price_history; analyze perf.price_plain; analyze perf.price_btree")
    )
    rows = conn.execute(text("select count(*) from perf.price_plain")).scalar_one()
    return {"scale": scale, "rows": rows, "build_s": round(time.perf_counter() - t0, 1)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--scale", type=int, default=1, help="число копий истории котировок")
    a = ap.parse_args()
    with get_engine(admin=True).begin() as c:
        r = build(c, a.scale)
    print(f"perf: масштаб {r['scale']}, {r['rows']:,} строк, {r['build_s']} с")


if __name__ == "__main__":
    main()
