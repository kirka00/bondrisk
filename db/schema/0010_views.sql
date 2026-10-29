-- Миграция 0010: представления, которые никто не читал, удалены; risk.v_limit_utilization
-- пересоздан с полными атрибутами лимита и стал источником GET /limits.
drop view if exists ts.v_latest_price;          -- агрегат по всей истории; цену берут точечным запросом по индексу
drop view if exists ops.v_position_valuation;   -- обёртка над risk.position_valuation с жёсткой current_date
drop view if exists risk.v_limit_utilization;   -- меняется состав колонок — create or replace не подходит
