-- q07. Динамика цены выпуска: дневное изменение (LAG), скользящее среднее 20 дней, просадка от максимума.
-- Конструкции: оконные функции LAG, AVG OVER (ROWS 19 PRECEDING), MAX OVER (UNBOUNDED PRECEDING), именованное окно.
-- Параметры: :bond_id, :date_from, :date_to
select ts, close_pct, yield_close, volume,
       close_pct - lag(close_pct) over w                                   as chg_abs,
       (close_pct / lag(close_pct) over w - 1) * 100                       as chg_pct,
       avg(close_pct) over (w rows between 19 preceding and current row)   as ma20,
       max(close_pct) over (w rows unbounded preceding)                    as running_max,
       (close_pct / max(close_pct) over (w rows unbounded preceding) - 1) * 100 as drawdown_pct
  from ts.price_history
 where bond_id = :bond_id
   and ts between cast(:date_from as date) and cast(:date_to as date)
   and close_pct is not null
window w as (order by ts)
 order by ts;
