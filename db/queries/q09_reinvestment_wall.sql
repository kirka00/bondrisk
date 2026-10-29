-- q09. «Стена реинвестирования» (методология §22): доля стоимости портфеля, возвращаемая внутри горизонта
-- N месяцев (погашения тела по графику — с частичными амортизациями и офертами), календарь по месяцам
-- с накопительной долей.
-- Конструкции: табличные функции, date_trunc, GROUP BY, string_agg, SUM() OVER (ORDER BY) — накопительный
-- итог, скалярные подзапросы.
-- Параметры: :portfolio_id, :as_of, :months
with f as (
    select * from risk.reinvestment_wall(:portfolio_id, cast(:as_of as date), :months)
),
total as (
    select sum(abs(mv_rub)) as mv from risk.position_valuation(:portfolio_id, cast(:as_of as date))
),
m as (
    select date_trunc('month', flow_date)::date as month,
           sum(mv_share_rub) as mv_rub, count(distinct bond_id) as positions,
           string_agg(distinct short_name, ', ') as bonds
      from f group by 1
)
select month, mv_rub, positions, bonds,
       sum(mv_rub) over (order by month)                                            as cumulative_rub,
       sum(mv_rub) over (order by month) / nullif((select mv from total), 0) * 100  as cumulative_pct,
       (select sum(mv_share_rub) from f) / nullif((select mv from total), 0) * 100  as share_pct
  from m
 order by month;
