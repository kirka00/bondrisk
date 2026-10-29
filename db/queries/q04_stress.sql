-- q04. Стресс-сценарии (методология §13): параллельные сдвиги, твисты, гипотетические и исторические
-- валютные сценарии, исторические сценарии по индексам гособлигаций и акций; пометка критичности.
-- Реализация — табличная функция risk.stress_pnl (CTE по метрикам и экспозициям × сценарии, CASE по виду).
-- Параметры: :portfolio_id, :as_of, :holdings_date (null — фактический состав; дата — про-форма)
select code, name, kind, pnl_rub, pnl_pct_of_mv, episode, horizon_days, date_from, date_to, change_pct, severity
  from risk.stress_pnl(:portfolio_id, cast(:as_of as date), cast(:holdings_date as date));
