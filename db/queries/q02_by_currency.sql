-- q02. Разбивка портфеля по валютам выпуска на дату (методология §11): MV_лок, MV₽ нетто/брутто,
-- DV01_лок = Σ sgn(Q)·DV01_лок, средние дюрация и доходность (без флоутеров), стоимость портфеля в валюте.
-- Конструкции: табличная функция (GROUP BY с агрегатами FILTER внутри), HAVING-аналог — отбор ненулевых.
-- Параметры: :portfolio_id, :as_of
select currency, positions, floaters, mv_local, mv_net_rub, mv_gross_rub, dv01_local, dv01_rub,
       duration_mac, ytm_fixed_avg_pct, fx_rate, portfolio_value_in_currency
  from risk.currency_breakdown(:portfolio_id, cast(:as_of as date))
 where mv_gross_rub > 0;
