-- Миграция 0005: ретроспективная оценка состава (про-форма).
-- Снапшоты получают признак is_proforma; функции оценки — параметр даты состава.
alter table risk.risk_snapshot     add column if not exists is_proforma boolean not null default false;
alter table risk.position_snapshot add column if not exists is_proforma boolean not null default false;

-- представление зависит от функции оценки — пересоздаётся после функций (0005_proforma_views.sql)
drop view if exists ops.v_position_valuation;

-- старые перегрузки функций с прежним набором параметров удаляются, иначе вызовы станут неоднозначными
drop function if exists risk.limit_facts(bigint, date, bigint, bigint);
drop function if exists risk.what_if_trade(bigint, bigint, ops.trade_side, bigint, date);
drop function if exists risk.stress_pnl(bigint, date);
drop function if exists risk.portfolio_metrics(bigint, date, bigint, bigint, double precision, double precision);
drop function if exists risk.position_valuation(bigint, date, bigint, bigint);
drop procedure if exists risk.run_eod(bigint, date);
