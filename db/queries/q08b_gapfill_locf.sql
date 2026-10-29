-- q08b. Тот же fallback средствами TimescaleDB: календарный ряд с заполнением пропусков последней ценой.
-- Конструкции: time_bucket_gapfill, locf(last()), GROUP BY по бакету.
-- Параметры: :bond_id, :date_from, :date_to
select time_bucket_gapfill(interval '1 day', ts, cast(:date_from as date), cast(:date_to as date) + 1) as day,  -- finish исключающий
       last(close_pct, ts)        as close_actual,
       locf(last(close_pct, ts))  as close_filled
  from ts.price_history
 where bond_id = :bond_id and ts between cast(:date_from as date) and cast(:date_to as date)
 group by day
 order by day;
