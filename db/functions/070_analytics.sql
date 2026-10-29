-- =====================================================================
--  Портфельная аналитика: разбивка по валютам (§11), P&L (§17), ОВП и переоценка (§18),
--  аналитика валютной части и стена реинвестирования (§22).
-- =====================================================================

-- Разбивка по валютам (§11): MV_лок (со знаком), MV₽ нетто и брутто, DV01_лок = Σ sgn(Q)·DV01_лок,i,
-- средневзвешенные дюрация Маколея и доходность (доходность — без флоутеров, §4), стоимость портфеля в
-- валюте X = MV_портф / FX_X.
create or replace function risk.currency_breakdown(p_portfolio_id bigint, p_as_of date)
returns table (currency char(3), positions bigint, floaters bigint, mv_local double precision,
               mv_net_rub double precision, mv_gross_rub double precision, dv01_local double precision,
               dv01_rub double precision, duration_mac double precision, ytm_fixed_avg_pct double precision,
               fx_rate double precision, portfolio_value_in_currency double precision)
language sql stable as $$
    with v as (select * from risk.position_valuation(p_portfolio_id, p_as_of)),
         tot as (select sum(abs(mv_rub)) as gross from v)
    select v.currency, count(*), count(*) filter (where v.coupon_type = 'floating'),
           sum(v.mv_local), sum(v.mv_rub), sum(abs(v.mv_rub)),
           sum(sign(v.qty) * v.dv01_local), sum(sign(v.qty) * v.dv01_rub),
           sum(v.duration_mac * abs(v.mv_rub)) / nullif(sum(abs(v.mv_rub)) filter (where v.duration_mac is not null), 0),
           sum(v.ytm_pct * abs(v.mv_rub)) filter (where v.coupon_type <> 'floating')
             / nullif(sum(abs(v.mv_rub)) filter (where v.coupon_type <> 'floating' and v.ytm_pct is not null), 0),
           max(v.fx_rate), (select gross from tot) / nullif(max(v.fx_rate), 0)
      from v group by v.currency
     order by sum(abs(v.mv_rub)) desc
$$;

-- Экономический P&L (§17) по дням между фактическими срезами EOD: ценовая компонента (утренняя позиция по
-- грязной цене между D−1 и D), торговая (сделки дня по цене закрытия против уплаченного), купонная (купоны,
-- амортизации и погашения, зачисленные в кассу, — компенсация падения НКД и номинала), курсовая (движение
-- курса ЦБ); комиссии вычитаются; всё в рублях. День без предыдущего среза — результат торгового потока:
-- Σ продажи − Σ покупки − комиссии.
create or replace function risk.pnl_attribution(p_portfolio_id bigint, p_from date, p_to date)
returns table (as_of date, method text, price_pnl double precision, trading_pnl double precision,
               coupon_pnl double precision, fx_pnl double precision, fees double precision, total double precision)
language sql stable as $$
    with days as (
        select s.as_of,
               lag(s.as_of) over (order by s.as_of) as prev
          from risk.risk_snapshot s
         where s.portfolio_id = p_portfolio_id and not s.is_proforma
           and s.as_of <= p_to
           and s.as_of >= coalesce((select max(x.as_of) from risk.risk_snapshot x
                                     where x.portfolio_id = p_portfolio_id and not x.is_proforma and x.as_of < p_from), p_from)),
    d as (select * from days where as_of >= p_from),
    -- утренняя позиция: срез предыдущего дня; грязная цена конца дня — срез дня, иначе котировка
    morning as (
        select d.as_of, ps.bond_id, ps.qty::double precision as q0,
               ps.mv_rub / nullif(ps.qty * ps.fx_rate, 0) as dirty0, ps.fx_rate as fx0
          from d join risk.position_snapshot ps
            on ps.portfolio_id = p_portfolio_id and ps.as_of = d.prev and not ps.is_proforma),
    close1 as (
        select d.as_of, b.bond_id, b.secid, b.currency,
               coalesce(ps.mv_rub / nullif(ps.qty * ps.fx_rate, 0),
                        (select qq.dirty_price from ref.bond_quote(b.bond_id, d.as_of) qq), 0) as dirty1,
               coalesce(ps.fx_rate, risk.fx_at(b.currency, d.as_of)) as fx1
          from d
          join ref.bond b on b.bond_id in (
                select m.bond_id from morning m where m.as_of = d.as_of
                union select t.bond_id from ops.trade t
                       where t.portfolio_id = p_portfolio_id and t.trade_date > coalesce(d.prev, d.as_of - 1)
                         and t.trade_date <= d.as_of and t.status <> 'cancelled')
          left join risk.position_snapshot ps
            on ps.portfolio_id = p_portfolio_id and ps.as_of = d.as_of and ps.bond_id = b.bond_id and not ps.is_proforma),
    pr as (
        select c.as_of, sum(m.q0 * (c.dirty1 - m.dirty0) * m.fx0) as price_pnl,
                        sum(m.q0 * c.dirty1 * (c.fx1 - m.fx0)) as fx_pnl
          from morning m join close1 c on c.as_of = m.as_of and c.bond_id = m.bond_id
         group by c.as_of),
    tr as (
        select d.as_of,
               sum(case when t.side = 'buy' then 1 else -1 end * t.qty
                   * (c.dirty1 * c.fx1 - (t.clean_price_pct / 100.0 * ref.face_value_at(t.bond_id, t.trade_date)
                                          + t.accrued_interest) * risk.fx_on(c.currency, t.trade_date))) as trading_pnl,
               sum(t.fee * risk.fx_on(c.currency, t.trade_date)) as fees,
               sum(case when t.side = 'sell' then 1 else -1 end * t.qty
                   * (t.clean_price_pct / 100.0 * ref.face_value_at(t.bond_id, t.trade_date) + t.accrued_interest)
                   * risk.fx_on(c.currency, t.trade_date)) as flow
          from d
          join ops.trade t on t.portfolio_id = p_portfolio_id and t.status <> 'cancelled'
                          and t.trade_date > coalesce(d.prev, d.as_of - 1) and t.trade_date <= d.as_of
          join close1 c on c.as_of = d.as_of and c.bond_id = t.bond_id
         group by d.as_of),
    cp as (
        select d.as_of, sum(m.amount * risk.fx_on(a.currency, m.value_date)) as coupon_pnl
          from d
          join ops.cash_account a on a.portfolio_id = p_portfolio_id
          join ops.cash_movement m on m.cash_account_id = a.cash_account_id and m.kind in ('coupon', 'redemption')
                                  and m.value_date > d.prev and m.value_date <= d.as_of
         group by d.as_of)
    select d.as_of,
           case when d.prev is null then 'trade_flow' else 'revaluation' end,
           case when d.prev is not null then coalesce(pr.price_pnl, 0) end,
           case when d.prev is not null then coalesce(tr.trading_pnl, 0) end,
           case when d.prev is not null then coalesce(cp.coupon_pnl, 0) end,
           case when d.prev is not null then coalesce(pr.fx_pnl, 0) end,
           -coalesce(tr.fees, 0),
           case when d.prev is null then coalesce(tr.flow, 0) - coalesce(tr.fees, 0)
                else coalesce(pr.price_pnl, 0) + coalesce(tr.trading_pnl, 0) + coalesce(cp.coupon_pnl, 0)
                     + coalesce(pr.fx_pnl, 0) - coalesce(tr.fees, 0) end
      from d
      left join pr on pr.as_of = d.as_of
      left join tr on tr.as_of = d.as_of
      left join cp on cp.as_of = d.as_of
     order by d.as_of
$$;

-- Закрытые внутри периода позиции (§17, валовой принцип результата с начала года): бумаги со сделками
-- в периоде и нулевым остатком на конец периода; результат = продажи + купоны и погашения − покупки −
-- комиссии, в рублях по курсу ЦБ на дату операции.
create or replace function risk.closed_positions(p_portfolio_id bigint, p_from date, p_to date)
returns table (bond_id bigint, isin char(12), short_name text, currency char(3), bought_rub double precision,
               sold_rub double precision, coupons_rub double precision, fees_rub double precision,
               result_rub double precision, closed_on date)
language sql stable as $$
    with t as (
        select t.*, b.currency, b.secid,
               t.qty * (t.clean_price_pct / 100.0 * ref.face_value_at(t.bond_id, t.trade_date) + t.accrued_interest)
                 * risk.fx_on(b.currency, t.trade_date) as amount_rub
          from ops.trade t join ref.bond b on b.bond_id = t.bond_id
         where t.portfolio_id = p_portfolio_id and t.status <> 'cancelled' and t.trade_date <= p_to),
    closed as (
        select bond_id from t group by bond_id
        having sum(case when side = 'buy' then qty else -qty end) = 0
           and max(trade_date) >= p_from)
    select b.bond_id, b.isin, b.short_name, b.currency,
           sum(t.amount_rub) filter (where t.side = 'buy'),
           coalesce(sum(t.amount_rub) filter (where t.side = 'sell'), 0),
           coalesce((select sum(m.amount * risk.fx_on(a.currency, m.value_date))
                       from ops.cash_account a join ops.cash_movement m on m.cash_account_id = a.cash_account_id
                      where a.portfolio_id = p_portfolio_id and m.kind in ('coupon', 'redemption')
                        and m.note like '% ' || b.secid and m.value_date <= p_to), 0),
           sum(t.fee * risk.fx_on(b.currency, t.trade_date)),
           coalesce(sum(t.amount_rub) filter (where t.side = 'sell'), 0)
             + coalesce((select sum(m.amount * risk.fx_on(a.currency, m.value_date))
                           from ops.cash_account a join ops.cash_movement m on m.cash_account_id = a.cash_account_id
                          where a.portfolio_id = p_portfolio_id and m.kind in ('coupon', 'redemption')
                            and m.note like '% ' || b.secid and m.value_date <= p_to), 0)
             - coalesce(sum(t.amount_rub) filter (where t.side = 'buy'), 0)
             - sum(t.fee * risk.fx_on(b.currency, t.trade_date)),
           max(t.trade_date)
      from closed c join t on t.bond_id = c.bond_id join ref.bond b on b.bond_id = c.bond_id
     group by b.bond_id, b.isin, b.short_name, b.currency
     order by 9 desc
$$;

-- Открытая валютная позиция и переоценка (§18): P_c = Σ MV_лок бумаг в валюте + касса + нетто валютных
-- фьючерсов × лот (срочного рынка в проекте нет — 0); переоценка за день Δ = P_c · (FX(D) − FX(D⁻)), D⁻ —
-- предыдущий рабочий день; нет курса — переоценка не показывается. Рублёвые бумаги и касса — отдельной
-- строкой без переоценки.
create or replace function risk.fx_position(p_portfolio_id bigint, p_as_of date)
returns table (currency char(3), bonds_local double precision, cash_local double precision,
               futures_local double precision, position_local double precision, position_rub double precision,
               fx_today double precision, fx_prev double precision, revaluation_rub double precision,
               share_pct double precision)
language sql stable as $$
    with v as (select currency, sum(mv_local) as bonds from risk.position_valuation(p_portfolio_id, p_as_of) group by currency),
         k as (select currency, amount from risk.cash_by_currency(p_portfolio_id, p_as_of)),
         x as (select coalesce(v.currency, k.currency) as currency, coalesce(v.bonds, 0) as bonds,
                      coalesce(k.amount, 0) as cash
                 from v full join k on k.currency = v.currency),
         nav as (select sum((x.bonds + x.cash) * risk.fx_at(x.currency, p_as_of)) as nav from x)
    select x.currency, x.bonds, x.cash, 0::double precision, x.bonds + x.cash,
           (x.bonds + x.cash) * risk.fx_at(x.currency, p_as_of),
           risk.fx_at(x.currency, p_as_of),
           case when x.currency <> 'RUB' then risk.fx_at(x.currency, ref.add_business_days(p_as_of, -1)) end,
           case when x.currency <> 'RUB' then
                (x.bonds + x.cash) * (risk.fx_at(x.currency, p_as_of) - risk.fx_at(x.currency, ref.add_business_days(p_as_of, -1)))
           end,
           abs((x.bonds + x.cash) * risk.fx_at(x.currency, p_as_of)) / nullif((select nav from nav), 0) * 100
      from x
     order by x.currency = 'RUB', abs((x.bonds + x.cash) * risk.fx_at(x.currency, p_as_of)) desc
$$;

-- Breakeven-курс валютных позиций (§22): FX_be ≈ FX_приобр × P_приобр / P_тек; расстояние до безубыточности
-- (FX_be / FX_тек − 1) × 100 %. FX_приобр и P_приобр — средневзвешенные по количеству покупок.
create or replace function risk.fx_breakeven(p_portfolio_id bigint, p_as_of date)
returns table (bond_id bigint, isin char(12), short_name text, currency char(3), qty bigint,
               price_purchase_pct double precision, price_now_pct double precision,
               fx_purchase double precision, fx_now double precision, fx_breakeven double precision,
               distance_pct double precision)
language sql stable as $$
    with v as (select * from risk.position_valuation(p_portfolio_id, p_as_of) where currency <> 'RUB' and qty > 0),
         buys as (
             select t.bond_id,
                    sum(t.qty * t.clean_price_pct) / sum(t.qty) as px,
                    sum(t.qty * risk.fx_on(b.currency, t.trade_date)) / sum(t.qty) as fx
               from ops.trade t join ref.bond b on b.bond_id = t.bond_id
              where t.portfolio_id = p_portfolio_id and t.side = 'buy' and t.status <> 'cancelled' and t.trade_date <= p_as_of
              group by t.bond_id)
    select v.bond_id, v.isin, v.short_name, v.currency, v.qty, b.px::double precision, v.clean_price_pct,
           b.fx::double precision, v.fx_rate,
           (b.fx * b.px / nullif(v.clean_price_pct, 0))::double precision,
           ((b.fx * b.px / nullif(v.clean_price_pct, 0)) / nullif(v.fx_rate, 0) - 1) * 100
      from v join buys b on b.bond_id = v.bond_id
     order by abs(v.mv_rub) desc
$$;

-- Сценарии рублёвой доходности валютной части (§22): R₽ = (1 + YTM_вал)^T × (1 + ΔFX) − 1 на сетке ΔFX от
-- −10 % до +20 %; безубыточность против рублёвой альтернативы r₽: ΔFX* = ((1 + r₽)/(1 + YTM_вал))^T − 1.
-- r₽ по умолчанию — ставка КБД на срок T. Допущения: удержание до горизонта, реинвестирование по той же
-- ставке, без налогов.
create or replace function risk.fx_return_scenarios(p_portfolio_id bigint, p_as_of date,
                                                    p_horizon_years double precision default 1,
                                                    p_rub_rate_pct double precision default null)
returns table (currency char(3), ytm_pct double precision, rub_rate_pct double precision, horizon_years double precision,
               fx_change_pct double precision, rub_return_pct double precision, breakeven_fx_change_pct double precision)
language sql stable as $$
    with y as (
        select currency, sum(ytm_pct * abs(mv_rub)) / nullif(sum(abs(mv_rub)) filter (where ytm_pct is not null), 0) as ytm
          from risk.position_valuation(p_portfolio_id, p_as_of) where currency <> 'RUB' group by currency),
         r as (select coalesce(p_rub_rate_pct, risk.curve_spot_at(p_as_of, p_horizon_years)) as rub)
    select y.currency, y.ytm, r.rub, p_horizon_years, g.dfx::double precision,
           (power(1 + y.ytm / 100, p_horizon_years) * (1 + g.dfx / 100.0) - 1) * 100,
           (power((1 + r.rub / 100) / (1 + y.ytm / 100), p_horizon_years) - 1) * 100
      from y cross join r cross join generate_series(-10, 20, 5) as g(dfx)
     where y.ytm is not null
     order by y.currency, g.dfx
$$;

-- Carry юаневого репо (§22): доходность юаневых бумаг портфеля минус ставка овернайт-фондирования
-- RUSFAR CNY на дату (последнее значение не позже D).
create or replace function risk.cny_carry(p_portfolio_id bigint, p_as_of date)
returns table (ytm_cny_pct double precision, rusfar_cny_pct double precision, rusfar_date date, carry_pct double precision)
language sql stable as $$
    with y as (select sum(ytm_pct * abs(mv_rub)) / nullif(sum(abs(mv_rub)) filter (where ytm_pct is not null), 0) as ytm
                 from risk.position_valuation(p_portfolio_id, p_as_of) where currency = 'CNY'),
         r as (select value, ts from ts.index_value where index_code = 'RUSFARCNY' and ts <= p_as_of order by ts desc limit 1)
    select y.ytm, r.value, r.ts, y.ytm - r.value from y left join r on true where y.ytm is not null
$$;

-- Стена реинвестирования (§22): доля рыночной стоимости, возвращаемая внутри горизонта, — погашения тела
-- по графику с учётом частичных амортизаций и оферт (те же потоки, что в оценке); доля позиции = погашаемое
-- тело / непогашенный номинал × |MV|.
create or replace function risk.reinvestment_wall(p_portfolio_id bigint, p_as_of date, p_months int default 18)
returns table (flow_date date, bond_id bigint, short_name text, principal_rub double precision, mv_share_rub double precision)
language sql stable as $$
    with v as (select * from risk.position_valuation(p_portfolio_id, p_as_of))
    select f.flow_date, v.bond_id, v.short_name,
           abs(v.qty) * f.amount * v.fx_rate,
           f.amount / nullif(v.face_current, 0) * abs(v.mv_rub)
      from v cross join lateral ref.bond_cash_flows(v.bond_id, p_as_of) f
     where f.kind in ('amortization', 'redemption')
       and f.flow_date <= p_as_of + make_interval(months => p_months)
$$;
