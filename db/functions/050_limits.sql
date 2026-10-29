-- =====================================================================
--  Лимиты (методология §16): факт против лимита, утилизация, статус; what-if (§20).
-- =====================================================================
drop function if exists risk.what_if_trade(bigint, bigint, ops.trade_side, bigint, date);
drop function if exists risk.limit_facts(bigint, date, bigint, bigint, date);

-- Нормализация названия эмитента или отрасли для книги лимитов (§16.2): без регистра, кавычек,
-- организационно-правовой формы и лишних пробелов; ё → е.
create or replace function ref.norm_name(p_name text)
returns text
language sql immutable as $$
    select nullif(trim(regexp_replace(regexp_replace(
               lower(translate(coalesce(p_name, ''), 'ёЁ«»"“”„''', 'ее')),
               '(^|[^[:alnum:]])(публичное акционерное общество|непубличное акционерное общество|акционерное общество'
               '|общество с ограниченной ответственностью|мкпао|пао|оао|зао|нао|ао|ооо|ппк|гк|ао)(?=[^[:alnum:]]|$)',
               ' ', 'g'), '[^[:alnum:]]+', ' ', 'g')), '')
$$;

-- Ключ сопоставления с учётом синонимов книги.
create or replace function ref.canonical_name(p_kind text, p_name text)
returns text
language sql stable as $$
    select coalesce((select s.canonical from ref.name_synonym s
                      where s.kind = p_kind and s.alias = ref.norm_name(p_name)), ref.norm_name(p_name))
$$;

-- p_holdings_date — про-форма: состав на эту дату, рынок и действующие лимиты — на p_as_of.
-- Лимиты концентрации (§16.2): позиция против лимита — по базе оценки лимита: цена покупки (вложенные
-- деньги, по умолчанию), рынок или большая из двух; рыночная величина возвращается рядом (fact_market).
-- Утилизация — наибольшая из утилизаций по рублёвому, процентному лимиту и доле в объёме эмиссии.
create or replace function risk.limit_facts(
    p_portfolio_id bigint, p_as_of date,
    p_extra_bond_id bigint default null, p_extra_qty bigint default 0,
    p_holdings_date date default null)
returns table (
    limit_id bigint, metric risk.limit_metric, scope text, side risk.limit_side, is_hard boolean,
    fact_value double precision, limit_value double precision, utilization_pct double precision,
    warning_pct numeric, status text,
    fact_market double precision, basis text, share_fact_pct double precision, share_limit_pct double precision,
    committee text
)
language sql stable as $$
    with v0 as (select * from risk.position_valuation(p_portfolio_id, p_as_of, p_extra_bond_id, p_extra_qty, p_holdings_date)),
         m as (select * from risk.portfolio_metrics(p_portfolio_id, p_as_of, p_extra_bond_id, p_extra_qty, 32, 2.326, p_holdings_date)),
         -- вложенные деньги на одну бумагу: средняя сумма сделок (чистая цена × номинал + НКД) × курс на дату
         -- сделки; виртуальная сделка what-if — по рынку на D
         legs as (
             select t.bond_id, t.side, t.qty::double precision as qty,
                    t.qty * (t.clean_price_pct / 100.0 * ref.face_value_at(t.bond_id, t.trade_date) + t.accrued_interest)
                      * risk.fx_on(b.currency, t.trade_date) as amount
               from ops.trade t join ref.bond b on b.bond_id = t.bond_id
              where t.portfolio_id = p_portfolio_id and t.status <> 'cancelled'
                and t.trade_date <= coalesce(p_holdings_date, p_as_of)
             union all
             select x.bond_id, case when p_extra_qty > 0 then 'buy' else 'sell' end::ops.trade_side,
                    abs(p_extra_qty), abs(p_extra_qty) * x.mv_local / nullif(x.qty, 0) * x.fx_rate
               from v0 x where x.bond_id = p_extra_bond_id and p_extra_qty <> 0),
         unit as (
             select bond_id,
                    sum(amount) filter (where side = 'buy')  / nullif(sum(qty) filter (where side = 'buy'), 0)  as unit_buy,
                    sum(amount) filter (where side = 'sell') / nullif(sum(qty) filter (where side = 'sell'), 0) as unit_sell
               from legs group by bond_id),
         v as (
             select v0.*, abs(v0.mv_rub) as mkt_rub,
                    coalesce(abs(v0.qty) * case when v0.qty > 0 then u.unit_buy else u.unit_sell end, abs(v0.mv_rub)) as cost_rub,
                    ref.canonical_name('issuer', v0.issuer_name) as issuer_key,
                    ref.canonical_name('sector', v0.sector) as sector_key,
                    b.issue_size
               from v0 join ref.bond b on b.bond_id = v0.bond_id
               left join unit u on u.bond_id = v0.bond_id),
         l as (select * from risk.risk_limit rl
                where rl.portfolio_id = p_portfolio_id and rl.valid_from <= p_as_of
                  and (rl.valid_to is null or rl.valid_to >= p_as_of)),
         -- позиции, попадающие под лимит концентрации (объект и сторона)
         hit as (
             select l.limit_id, v.*
               from l join v on (
                    (l.metric = 'conc_issuer' and (v.issuer_id = l.scope_issuer_id
                                                   or (l.scope_name is not null and v.issuer_key = ref.canonical_name('issuer', l.scope_name))))
                 or (l.metric = 'conc_issue'  and v.bond_id = l.scope_bond_id)
                 or (l.metric = 'conc_sector' and v.sector_key = ref.canonical_name('sector', l.scope_sector))
                 or  l.metric = 'conc_portfolio')
              where l.side = 'both' or (l.side = 'long' and v.qty > 0) or (l.side = 'short' and v.qty < 0)),
         conc as (
             select h.limit_id,
                    sum(h.cost_rub) as cost_rub, sum(h.mkt_rub) as mkt_rub,
                    sum(abs(h.qty)) / nullif(max(h.issue_size), 0) * 100 as share_pct
               from hit h group by h.limit_id),
         -- правило «новые эмитенты не ниже рейтинга» (§16.2) — для покупки бумаги эмитента, которого нет в портфеле
         newcomer as (
             select x.rating_score::double precision as score
               from v0 x
              where x.bond_id = p_extra_bond_id and p_extra_qty > 0
                and not exists (select 1 from risk.position_valuation(p_portfolio_id, p_as_of, null, 0, p_holdings_date) y
                                 where y.issuer_id = x.issuer_id)),
         facts as (
             select l.limit_id, l.metric, l.side, l.is_hard, l.warning_pct, l.basis, l.committee,
                    l.emission_share_pct::double precision as share_limit_pct,
                    coalesce(i.short_name, i.name, l.scope_name, b.short_name, l.scope_sector) as scope,
                    case l.metric
                        when 'dv01'          then abs(m.dv01)
                        when 'duration'      then coalesce(m.duration_mac, 0)
                        when 'var_99'        then m.var_99_1d
                        when 'mv_gross'      then m.mv_gross
                        when 'credit_spread' then m.g_spread_avg_bp
                        when 'short_mv'      then coalesce((select sum(abs(mv_rub)) from v where qty < 0), 0)
                        -- ниже AAA: с рейтингом хуже AAA, без суверенных; бумаги без рейтинга рейтинга не имеют
                        when 'below_aaa_mv'  then coalesce((select sum(abs(mv_rub)) from v
                                                             where rating_grade not in ('AAA', 'NR') and not is_sovereign), 0)
                        when 'fx_mv'         then coalesce((select sum(abs(mv_rub)) from v where currency <> 'RUB'), 0)
                        when 'new_issuer_rating' then (select score from newcomer)
                        else coalesce(case l.basis when 'cost' then c.cost_rub when 'market' then c.mkt_rub
                                                   else greatest(c.cost_rub, c.mkt_rub) end, 0)
                    end as fact_value,
                    case when l.metric in ('conc_issuer', 'conc_issue', 'conc_sector', 'conc_portfolio')
                         then coalesce(c.mkt_rub, 0) end as fact_market,
                    case when l.metric = 'conc_issue' then coalesce(c.share_pct, 0) end as share_fact_pct,
                    case when l.metric = 'new_issuer_rating'
                         then (select s.score from ref.rating_scale s where s.grade = l.min_grade)::double precision
                         -- рублёвый и/или процентный лимит (от брутто-стоимости или общего лимита на портфель): строже
                         else nullif(least(coalesce(l.threshold_abs::double precision, 'infinity'),
                                           coalesce(l.threshold_pct::double precision / 100.0
                                                      * case l.pct_base when 'gross' then m.mv_gross
                                                             else (select min(t.threshold_abs) from l t
                                                                    where t.metric = 'conc_portfolio' and t.threshold_abs is not null
                                                                      and (t.side = l.side or t.side = 'both')) end,
                                                    'infinity')), 'infinity') end as limit_value,
                    -- короткая позиция по любой бумаге, кроме ОФЗ, — нарушение независимо от размера лимита
                    l.metric = 'short_mv' and exists (select 1 from v where qty < 0 and not is_sovereign) as short_rule
               from l cross join m
               left join conc c on c.limit_id = l.limit_id
               left join ref.issuer i on i.issuer_id = l.scope_issuer_id
               left join ref.bond   b on b.bond_id   = l.scope_bond_id),
         u as (
             select f.*,
                    case when f.metric = 'new_issuer_rating' then null
                         else nullif(greatest(coalesce(f.fact_value / nullif(f.limit_value, 0), 0),
                                              coalesce(f.share_fact_pct / nullif(f.share_limit_pct, 0), 0))
                                     * 100, 0) end as util,
                    f.limit_value is null and f.share_limit_pct is null as no_limit
               from facts f)
    select u.limit_id, u.metric, u.scope, u.side, u.is_hard, u.fact_value, u.limit_value,
           case when u.no_limit then null else coalesce(u.util, 0) end as utilization_pct,
           u.warning_pct,
           case when u.metric = 'new_issuer_rating'
                     then case when u.fact_value is null then 'ok' when u.fact_value > u.limit_value then 'breach' else 'ok' end
                when u.short_rule then 'breach'
                when u.no_limit then 'n/a'
                when coalesce(u.util, 0) > 100 then 'breach'
                when coalesce(u.util, 0) > u.warning_pct then 'warning'
                else 'ok' end as status,
           u.fact_market, u.basis, u.share_fact_pct, u.share_limit_pct, u.committee
      from u
     order by u.limit_id
$$;

-- Дата расчётов (§20.1): T + n рабочих дней от даты сделки либо ручная дата — выходной переносится на
-- ближайший понедельник, перенос возвращается явно.
create or replace function ref.resolve_settlement(p_trade_date date, p_days int default 1, p_manual date default null)
returns table (settlement_date date, shifted_from date)
language sql immutable as $$
    select case when p_manual is null then ref.add_business_days(p_trade_date, p_days)
                when extract(isodow from p_manual) = 6 then p_manual + 2
                when extract(isodow from p_manual) = 7 then p_manual + 1
                else p_manual end,
           case when p_manual is not null and extract(isodow from p_manual) >= 6 then p_manual end
$$;

-- Предварительная оценка сделки (§20): точная про-форма — метрики и лимиты «до / после» по полному набору
-- формул разделов 3–13. Сумма сделки и поток по кассе — по цене сделки (по умолчанию — рыночная) с НКД
-- на дату расчётов AI(S) = AI(D) + c·N·(S − D)/365; переоценка и показатели «станет» — по рынку на D.
create or replace function risk.what_if_trade(
    p_portfolio_id bigint, p_bond_id bigint, p_side ops.trade_side, p_qty bigint, p_as_of date default current_date,
    p_price_pct double precision default null, p_settlement_date date default null)
returns table (
    kind text, metric text, scope text, before_value double precision, after_value double precision,
    limit_value double precision, utilization_before double precision, utilization_after double precision,
    status_after text, is_hard boolean
)
language sql stable as $$
    with d as (select case when p_side = 'buy' then p_qty else -p_qty end as dq,
                      coalesce(p_settlement_date, ref.add_business_days(p_as_of, 1)) as s),
    leg as (select coalesce(p_price_pct, m.clean_price_pct) as price_pct,
                   ref.accrued_at_settlement(b.bond_id, p_as_of, (select s from d)) as ai_s,
                   m.face_current, risk.fx_at(b.currency, p_as_of) as fx
              from ref.bond b cross join lateral ref.bond_metrics(b.bond_id, p_as_of) m
             where b.bond_id = p_bond_id),
    px as (select (price_pct / 100.0 * face_current + ai_s) * fx as unit_rub, ai_s, price_pct from leg),
    mb as (select * from risk.portfolio_metrics(p_portfolio_id, p_as_of)),
    ma as (select * from risk.portfolio_metrics(p_portfolio_id, p_as_of, p_bond_id, (select dq from d))),
    metrics as (
        select 'metric' as kind, x.metric, null::text as scope, x.before_value, x.after_value,
               null::double precision as limit_value, null::double precision as ub, null::double precision as ua,
               null::text as status_after, null::boolean as is_hard
          from mb, ma,
          lateral (values ('mv_net', mb.mv_net, ma.mv_net), ('mv_gross', mb.mv_gross, ma.mv_gross),
                          ('dv01', mb.dv01, ma.dv01), ('cs01', mb.cs01, ma.cs01), ('adv01', mb.adv01, ma.adv01),
                          ('duration_mac', mb.duration_mac, ma.duration_mac), ('ytm_avg', mb.ytm_avg, ma.ytm_avg),
                          ('var_99_1d', mb.var_99_1d, ma.var_99_1d), ('rating_score', mb.rating_score, ma.rating_score),
                          ('dm_avg_bp', mb.dm_avg_bp, ma.dm_avg_bp), ('floater_share_pct', mb.floater_share_pct, ma.floater_share_pct),
                          ('cash_total_rub', mb.cash_total_rub,
                           ma.cash_total_rub - (select dq from d) * coalesce((select unit_rub from px), 0))) as x(metric, before_value, after_value)
    ),
    trade as (
        select 'trade', x.metric, null::text, null::double precision, x.v,
               null::double precision, null::double precision, null::double precision, null::text, null::boolean
          from px, lateral (values ('price_pct', px.price_pct), ('accrued_at_settlement', px.ai_s),
                                   ('amount_rub', abs((select dq from d)) * px.unit_rub)) as x(metric, v)
    ),
    lb as (select * from risk.limit_facts(p_portfolio_id, p_as_of)),
    la as (select * from risk.limit_facts(p_portfolio_id, p_as_of, p_bond_id, (select dq from d))),
    limits as (
        select 'limit', la.metric::text || ' #' || la.limit_id, la.scope, lb.fact_value, la.fact_value,
               la.limit_value, lb.utilization_pct, la.utilization_pct, la.status, la.is_hard
          from la join lb on lb.limit_id = la.limit_id
    )
    select * from metrics union all select * from trade union all select * from limits
$$;
