-- Миграция 0003: временные ряды переводятся в hypertables TimescaleDB с сохранением данных
-- (migrate_data => true), включаются сжатие и непрерывные агрегаты.

select create_hypertable('ts.price_history',      by_range('ts', interval '1 month'), migrate_data => true);
select create_hypertable('ts.fx_rate',            by_range('ts', interval '1 year'),  migrate_data => true);
select create_hypertable('ts.yield_curve',        by_range('ts', interval '1 year'),  migrate_data => true);
select create_hypertable('risk.risk_snapshot',    by_range('as_of', interval '1 year'), migrate_data => true);
select create_hypertable('risk.position_snapshot', by_range('as_of', interval '1 month'), migrate_data => true);

-- индекс под основной паттерн: «цены одной бумаги за период, свежие первыми»
create index if not exists price_history_bond_ts_idx on ts.price_history (bond_id, ts desc);

-- сжатие старых чанков котировок: сегмент по бумаге, порядок по времени
alter table ts.price_history set (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'bond_id',
    timescaledb.compress_orderby   = 'ts desc'
);
select add_compression_policy('ts.price_history', interval '1 year');

-- непрерывный агрегат: месячные свечи по бумаге
create materialized view ts.price_1m
with (timescaledb.continuous) as
select time_bucket(interval '1 month', ts) as bucket,
       bond_id,
       first(close_pct, ts)  as open_pct,
       max(close_pct)        as high_pct,
       min(close_pct)        as low_pct,
       last(close_pct, ts)   as close_pct,
       avg(close_pct)        as avg_pct,
       avg(yield_close)      as avg_yield,
       sum(volume)           as volume,
       count(*)              as trading_days
from ts.price_history
group by bucket, bond_id
with no data;
select add_continuous_aggregate_policy('ts.price_1m',
    start_offset => interval '3 years', end_offset => interval '1 day', schedule_interval => interval '1 day');

-- недельный агрегат: реализованная волатильность цены (для stretch-VaR)
create materialized view ts.price_1w
with (timescaledb.continuous) as
select time_bucket(interval '1 week', ts) as bucket,
       bond_id,
       last(close_pct, ts) as close_pct,
       avg(yield_close)    as avg_yield,
       stddev_samp(close_pct) as price_stddev,
       count(*)            as trading_days
from ts.price_history
group by bucket, bond_id
with no data;

grant select on ts.price_1m, ts.price_1w to app_rw, app_ro;
