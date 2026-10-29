-- Ручная проверка расчётного ядра на синтетических бумагах с известными ответами.
insert into ref.issuer (name, inn, sector, is_sovereign) values ('Минфин России', '7710168360', 'Государственные', true), ('ООО Тест', '7700000001', 'Прочее', false);
insert into ref.bond (isin, secid, issuer_id, short_name, face_value_initial, coupon_type, coupon_rate_pct, coupon_freq, issue_date, maturity_date)
values ('RU000ZERO001', 'ZERO1', 1, 'Zero 1y', 1000, 'zero', null, 0, '2025-10-25', '2027-10-25'),
       ('RU000PAR0002', 'PAR2', 2, 'Par 10% 2y', 1000, 'fixed', 10, 1, '2025-10-25', '2028-10-25');
insert into ref.cash_flow_schedule (bond_id, flow_type, period, pay_date, rate_pct, amount) values
 (2, 'coupon', daterange('2025-10-25','2026-10-25'), '2026-10-25', 10, 100),
 (2, 'coupon', daterange('2026-10-25','2027-10-25'), '2027-10-25', 10, 100),
 (2, 'coupon', daterange('2027-10-25','2028-10-25'), '2028-10-25', 10, 100),
 (2, 'redemption', null, '2028-10-25', null, 1000);
insert into ts.price_history (ts, bond_id, close_pct) values ('2026-10-25', 1, 82.6446), ('2026-10-25', 2, 100.0);
insert into ts.yield_curve (ts, tenor_years, rate_pct) values ('2026-10-25', 0.25, 13), ('2026-10-25', 1, 14), ('2026-10-25', 2, 15), ('2026-10-25', 5, 16);
insert into ref.credit_rating (agency_id, issuer_id, grade, assigned_on) values (2, 2, 'BBB', '2025-01-10');
insert into ref.credit_rating (agency_id, issuer_id, grade, assigned_on) values (2, 2, 'BBB+', '2026-03-10');
select 'ratings' as t, grade, status, action from ref.credit_rating order by rating_id;
select 'flows' as t, * from ref.bond_cash_flows(2, '2026-10-25');
select 'metrics ZERO 1y @82.6446 (ytm≈0.21, dmac=1)' as t, round(ytm::numeric,6) ytm, round(duration_mac::numeric,4) dmac, round(duration_mod::numeric,4) dmod, round(convexity::numeric,4) cx from ref.bond_metrics(1, '2026-10-25');
select 'metrics PAR 2y (ytm≈0.10, dmac≈1.909)' as t, round(ytm::numeric,6) ytm, round(duration_mac::numeric,4) dmac, round(accrued_interest::numeric,2) ai, round(dv01_local::numeric,4) dv01 from ref.bond_metrics(2, '2026-10-25');
select 'ai PAR mid-period (≈50)' as t, round(ref.accrued_interest(2, '2027-04-25')::numeric, 2);
select 'canon' as t, * from risk.canonical_rating(2);
select 'curve@1.5 (≈14.6)' as t, round(risk.curve_rate_at('2026-10-25', 1.5)::numeric,3);
insert into ops.portfolio (code, name, manager_id) values ('TEST', 'Тестовый', 2);
call ops.deposit_cash(1, 'RUB', 1000000, 1);
call ops.execute_trade(1, 2, 'buy', 500, 100.0, 2, '2026-10-25');
call ops.execute_trade(1, 1, 'buy', 200, 82.6446, 2, '2026-10-25');
select 'pos' as t, bond_id, qty, avg_clean_price_pct, cost_basis from ops.position order by bond_id;
select 'cash' as t, currency, balance from ops.cash_account;
select 'val' as t, bond_id, qty, round(mv_rub::numeric,2) mv, round(dv01_rub::numeric,2) dv01, g_spread_bp, rating_grade, rating_source, round(weight_pct::numeric,1) w from risk.position_valuation(1, '2026-10-25');
select 'pm' as t, round(mv_gross::numeric,2) mvg, round(dv01::numeric,2) dv01, round(adv01::numeric,2) adv01, round(duration_mac::numeric,3) dmac, round(var_99_1d::numeric,2) var, rating_grade, positions_count from risk.portfolio_metrics(1, '2026-10-25');
insert into risk.risk_limit (portfolio_id, metric, threshold_abs, created_by) values (1, 'dv01', 150, 3);
insert into risk.risk_limit (portfolio_id, metric, scope_issuer_id, threshold_pct, created_by) values (1, 'conc_issuer', 2, 50, 3);
select 'limits' as t, limit_id, metric, scope, round(fact_value::numeric,2) fact, round(limit_value::numeric,2) lim, round(utilization_pct::numeric,1) u, status from risk.limit_facts(1, '2026-10-25');
select 'whatif' as t, kind, metric, round(before_value::numeric,2) b, round(after_value::numeric,2) a, status_after from risk.what_if_trade(1, 2, 'buy', 300) ;
call risk.run_eod(1, '2026-10-25');
select 'snap' as t, as_of, mv_gross, dv01, var_99_1d, rating_grade from risk.risk_snapshot;
select 'breach' as t, limit_id, status, utilization_pct from risk.limit_breach;
call risk.waive_breach(1, 3, 'согласовано ИК, позиция сокращается до 01.11');
call risk.run_eod(1, '2026-10-25');
select 'breach2' as t, limit_id, status, waived_by from risk.limit_breach;
call risk.refresh_views();
select 'mv' as t, code, dv01, breaches, warnings from risk.mv_portfolio_risk;
select 'stress' as t, code, round(pnl_rub::numeric) pnl from risk.stress_pnl(1, '2026-10-25') limit 4;
select 'audit' as t, table_name, op, count(*) from audit.audit_log group by table_name, op order by table_name, op;
do $$ begin call ops.execute_trade(1, 2, 'sell', 900, 100.0, 2, '2026-10-25'); exception when others then raise notice 'expected: % %', sqlstate, sqlerrm; end $$;
do $$ begin call ops.execute_trade(1, 2, 'buy', 1000, 100.0, 2, '2026-10-25', 1, 0, null, false); exception when others then raise notice 'expected: % %', sqlstate, sqlerrm; end $$;
do $$ begin call ops.execute_trade(1, 2, 'buy', 100, 100.0, 2, '2026-10-25'); exception when others then raise notice 'expected: % %', sqlstate, sqlerrm; end $$;
