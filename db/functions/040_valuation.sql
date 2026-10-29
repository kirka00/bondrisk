-- =====================================================================
--  Оценка позиций и портфельные агрегаты (методология §1–§3, §7–§15).
--  Позиция на дату D = Σ сделок с trade_date ≤ D (§1): торговая система проекта — собственный журнал
--  сделок, снимок остатков на старте портфеля нулевой; шорты отображаются (режим торговой системы).
--  Необязательная «виртуальная» сделка (p_extra_bond_id, p_extra_qty) даёт точную про-форму what-if (§20).
--  p_holdings_date — ретроспективная оценка: состав берётся на эту дату, цены/кривая/курсы — на D.
-- =====================================================================
drop function if exists risk.stress_pnl(bigint, date, date);
drop function if exists risk.portfolio_metrics(bigint, date, bigint, bigint, double precision, double precision, date);
-- cascade: обёртка ops.v_position_valuation ранних миграций (удалена в 0010) зависит от функции
drop function if exists risk.position_valuation(bigint, date, bigint, bigint, date) cascade;

create or replace function risk.position_valuation(
    p_portfolio_id bigint, p_as_of date,
    p_extra_bond_id bigint default null, p_extra_qty bigint default 0,
    p_holdings_date date default null)
returns table (
    bond_id bigint, isin char(12), short_name text, issuer_id bigint, issuer_name text, sector text,
    currency char(3), coupon_type ref.coupon_type, is_sovereign boolean,
    qty bigint, clean_price_pct double precision, price_date date, accrued_interest double precision,
    face_current double precision, fx_rate double precision,
    mv_local double precision, mv_rub double precision,
    ytm_pct double precision, current_yield_pct double precision,
    duration_mac double precision, duration_mod double precision, convexity double precision,
    dv01_rub double precision, cs01_rub double precision, g_spread_bp double precision,
    rating_grade text, rating_score smallint, rating_source text, adv01_bucket text, adv01_coef numeric,
    weight_pct double precision,
    price_source text, ytm_source text, dm_bp double precision, z_spread_bp double precision,
    dv01_local double precision, avg_cost_pct double precision
)
language sql stable as $$
    with q as (
        select t.bond_id, case when t.side = 'buy' then t.qty else -t.qty end as dq,
               case when t.side = 'buy' then t.qty end as buy_qty,
               case when t.side = 'buy' then t.qty * t.clean_price_pct end as buy_px
          from ops.trade t
         where t.portfolio_id = p_portfolio_id
           and t.trade_date <= coalesce(p_holdings_date, p_as_of)   -- про-форма: состав на фиксированную дату
           and t.status <> 'cancelled'
        union all
        select p_extra_bond_id, p_extra_qty, null, null where p_extra_bond_id is not null
    ),
    -- средняя цена постановки на учёт — средневзвешенная по количеству чистая цена покупок (§3, §17)
    pos as (select bond_id, sum(dq) as qty, (sum(buy_px) / nullif(sum(buy_qty), 0))::double precision as avg_cost_pct
              from q group by bond_id having sum(dq) <> 0),
    v as (
        select pos.bond_id, b.isin, b.short_name, b.issuer_id, i.name as issuer_name, i.sector,
               b.currency, b.coupon_type, i.is_sovereign, pos.qty, pos.avg_cost_pct,
               m.clean_price_pct, m.price_date, m.accrued_interest, m.face_current,
               risk.fx_at(b.currency, p_as_of) as fx_rate,
               pos.qty * m.dirty_price as mv_local,
               m.ytm * 100 as ytm_pct, m.current_yield_pct,
               m.duration_mac, m.duration_mod, m.convexity,
               m.price_source, m.ytm_source, m.dm_bp, m.z_spread_bp, m.cs01_local,
               r.grade as rating_grade, r.score as rating_score, r.source as rating_source,
               sc.adv01_bucket, sc.adv01_coef
          from pos
          join ref.bond b on b.bond_id = pos.bond_id
          join ref.issuer i on i.issuer_id = b.issuer_id
          cross join lateral ref.bond_metrics(pos.bond_id, p_as_of, pos.avg_cost_pct) m
          cross join lateral risk.canonical_rating(pos.bond_id) r
          join ref.rating_scale sc on sc.grade = r.grade
    ),
    v2 as (
        select v.*,
               v.mv_local * v.fx_rate as mv_rub,
               round(abs(v.mv_local * v.fx_rate) * coalesce(v.duration_mod, 0) / 10000.0) as dv01_rub,   -- §7: до рубля
               abs(v.mv_local) * coalesce(v.duration_mod, 0) / 10000.0 as dv01_local
          from v
    )
    select v2.bond_id, v2.isin, v2.short_name, v2.issuer_id, v2.issuer_name, v2.sector,
           v2.currency, v2.coupon_type, v2.is_sovereign,
           v2.qty, v2.clean_price_pct, v2.price_date, v2.accrued_interest, v2.face_current, v2.fx_rate,
           v2.mv_local, v2.mv_rub, v2.ytm_pct, v2.current_yield_pct,
           v2.duration_mac, v2.duration_mod, v2.convexity,
           v2.dv01_rub,
           -- §10: CS01 = |Q| · (P(z) − P(z + 1 б.п.)) · FX, где Z-спред определён; иначе ≈ DV01; суверенные — 0
           case when v2.is_sovereign then 0
                when v2.cs01_local is not null then round(abs(v2.qty) * v2.cs01_local * v2.fx_rate)
                else v2.dv01_rub end as cs01_rub,
           case when v2.currency = 'RUB' and v2.coupon_type <> 'floating' and v2.ytm_pct is not null
                then round(((v2.ytm_pct - risk.curve_rate_at(p_as_of, v2.duration_mod)) * 100)::numeric)::double precision
           end as g_spread_bp,                                                       -- §9
           v2.rating_grade, v2.rating_score, v2.rating_source, v2.adv01_bucket, v2.adv01_coef,
           abs(v2.mv_rub) / nullif(sum(abs(v2.mv_rub)) over (), 0) * 100 as weight_pct,
           v2.price_source, v2.ytm_source, v2.dm_bp, v2.z_spread_bp, v2.dv01_local, v2.avg_cost_pct
      from v2
$$;

-- Касса по валютам на дату (§2): K(D) = учётный остаток + денежные ноги сделок, заключённых не позже D,
-- расчёты по которым ещё не наступили, — то есть движения сделок считаются по дате сделки, прочие — по
-- дате валютирования. В кассу входят только рубль, доллар, евро, юань и фунт. Ручная корректировка
-- риск-менеджмента: целевой остаток на дату заменяет расчётный, единый сдвиг по валюте применяется ко всем
-- историческим срезам без точечной корректировки. Вариационной маржи нет — срочного рынка в проекте нет.
create or replace function risk.cash_by_currency(p_portfolio_id bigint, p_as_of date)
returns table (currency char(3), amount double precision)
language sql stable as $$
    with mv as (
        select a.currency, sum(m.amount)::double precision as amount
          from ops.cash_account a
          join ops.cash_movement m on m.cash_account_id = a.cash_account_id
          left join ops.trade t on t.trade_id = m.trade_id
         where a.portfolio_id = p_portfolio_id
           and a.currency in ('RUB', 'USD', 'EUR', 'CNY', 'GBP')
           and coalesce(t.trade_date, m.value_date) <= p_as_of
         group by a.currency),
    adj as (
        select c.currency,
               max(c.target_balance) filter (where c.as_of = p_as_of)::double precision as target,
               max(c.shift) filter (where c.as_of is null)::double precision as shift
          from risk.cash_adjustment c
         where c.portfolio_id = p_portfolio_id and (c.as_of = p_as_of or c.as_of is null)
         group by c.currency)
    select coalesce(mv.currency, adj.currency),
           coalesce(adj.target,
                    coalesce(mv.amount, 0) + case when p_as_of < current_date then coalesce(adj.shift, 0) else 0 end)
      from mv full join adj on adj.currency = mv.currency
$$;

-- Остаток кассы в рублях по курсу оценки (§2, §3); валюта без курса не учитывается.
create or replace function risk.cash_total_rub(p_portfolio_id bigint, p_as_of date)
returns double precision
language sql stable as $$
    select coalesce(sum(c.amount * risk.fx_at(c.currency, p_as_of)), 0)
      from risk.cash_by_currency(p_portfolio_id, p_as_of) c
$$;

-- Портфельные агрегаты (§11–§12, §14–§15). Средние взвешены по |MV| только бумаг с определённой метрикой,
-- аддитивные чувствительности — с учётом знака.
create or replace function risk.portfolio_metrics(
    p_portfolio_id bigint, p_as_of date,
    p_extra_bond_id bigint default null, p_extra_qty bigint default 0,
    p_sigma_bp double precision default 32, p_z double precision default 2.326,
    p_holdings_date date default null)
returns table (
    mv_net double precision, mv_gross double precision, cash_total_rub double precision,
    dv01 double precision, cs01 double precision, adv01 double precision,
    duration_mac double precision, duration_mod double precision, convexity double precision,
    ytm_avg double precision, current_yield_avg double precision, g_spread_avg_bp double precision,
    var_99_1d double precision, rating_score double precision, rating_grade text,
    positions_count integer, dv01_short_bucket double precision, dv01_long_bucket double precision,
    dm_avg_bp double precision, floater_share_pct double precision
)
language sql stable as $$
    with v as (select * from risk.position_valuation(p_portfolio_id, p_as_of, p_extra_bond_id, p_extra_qty, p_holdings_date)),
    buckets as (
        select adv01_bucket, adv01_coef,
               sum(case when qty > 0 then dv01_rub else 0 end) - sum(case when qty < 0 then dv01_rub else 0 end) as net_dv01
          from v group by adv01_bucket, adv01_coef),
    agg as (
        select sum(mv_rub) as mv_net,
               sum(abs(mv_rub)) as mv_gross,
               sum(sign(qty) * dv01_rub) as dv01,
               sum(sign(qty) * cs01_rub) as cs01,
               sum(duration_mac * abs(mv_rub)) / nullif(sum(abs(mv_rub)) filter (where duration_mac is not null), 0) as duration_mac,
               sum(duration_mod * abs(mv_rub)) / nullif(sum(abs(mv_rub)) filter (where duration_mod is not null), 0) as duration_mod,
               sum(convexity * abs(mv_rub)) / nullif(sum(abs(mv_rub)) filter (where convexity is not null), 0) as convexity,
               sum(ytm_pct * abs(mv_rub)) / nullif(sum(abs(mv_rub)) filter (where ytm_pct is not null), 0) as ytm_avg,
               sum(current_yield_pct * abs(mv_rub)) / nullif(sum(abs(mv_rub)) filter (where current_yield_pct is not null), 0) as cy_avg,
               -- средний кредитный спред (§9.1): рублёвые фиксированные, не суверенные, не дефолт, коридор [−200; 3000]
               sum(g_spread_bp * abs(mv_rub)) filter (where g_spread_bp between -200 and 3000 and not is_sovereign and rating_grade not in ('D', 'SD'))
                 / nullif(sum(abs(mv_rub)) filter (where g_spread_bp between -200 and 3000 and not is_sovereign and rating_grade not in ('D', 'SD')), 0) as g_spread_avg,
               -- §15: бумаги без рейтинга и с нулевой экспозицией исключены из числителя и знаменателя
               sum(rating_score * abs(mv_rub)) filter (where rating_grade <> 'NR' and mv_rub <> 0)
                 / nullif(sum(abs(mv_rub)) filter (where rating_grade <> 'NR' and mv_rub <> 0), 0) as rating_score,
               count(*)::int as positions_count,
               sum(sign(qty) * dv01_rub) filter (where duration_mac < 5) as dv01_short,
               sum(sign(qty) * dv01_rub) filter (where duration_mac >= 5 and duration_mac < 20) as dv01_long,
               -- §8, §11: средняя DM по флоутерам с определённой маржой; доля флоутеров от брутто
               sum(dm_bp * abs(mv_rub)) filter (where coupon_type = 'floating' and dm_bp is not null)
                 / nullif(sum(abs(mv_rub)) filter (where coupon_type = 'floating' and dm_bp is not null), 0) as dm_avg,
               sum(abs(mv_rub)) filter (where coupon_type = 'floating') / nullif(sum(abs(mv_rub)), 0) * 100 as floater_share
          from v)
    select coalesce(a.mv_net, 0), coalesce(a.mv_gross, 0),
           risk.cash_total_rub(p_portfolio_id, coalesce(p_holdings_date, p_as_of)),   -- про-форма: касса на дату состава
           coalesce(a.dv01, 0), coalesce(a.cs01, 0),
           coalesce((select sum(net_dv01 * adv01_coef) from buckets), 0),
           a.duration_mac, a.duration_mod, a.convexity, a.ytm_avg, a.cy_avg, a.g_spread_avg,
           abs(coalesce(a.dv01, 0)) * p_z * p_sigma_bp as var_99_1d,
           a.rating_score,
           -- ближайшая ступень шкалы (NR — не ступень), при равном расстоянии — лучшая
           (select s.grade from ref.rating_scale s where a.rating_score is not null and s.grade <> 'NR'
             order by abs(s.score - a.rating_score), s.score limit 1),
           a.positions_count, coalesce(a.dv01_short, 0), coalesce(a.dv01_long, 0),
           a.dm_avg, coalesce(a.floater_share, 0)
      from agg a
$$;

-- Стресс-сценарии (§13): P&L по каждому сценарию; p_holdings_date — про-форма состава.
--  * параллельный сдвиг: −DV01_нетто · Δy + ½ · MV_брутто · C̄ · (Δy/10⁴)²;
--  * твист: бакеты по дюрации Маколея < 5 и 5–20 лет, ≥ 20 исключены;
--  * валютный (гипотетический и исторический): ΔFX% · E, E = Σ |MV₽| позиций в валюте + K_валюта · FX;
--  * исторический по индексу гособлигаций: Δ% · брутто-стоимость рублёвых позиций;
--  * исторический по индексу акций: Δ% · β · брутто-стоимость несуверенных облигаций.
-- Убыток свыше 5 % стоимости портфеля — критичный, свыше 2 % — предупреждение.
create or replace function risk.stress_pnl(p_portfolio_id bigint, p_as_of date, p_holdings_date date default null)
returns table (code text, name text, kind risk.scenario_kind, pnl_rub double precision, pnl_pct_of_mv double precision,
               episode text, horizon_days smallint, date_from date, date_to date, change_pct double precision,
               severity text)
language sql stable as $$
    with m as (select * from risk.portfolio_metrics(p_portfolio_id, p_as_of, null, 0, 32, 2.326, p_holdings_date)),
    v as (select * from risk.position_valuation(p_portfolio_id, p_as_of, null, 0, p_holdings_date)),
    cash as (select * from risk.cash_by_currency(p_portfolio_id, coalesce(p_holdings_date, p_as_of))),
    fx_exp as (
        select cur as currency, sum(e) as exposure from (
            select currency as cur, abs(mv_rub) as e from v where currency <> 'RUB'
            union all
            select currency, amount * risk.fx_at(currency, p_as_of) from cash where currency <> 'RUB') x
         group by cur),
    expo as (select sum(abs(mv_rub)) filter (where currency = 'RUB') as rub_gross,
                    sum(abs(mv_rub)) filter (where not is_sovereign) as nonsov_gross from v),
    p as (
        select s.*,
               case s.kind
                   when 'parallel' then -m.dv01 * s.shift_bp + 0.5 * m.mv_gross * coalesce(m.convexity, 0) * power(s.shift_bp / 10000.0, 2)
                   when 'twist'    then  s.amplitude_bp * m.dv01_short_bucket - s.amplitude_bp * m.dv01_long_bucket
                   when 'fx'       then  s.fx_change_pct / 100.0 * coalesce((select exposure from fx_exp where currency = s.fx_currency), 0)
                   when 'fx_hist'  then  s.change_pct / 100.0 * coalesce((select exposure from fx_exp where currency = s.fx_currency), 0)
                   when 'ofz_index' then s.change_pct / 100.0 * coalesce((select rub_gross from expo), 0)
                   when 'equity_index' then s.change_pct / 100.0 * s.beta * coalesce((select nonsov_gross from expo), 0)
               end::double precision as pnl
          from risk.stress_scenario s cross join m)
    select p.code, p.name, p.kind, p.pnl, p.pnl / nullif(m.mv_gross, 0) * 100,
           p.episode, p.horizon_days, p.date_from, p.date_to, p.change_pct::double precision,
           case when -p.pnl > 0.05 * m.mv_gross then 'critical'
                when -p.pnl > 0.02 * m.mv_gross then 'warning' else 'ok' end
      from p cross join m
     order by p.scenario_id
$$;
