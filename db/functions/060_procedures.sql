-- =====================================================================
--  Составные бизнес-операции (ТЗ §4–§5): пополнение кассы, сделка, EOD, снятие нарушения.
--  Коды ошибок: BR001 недостаточно бумаг, BR002 недостаточно денег, BR003 нарушение лимита,
--  BR004 бумага не торгуется, BR005 нет прав, BR404 объект не найден.
-- =====================================================================

create or replace procedure ops.deposit_cash(
    p_portfolio_id bigint, p_currency char(3), p_amount numeric, p_user_id bigint default null,
    p_note text default 'пополнение', p_value_date date default current_date)
language plpgsql as $$
declare v_acc bigint;
begin
    insert into ops.cash_account (portfolio_id, currency) values (p_portfolio_id, p_currency)
        on conflict (portfolio_id, currency) do nothing;
    select cash_account_id into v_acc from ops.cash_account
     where portfolio_id = p_portfolio_id and currency = p_currency for update;
    insert into ops.cash_movement (cash_account_id, kind, amount, note, value_date)
        values (v_acc, (case when p_amount >= 0 then 'deposit' else 'withdrawal' end)::ops.movement_kind,
                p_amount, p_note, p_value_date);
    update ops.cash_account set balance = balance + p_amount where cash_account_id = v_acc;
end $$;

-- Выплаты по бумагам портфеля (купоны, амортизация, погашение) из графика MOEX с датой выплаты в
-- (p_from, p_to]: держатель — по сделкам с датой раньше даты выплаты (дата фиксации реестра — рабочий день
-- до выплаты). Повторный вызов за тот же интервал ничего не задваивает: движение ищется по счёту, дате,
-- виду и примечанию с кодом бумаги. Погашенная бумага выпадает из оценки сама (номинал после погашения 0),
-- поэтому деньги от погашения — единственная проводка.
create or replace procedure ops.book_bond_flows(p_portfolio_id bigint, p_from date, p_to date)
language plpgsql as $$
declare
    f record; v_acc bigint; v_note text; v_amount numeric;
begin
    for f in
        select s.bond_id, b.secid, b.currency, s.flow_type, s.pay_date,
               coalesce(s.amount::double precision,
                        coalesce(s.rate_pct::double precision, ref.coupon_rate_at(s.bond_id, s.pay_date)) / 100.0
                          * ref.face_value_at(s.bond_id, lower(s.period))
                          * (upper(s.period) - lower(s.period)) / 365.0) as per_bond,
               q.qty
          from ref.cash_flow_schedule s
          join ref.bond b on b.bond_id = s.bond_id
          join lateral (select sum(case when t.side = 'buy' then t.qty else -t.qty end) as qty
                          from ops.trade t
                         where t.portfolio_id = p_portfolio_id and t.bond_id = s.bond_id
                           and t.trade_date < s.pay_date and t.status <> 'cancelled') q on q.qty <> 0
         where s.flow_type in ('coupon', 'amortization', 'redemption')
           and s.pay_date > p_from and s.pay_date <= p_to
         order by s.pay_date, s.bond_id
    loop
        v_amount := round((f.qty * f.per_bond)::numeric, 2);
        continue when v_amount is null or v_amount = 0;
        v_note := format('%s %s', case f.flow_type when 'coupon' then 'купон' when 'amortization' then 'амортизация'
                                                   else 'погашение' end, f.secid);
        insert into ops.cash_account (portfolio_id, currency) values (p_portfolio_id, f.currency)
            on conflict (portfolio_id, currency) do nothing;
        select cash_account_id into v_acc from ops.cash_account
         where portfolio_id = p_portfolio_id and currency = f.currency for update;
        continue when exists (select 1 from ops.cash_movement
                               where cash_account_id = v_acc and value_date = f.pay_date and note = v_note);
        insert into ops.cash_movement (cash_account_id, kind, amount, value_date, note)
        values (v_acc, (case when f.flow_type = 'coupon' then 'coupon' else 'redemption' end)::ops.movement_kind,
                v_amount, f.pay_date, v_note);
        update ops.cash_account set balance = balance + v_amount where cash_account_id = v_acc;
    end loop;
end $$;

-- Сделка: блокировки → проверки (шорт, касса, лимиты до сделки) → INSERT (бухгалтерию делает триггер).
create or replace procedure ops.execute_trade(
    p_portfolio_id bigint, p_bond_id bigint, p_side ops.trade_side, p_qty bigint,
    p_clean_price_pct numeric, p_user_id bigint,
    p_trade_date date default current_date, p_settlement_days int default 1,
    p_fee numeric default 0, p_counterparty text default null,
    p_check_limits boolean default true,
    inout p_trade_id bigint default null)
language plpgsql as $$
declare
    pf   ops.portfolio%rowtype;
    b    ref.bond%rowtype;
    pos  ops.position%rowtype;
    acc  ops.cash_account%rowtype;
    v_settle date;
    v_ai   double precision;
    v_leg  numeric;
    v_lim  record;
begin
    -- права проверяются и в СУБД, а не только в API: сделку проводит трейдер или администратор
    if not exists (select 1 from ops.app_user where user_id = p_user_id and is_active and role in ('trader', 'admin')) then
        raise exception 'user % may not trade', p_user_id using errcode = 'BR005';
    end if;
    select * into pf from ops.portfolio where portfolio_id = p_portfolio_id;
    if not found then raise exception 'portfolio % not found', p_portfolio_id using errcode = 'BR404'; end if;
    if pf.status <> 'active' then raise exception 'portfolio % is closed', pf.code using errcode = 'BR004'; end if;
    select * into b from ref.bond where bond_id = p_bond_id;
    if not found then raise exception 'bond % not found', p_bond_id using errcode = 'BR404'; end if;

    -- один портфель — одна очередь сделок: сериализует проверки лимитов между разными бумагами
    perform pg_advisory_xact_lock(hashtext('portfolio'), p_portfolio_id::int);

    insert into ops.position (portfolio_id, bond_id) values (p_portfolio_id, p_bond_id)
        on conflict do nothing;
    select * into pos from ops.position
     where portfolio_id = p_portfolio_id and bond_id = p_bond_id for update;

    if p_side = 'sell' and not pf.allow_short and pos.qty < p_qty then
        raise exception 'insufficient position: have %, sell %', pos.qty, p_qty using errcode = 'BR001';
    end if;

    v_settle := ref.add_business_days(p_trade_date, p_settlement_days);   -- рабочие дни (§20.1)

    v_ai  := ref.accrued_at_settlement(p_bond_id, p_trade_date, v_settle);   -- §20.1: AI(D) + c·N·(S − D)/365
    v_leg := p_qty * (p_clean_price_pct / 100.0 * ref.face_value_at(p_bond_id, p_trade_date) + v_ai);

    insert into ops.cash_account (portfolio_id, currency) values (p_portfolio_id, b.currency)
        on conflict (portfolio_id, currency) do nothing;
    select * into acc from ops.cash_account
     where portfolio_id = p_portfolio_id and currency = b.currency for update;
    if p_side = 'buy' and not acc.allow_overdraft and acc.balance - v_leg - p_fee < 0 then
        raise exception 'insufficient cash: balance % %, need %', acc.balance, b.currency, round(v_leg + p_fee, 2)
            using errcode = 'BR002';
    end if;

    if p_check_limits then
        -- без котировки за 90 дней позиция выпадает из оценки, и лимиты её «не видят»
        if not exists (select 1 from risk.price_at(p_bond_id, p_trade_date)) then
            raise exception 'no market price for bond % within 90 days: limits cannot be checked', b.secid
                using errcode = 'BR004';
        end if;
        -- блокирует только сделка, которая доводит жёсткий лимит до нарушения или увеличивает факт по
        -- уже нарушенному: сокращение позиции проходит. Сравнивается факт, а не загрузка — у порога в %
        -- от брутто продажа любой бумаги уменьшает знаменатель и формально «углубляет» чужие нарушения
        select a.* into v_lim
          from risk.limit_facts(p_portfolio_id, p_trade_date, p_bond_id,
                                case when p_side = 'buy' then p_qty else -p_qty end) a
          left join risk.limit_facts(p_portfolio_id, p_trade_date) bf on bf.limit_id = a.limit_id
         where a.is_hard and a.status = 'breach'
           and (bf.limit_id is null or bf.status <> 'breach' or a.fact_value > bf.fact_value + 1e-6)
         order by a.utilization_pct desc limit 1;
        if found then
            raise exception 'hard limit % (%) breached: fact % > limit %',
                  v_lim.metric, coalesce(v_lim.scope, 'portfolio'),
                  round(v_lim.fact_value::numeric, 2), round(v_lim.limit_value::numeric, 2)
                using errcode = 'BR003';
        end if;
    end if;

    insert into ops.trade (portfolio_id, bond_id, trade_date, settlement_date, side, qty,
                           clean_price_pct, accrued_interest, fee, counterparty, created_by)
    values (p_portfolio_id, p_bond_id, p_trade_date, v_settle, p_side, p_qty,
            p_clean_price_pct, v_ai, p_fee, p_counterparty, p_user_id)
    returning trade_id into p_trade_id;
end $$;

-- EOD: снапшоты позиций и портфеля, контроль лимитов с сохранением снятых нарушений.
-- EOD. p_holdings_date — ретроспективная оценка (про-форма): состав на эту дату, рынок на p_as_of;
-- такие снапшоты помечаются is_proforma и не порождают нарушений лимитов.
create or replace procedure risk.run_eod(p_portfolio_id bigint, p_as_of date default current_date,
                                         p_holdings_date date default null)
language plpgsql as $$
declare
    r record; m record; v_old risk.limit_breach%rowtype; v_prev risk.limit_breach%rowtype;
    v_prev_eod date; v_keep boolean; v_flows_from date;
    v_pf boolean := p_holdings_date is not null;
begin
    -- та же очередь, что у сделок и снятия нарушений портфеля: EOD не читает «полусделку»
    -- и не затирает снятие, сделанное параллельно; два EOD за одну дату не падают на ключе
    perform pg_advisory_xact_lock(hashtext('portfolio'), p_portfolio_id::int);

    -- про-форма не заменяет фактический расчёт: ключ снапшота — (портфель, дата) без признака про-формы
    if v_pf and exists (select 1 from risk.risk_snapshot
                         where portfolio_id = p_portfolio_id and as_of = p_as_of and not is_proforma) then
        raise exception 'actual EOD for % already exists; pro-forma would overwrite it', p_as_of
            using errcode = 'BR006';
    end if;

    -- фактический расчёт сначала проводит выплаты по бумагам с прошлого фактического EOD (или с первой сделки)
    if not v_pf then
        v_flows_from := coalesce(
            (select max(as_of) from risk.risk_snapshot
              where portfolio_id = p_portfolio_id and as_of < p_as_of and not is_proforma),
            (select min(trade_date) from ops.trade where portfolio_id = p_portfolio_id));
        call ops.book_bond_flows(p_portfolio_id, v_flows_from, p_as_of);
    end if;

    delete from risk.position_snapshot where portfolio_id = p_portfolio_id and as_of = p_as_of;
    delete from risk.risk_snapshot     where portfolio_id = p_portfolio_id and as_of = p_as_of;

    insert into risk.position_snapshot (as_of, portfolio_id, bond_id, qty, clean_price_pct, price_date,
        accrued_interest, fx_rate, mv_rub, ytm_pct, duration_mac, duration_mod, convexity, dv01,
        g_spread_bp, rating_grade, rating_source, is_proforma, dm_bp, price_source)
    select p_as_of, p_portfolio_id, v.bond_id, v.qty, v.clean_price_pct, v.price_date, v.accrued_interest,
           v.fx_rate, round(v.mv_rub::numeric, 2), v.ytm_pct, v.duration_mac, v.duration_mod, v.convexity,
           round(v.dv01_rub::numeric), v.g_spread_bp, v.rating_grade, v.rating_source, v_pf, v.dm_bp, v.price_source
      from risk.position_valuation(p_portfolio_id, p_as_of, null, 0, p_holdings_date) v;

    select * into m from risk.portfolio_metrics(p_portfolio_id, p_as_of, null, 0, 32, 2.326, p_holdings_date);
    insert into risk.risk_snapshot (as_of, portfolio_id, mv_net, mv_gross, cash_total_rub, dv01, cs01, adv01,
        duration_mac, duration_mod, convexity, ytm_avg, current_yield_avg, g_spread_avg_bp, var_99_1d,
        rating_score, rating_grade, positions_count, is_proforma, dm_avg_bp, floater_share_pct)
    values (p_as_of, p_portfolio_id, round(m.mv_net::numeric, 2), round(m.mv_gross::numeric, 2),
            round(m.cash_total_rub::numeric, 2), round(m.dv01::numeric), round(m.cs01::numeric),
            round(m.adv01::numeric), m.duration_mac, m.duration_mod, m.convexity, m.ytm_avg,
            m.current_yield_avg, m.g_spread_avg_bp, round(m.var_99_1d::numeric), m.rating_score,
            m.rating_grade, m.positions_count, v_pf, m.dm_avg_bp, m.floater_share_pct);

    if v_pf then
        return;                                    -- про-форма не создаёт нарушений лимитов
    end if;

    -- предыдущий фактический расчёт: снятие переносится только на непрерывную цепочку нарушений
    select max(as_of) into v_prev_eod from risk.risk_snapshot
     where portfolio_id = p_portfolio_id and as_of < p_as_of and not is_proforma;

    for r in select f.*, l.updated_at as limit_updated_at
               from risk.limit_facts(p_portfolio_id, p_as_of) f
               join risk.risk_limit l on l.limit_id = f.limit_id loop
        select * into v_old from risk.limit_breach where limit_id = r.limit_id and as_of = p_as_of for update;
        if r.status in ('warning', 'breach') then
            -- снятие действует, пока не изменились сам лимит (порог, тип, срок) и вид нарушения
            -- (предупреждение ↔ нарушение). limit_value не сравнивается: у порога в % от брутто он
            -- меняется каждый день вместе со стоимостью портфеля.
            if found then
                v_keep := v_old.status = 'waived' and v_old.waived_status = r.status::risk.breach_status
                          and r.limit_updated_at <= v_old.waived_at;
                v_prev := v_old;
            else
                select * into v_prev from risk.limit_breach
                 where limit_id = r.limit_id and as_of = v_prev_eod;
                v_keep := found and v_prev.status = 'waived' and v_prev.waived_status = r.status::risk.breach_status
                          and r.limit_updated_at <= v_prev.waived_at;
            end if;
            insert into risk.limit_breach (limit_id, as_of, fact_value, limit_value, utilization_pct, status,
                                           waived_status, waived_by, waived_at, waive_reason)
            values (r.limit_id, p_as_of, round(r.fact_value::numeric, 4), round(r.limit_value::numeric, 4),
                    round(r.utilization_pct::numeric, 2),
                    case when v_keep then 'waived' else r.status end::risk.breach_status,
                    case when v_keep then v_prev.waived_status end,
                    case when v_keep then v_prev.waived_by end,
                    case when v_keep then v_prev.waived_at end,
                    case when v_keep then v_prev.waive_reason end)
            on conflict (limit_id, as_of) do update
                set fact_value = excluded.fact_value, limit_value = excluded.limit_value,
                    utilization_pct = excluded.utilization_pct, status = excluded.status,
                    waived_status = excluded.waived_status, waived_by = excluded.waived_by,
                    waived_at = excluded.waived_at, waive_reason = excluded.waive_reason;
        elsif found then
            delete from risk.limit_breach where breach_id = v_old.breach_id;   -- вернулся в норму
        end if;
    end loop;
end $$;

create or replace procedure risk.waive_breach(p_breach_id bigint, p_user_id bigint, p_reason text)
language plpgsql as $$
declare v_role ops.user_role;
begin
    select role into v_role from ops.app_user where user_id = p_user_id and is_active;
    if v_role is null or v_role not in ('risk_manager', 'admin') then
        raise exception 'only risk manager can waive a breach' using errcode = 'BR005';
    end if;
    if p_reason is null or length(trim(p_reason)) < 5 then
        raise exception 'waive reason is required' using errcode = 'BR005';
    end if;
    -- очередь портфеля: снятие не пересекается с EOD, который переписывает строки нарушений
    perform pg_advisory_xact_lock(hashtext('portfolio'), l.portfolio_id::int)
       from risk.limit_breach lb join risk.risk_limit l using (limit_id) where lb.breach_id = p_breach_id;
    -- waived_status запоминает вид нарушения: снятие переносится, пока он не изменился
    update risk.limit_breach
       set waived_status = status, status = 'waived', waived_by = p_user_id, waived_at = now(), waive_reason = p_reason
     where breach_id = p_breach_id and status <> 'waived';
    if not found then
        raise exception 'breach % not found or already waived', p_breach_id using errcode = 'BR404';
    end if;
end $$;

-- SECURITY DEFINER: REFRESH требует владельца матвью (postgres), приложение работает под app_rw.
create or replace procedure risk.refresh_views()
language plpgsql security definer set search_path = risk, pg_temp as $$
begin
    refresh materialized view concurrently risk.mv_portfolio_risk;
end $$;

-- Обёртка-функция: та же операция, вызываемая из SELECT (удобно из приложения и тестов).
create or replace function ops.execute_trade_fn(
    p_portfolio_id bigint, p_bond_id bigint, p_side ops.trade_side, p_qty bigint,
    p_clean_price_pct numeric, p_user_id bigint,
    p_trade_date date default current_date, p_settlement_days int default 1,
    p_fee numeric default 0, p_counterparty text default null,
    p_check_limits boolean default true)
returns bigint
language plpgsql as $$
declare v_id bigint;
begin
    call ops.execute_trade(p_portfolio_id, p_bond_id, p_side, p_qty, p_clean_price_pct, p_user_id,
                           p_trade_date, p_settlement_days, p_fee, p_counterparty, p_check_limits, v_id);
    return v_id;
end $$;
