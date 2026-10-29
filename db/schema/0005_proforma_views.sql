-- Миграция 0005, часть 2: представление оценки позиций поверх новой сигнатуры функции.
create or replace view ops.v_position_valuation as
select p.portfolio_id, p.code as portfolio_code, v.*
  from ops.portfolio p
  cross join lateral risk.position_valuation(p.portfolio_id, current_date) v
 where p.status = 'active';

grant select on ops.v_position_valuation to app_rw, app_ro;
