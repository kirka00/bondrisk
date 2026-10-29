-- q16. Аналитика валютной части (методология §22): breakeven-курс по позициям.
-- Конструкции: табличная функция (средневзвешенные по покупкам курс и цена, JOIN с оценкой).
-- Параметры: :portfolio_id, :as_of
select * from risk.fx_breakeven(:portfolio_id, cast(:as_of as date));
