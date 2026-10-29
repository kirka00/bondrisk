-- q14. Позиции, закрытые внутри периода (методология §17, валовой принцип результата с начала года).
-- Конструкции: табличная функция (GROUP BY … HAVING по остатку, агрегаты FILTER, коррелированные подзапросы).
-- Параметры: :portfolio_id, :date_from, :date_to
select * from risk.closed_positions(:portfolio_id, cast(:date_from as date), cast(:date_to as date));
