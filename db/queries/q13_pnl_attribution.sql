-- q13. Экономический P&L по дням (методология §17): ценовая, торговая, купонная и курсовая компоненты,
-- комиссии; агрегирование по дню, неделе или месяцу.
-- Конструкции: табличная функция (CTE, LAG по срезам, LEFT JOIN компонент), date_trunc, GROUP BY.
-- Параметры: :portfolio_id, :date_from, :date_to, :bucket ('day' | 'week' | 'month')
select date_trunc(:bucket, as_of)::date as period,
       sum(price_pnl) as price_pnl, sum(trading_pnl) as trading_pnl, sum(coupon_pnl) as coupon_pnl,
       sum(fx_pnl) as fx_pnl, sum(fees) as fees, sum(total) as total,
       count(*) filter (where method = 'trade_flow') as flow_days
  from risk.pnl_attribution(:portfolio_id, cast(:date_from as date), cast(:date_to as date))
 group by 1
 order by 1;
