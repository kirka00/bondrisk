-- =====================================================================
--  Представления: лимиты с последним состоянием, журнал сделок; материализованное представление сводки риска по портфелям.
-- =====================================================================
-- Лимиты с разрешённым объектом (эмитент / выпуск / отрасль) и последним состоянием из журнала EOD;
-- источник раздела «Лимиты» API (GET /limits).
create or replace view risk.v_limit_utilization as
select l.limit_id, l.portfolio_id, p.code as portfolio_code, l.metric, l.scope_issuer_id, l.scope_bond_id,
       l.scope_sector, coalesce(i.short_name, i.name, l.scope_name, b.short_name, l.scope_sector) as scope, l.side,
       l.threshold_abs, l.threshold_pct, l.warning_pct, l.is_hard, l.valid_from, l.valid_to, l.created_by, l.created_at,
       lb.as_of as last_as_of, lb.fact_value as last_fact, lb.utilization_pct as last_utilization_pct,
       lb.status as last_status,
       l.basis, l.pct_base, l.emission_share_pct, l.scope_name, l.committee, l.self_adjust_pct, l.min_grade
  from risk.risk_limit l
  join ops.portfolio p on p.portfolio_id = l.portfolio_id
  left join ref.issuer i on i.issuer_id = l.scope_issuer_id
  left join ref.bond b on b.bond_id = l.scope_bond_id
  left join lateral (select * from risk.limit_breach x where x.limit_id = l.limit_id order by x.as_of desc limit 1) lb on true;

create or replace view ops.v_trade_blotter as
select t.trade_id, t.portfolio_id, p.code as portfolio_code, t.bond_id, b.isin, b.short_name, i.name as issuer_name,
       b.currency, t.trade_date, t.trade_ts, t.settlement_date, t.side, t.qty, t.clean_price_pct, t.accrued_interest,
       t.qty * (t.clean_price_pct / 100.0 * ref.face_value_at(t.bond_id, t.trade_date) + t.accrued_interest) as amount,
       t.fee, t.counterparty, t.status, u.login as created_by_login, t.created_at
  from ops.trade t
  join ops.portfolio p on p.portfolio_id = t.portfolio_id
  join ref.bond b on b.bond_id = t.bond_id
  join ref.issuer i on i.issuer_id = b.issuer_id
  left join ops.app_user u on u.user_id = t.created_by;

-- Сводка риска: последний снапшот каждого портфеля + число нарушений; обновляется в EOD.
create materialized view if not exists risk.mv_portfolio_risk as
select p.portfolio_id, p.code, p.name, p.base_currency, p.allow_short, p.status,
       s.as_of, s.mv_net, s.mv_gross, s.cash_total_rub, s.dv01, s.cs01, s.adv01, s.duration_mac, s.duration_mod,
       s.convexity, s.ytm_avg, s.current_yield_avg, s.g_spread_avg_bp, s.var_99_1d, s.rating_score, s.rating_grade,
       s.positions_count, s.dm_avg_bp, s.floater_share_pct,
       (select count(*) from risk.limit_breach lb join risk.risk_limit l on l.limit_id = lb.limit_id
         where l.portfolio_id = p.portfolio_id and lb.as_of = s.as_of and lb.status = 'breach') as breaches,
       (select count(*) from risk.limit_breach lb join risk.risk_limit l on l.limit_id = lb.limit_id
         where l.portfolio_id = p.portfolio_id and lb.as_of = s.as_of and lb.status = 'warning') as warnings
  from ops.portfolio p
  left join lateral (select * from risk.risk_snapshot x where x.portfolio_id = p.portfolio_id order by x.as_of desc limit 1) s on true;
create unique index if not exists mv_portfolio_risk_pk on risk.mv_portfolio_risk (portfolio_id);

grant select on risk.v_limit_utilization, ops.v_trade_blotter,
      risk.mv_portfolio_risk to app_rw, app_ro;
