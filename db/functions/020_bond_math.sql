-- =====================================================================
--  Финансовая математика облигации (методология §3–§8, §10).
--  Конвенция доходности: эффективная годовая (биржевая), PV = Σ CF_i · (1+y)^(−t_i). Формулы §4–§6
--  записаны через период 1/f; при эффективной y периодическая ставка ip = (1+y)^(1/f) − 1, и
--  (1+ip)^(f·t) = (1+y)^t — дюрация совпадает, конвексность считается по формуле §6 с этой ip.
-- =====================================================================
-- сигнатуры расширены — прежние перегрузки удаляются, иначе вызов с двумя аргументами неоднозначен
drop function if exists ref.bond_cash_flows(bigint, date);
drop function if exists ref.bond_risk_measures(bigint, date, double precision);
drop function if exists ref.bond_metrics(bigint, date);

-- Остаток номинала на дату (после прошедших частичных погашений, §3).
create or replace function ref.face_value_at(p_bond_id bigint, p_as_of date)
returns double precision
language sql stable as $$
    select b.face_value_initial::double precision
           - coalesce((select sum(s.amount) from ref.cash_flow_schedule s
                       where s.bond_id = b.bond_id
                         and s.flow_type in ('amortization', 'redemption')
                         and s.pay_date <= p_as_of), 0)
    from ref.bond b where b.bond_id = p_bond_id
$$;

-- Ставка купона, действующая/проецируемая на дату: последняя известная ставка графика,
-- иначе ставка выпуска (для флоутеров — проекция «последняя ненулевая ставка», §8).
create or replace function ref.coupon_rate_at(p_bond_id bigint, p_as_of date)
returns double precision
language sql stable as $$
    -- последний известный купон: ставка, иначе ставка, выведенная из суммы купона. У флоутеров MOEX
    -- публикует только суммы, а сумма текущего купона до фиксации пустая — берётся прошлый купон
    select coalesce(
        (select coalesce(nullif(s.rate_pct, 0)::double precision,
                         s.amount::double precision / nullif(ref.face_value_at(p_bond_id, lower(s.period)), 0)
                           * 365.0 / nullif(upper(s.period) - lower(s.period), 0) * 100)
           from ref.cash_flow_schedule s
          where s.bond_id = p_bond_id and s.flow_type = 'coupon'
            and (s.rate_pct > 0 or s.amount > 0)
            and lower(s.period) <= p_as_of
          order by lower(s.period) desc limit 1),
        (select s.rate_pct::double precision from ref.cash_flow_schedule s
          where s.bond_id = p_bond_id and s.flow_type = 'coupon'
            and s.rate_pct is not null and s.rate_pct > 0
          order by lower(s.period) limit 1),
        (select b.coupon_rate_pct::double precision from ref.bond b where b.bond_id = p_bond_id),
        0)
$$;

-- Будущие денежные потоки на одну бумагу после даты D (§3–§4): купоны по графику на уменьшенный остаток,
-- погашения тела по графику; остаток, не покрытый графиком, гасится на горизонте. Горизонт — ближайшая
-- оферта (номинал возвращается на оферте, погашения после неё не наступают), с p_to_maturity — погашение
-- (дисконтная маржа флоутера, §8). Контроль данных (§3): если сумма будущих погашений больше непогашенного
-- номинала, график признаётся не относящимся к бумаге и игнорируется — весь остаток гасится на горизонте.
create or replace function ref.bond_cash_flows(p_bond_id bigint, p_as_of date, p_to_maturity boolean default false)
returns table (flow_date date, t_years double precision, amount double precision, kind ref.flow_type)
language plpgsql stable as $$
declare
    b            ref.bond%rowtype;
    v_horizon    date;
    v_face       double precision;
    v_rate       double precision;
    v_principal  double precision := 0;
    v_future     double precision;
    v_use_sched  boolean;
    v_has_coupons boolean;
    v_step       interval;
    v_d          date;
begin
    select * into b from ref.bond where bond_id = p_bond_id;
    if not found then
        raise exception 'bond % not found', p_bond_id using errcode = 'BR404';
    end if;

    if not p_to_maturity then
        select min(s.pay_date) into v_horizon
          from ref.cash_flow_schedule s
         where s.bond_id = p_bond_id and s.flow_type = 'offer' and s.pay_date > p_as_of;
        if v_horizon is null and b.offer_date is not null and b.offer_date > p_as_of then
            v_horizon := b.offer_date;
        end if;
    end if;
    v_horizon := least(coalesce(v_horizon, b.maturity_date), b.maturity_date);
    if v_horizon <= p_as_of then
        return;                                            -- бумага погашена
    end if;

    v_face := ref.face_value_at(p_bond_id, p_as_of);
    v_rate := ref.coupon_rate_at(p_bond_id, p_as_of);
    select coalesce(sum(s.amount), 0) into v_future
      from ref.cash_flow_schedule s
     where s.bond_id = p_bond_id and s.flow_type in ('amortization', 'redemption')
       and s.amount is not null and s.pay_date > p_as_of;
    v_use_sched := v_future <= v_face + 1e-6;

    select exists (select 1 from ref.cash_flow_schedule s
                    where s.bond_id = p_bond_id and s.flow_type = 'coupon' and s.pay_date > p_as_of)
      into v_has_coupons;

    if v_has_coupons then
        -- купоны по графику; сумма периода неизвестна → ставка × остаток номинала × дни/365
        return query
            select s.pay_date,
                   ((s.pay_date - p_as_of) / 365.0)::double precision,
                   coalesce(s.amount::double precision,
                            coalesce(s.rate_pct::double precision, v_rate) / 100.0
                              * (case when v_use_sched then ref.face_value_at(p_bond_id, lower(s.period)) else v_face end)
                              * (upper(s.period) - lower(s.period)) / 365.0),
                   s.flow_type
              from ref.cash_flow_schedule s
             where s.bond_id = p_bond_id and s.flow_type = 'coupon'
               and s.pay_date > p_as_of and s.pay_date <= v_horizon;
    elsif b.coupon_type <> 'zero' and v_rate > 0 and b.coupon_freq > 0 then
        -- графика нет (§4 п. 3): равные купоны от погашения назад с шагом 12/f месяцев
        v_step := (12 / b.coupon_freq) * interval '1 month';
        v_d := b.maturity_date;
        while v_d > p_as_of loop
            if v_d <= v_horizon then
                flow_date := v_d; t_years := (v_d - p_as_of) / 365.0;
                amount := v_rate / 100.0 * v_face / b.coupon_freq; kind := 'coupon';
                return next;
            end if;
            v_d := v_d - v_step;
        end loop;
    end if;

    if v_use_sched then
        return query
            select s.pay_date, ((s.pay_date - p_as_of) / 365.0)::double precision, s.amount::double precision, s.flow_type
              from ref.cash_flow_schedule s
             where s.bond_id = p_bond_id and s.flow_type in ('amortization', 'redemption')
               and s.amount is not null and s.pay_date > p_as_of and s.pay_date <= v_horizon;
        select coalesce(sum(s.amount), 0) into v_principal
          from ref.cash_flow_schedule s
         where s.bond_id = p_bond_id and s.flow_type in ('amortization', 'redemption')
           and s.amount is not null and s.pay_date > p_as_of and s.pay_date <= v_horizon;
    end if;

    -- остаток тела, не покрытый графиком, возвращается на горизонте (оферта или погашение)
    if v_face - v_principal > 1e-9 then
        flow_date := v_horizon; t_years := (v_horizon - p_as_of) / 365.0;
        amount := v_face - v_principal; kind := 'redemption';
        return next;
    end if;
end $$;

-- НКД на одну бумагу на дату по графику купонов (§3, приоритет «расчёт по графику»): сумма периода
-- (фактическая, иначе ставка × номинал × дни/365) × прошедшие дни / длина периода. Без графика — формула
-- по текущему периоду синтетического графика (тот же шаг 12/f, что в ref.bond_cash_flows).
create or replace function ref.accrued_interest(p_bond_id bigint, p_as_of date)
returns double precision
language plpgsql stable as $$
declare
    s     ref.cash_flow_schedule%rowtype;
    b     ref.bond%rowtype;
    v_amount double precision;
    v_step interval;
    v_next date;
    v_prev date;
begin
    select * into s from ref.cash_flow_schedule
     where bond_id = p_bond_id and flow_type = 'coupon' and period @> p_as_of
     limit 1;
    if not found then
        select * into b from ref.bond where bond_id = p_bond_id;
        if b.coupon_type = 'zero' or coalesce(b.coupon_freq, 0) <= 0 or p_as_of >= b.maturity_date
           or exists (select 1 from ref.cash_flow_schedule where bond_id = p_bond_id and flow_type = 'coupon') then
            return 0;
        end if;
        v_step := (12 / b.coupon_freq) * interval '1 month';
        v_next := b.maturity_date;
        while (v_next - v_step)::date > p_as_of loop
            v_next := (v_next - v_step)::date;
        end loop;
        v_prev := greatest((v_next - v_step)::date, coalesce(b.issue_date, (v_next - v_step)::date));
        return coalesce(ref.coupon_rate_at(p_bond_id, p_as_of), 0) / 100.0 * ref.face_value_at(p_bond_id, p_as_of)
               / b.coupon_freq * (p_as_of - v_prev) / nullif(v_next - (v_next - v_step)::date, 0);
    end if;
    v_amount := coalesce(s.amount::double precision,
                         coalesce(s.rate_pct::double precision, ref.coupon_rate_at(p_bond_id, p_as_of)) / 100.0
                           * ref.face_value_at(p_bond_id, lower(s.period))
                           * (upper(s.period) - lower(s.period)) / 365.0);
    return v_amount * (p_as_of - lower(s.period)) / (upper(s.period) - lower(s.period));
end $$;

-- НКД в сумме сделки на дату расчётов S (§20.1): AI(S) = AI(D) + c · N · (S − D) / 365; выплата купона
-- между сделкой и расчётами не моделируется; без ставки купона — AI(D).
create or replace function ref.accrued_at_settlement(p_bond_id bigint, p_trade_date date, p_settle date)
returns double precision
language sql stable as $$
    select ref.accrued_interest(p_bond_id, p_trade_date)
           + coalesce(nullif(ref.coupon_rate_at(p_bond_id, p_trade_date), 0), 0) / 100.0
             * ref.face_value_at(p_bond_id, p_trade_date) * greatest(p_settle - p_trade_date, 0) / 365.0
$$;

-- Котировка бумаги на дату D для оценки (§3): цена — ручная корректировка среза, иначе закрытие D,
-- иначе последняя котировка в окне 90 дней, иначе p_cost_price_pct (средняя цена постановки на учёт);
-- номинал — корректировка или непогашенный остаток; НКД — корректировка или расчёт по графику на дату
-- расчётов T+2 рабочих дня. Рыночные доходность и дюрация (§4 п. 1, §5 п. 2) — сохранённые значения
-- MOEX на дату D: торговая система проекта — собственный журнал сделок с ценами биржи.
create or replace function ref.bond_quote(p_bond_id bigint, p_as_of date, p_cost_price_pct double precision default null)
returns table (clean_price_pct double precision, price_date date, price_source text, face_current double precision,
               accrued_interest double precision, dirty_price double precision,
               market_ytm double precision, market_duration_days double precision)
language plpgsql stable as $$
declare
    o risk.price_override%rowtype; p record;
begin
    select * into o from risk.price_override where bond_id = p_bond_id and as_of = p_as_of;
    face_current := coalesce(o.face_value::double precision, ref.face_value_at(p_bond_id, p_as_of));
    if face_current is null or face_current <= 0 then
        return;                                                   -- погашена
    end if;
    select * into p from risk.price_at(p_bond_id, p_as_of);
    if o.clean_price_pct is not null then
        clean_price_pct := o.clean_price_pct; price_date := p_as_of; price_source := 'override';
    elsif p.close_pct is not null then
        clean_price_pct := p.close_pct; price_date := p.price_date;
        price_source := case when p.price_date = p_as_of then 'close' else 'last' end;
    elsif p_cost_price_pct is not null and p_cost_price_pct > 0 then
        clean_price_pct := p_cost_price_pct; price_date := null; price_source := 'cost';
    else
        return;
    end if;
    accrued_interest := coalesce(o.accrued_interest::double precision,
                                 ref.accrued_interest(p_bond_id, ref.add_business_days(p_as_of, 2)));
    -- ни одного известного купона (новый флоутер до первой фиксации) — расчёт по графику даёт 0,
    -- тогда НКД берётся с биржи (§3, следующий источник после графика)
    if o.accrued_interest is null and accrued_interest = 0 and ref.coupon_rate_at(p_bond_id, p_as_of) = 0 then
        select coalesce(h.accrued_interest, 0) into accrued_interest
          from ts.price_history h
         where h.bond_id = p_bond_id and h.ts <= p_as_of and h.ts > p_as_of - 90 and h.accrued_interest is not null
         order by h.ts desc limit 1;
        accrued_interest := coalesce(accrued_interest, 0);
    end if;
    dirty_price := clean_price_pct / 100.0 * face_current + accrued_interest;
    if price_source = 'close' then
        select nullif(h.yield_close, 0) / 100.0, nullif(h.duration_days, 0)
          into market_ytm, market_duration_days
          from ts.price_history h where h.bond_id = p_bond_id and h.ts = p_as_of;
    end if;
    return next;
end $$;

-- Приведённая стоимость потоков при эффективной годовой доходности y (на одну бумагу).
create or replace function ref.pv_of_flows(p_t double precision[], p_cf double precision[], p_y double precision)
returns double precision
language plpgsql immutable as $$
declare
    v double precision := 0; i int;
begin
    for i in 1 .. coalesce(array_length(p_t, 1), 0) loop
        v := v + p_cf[i] * power(1 + p_y, -p_t[i]);
    end loop;
    return v;
end $$;

-- Доходность к погашению/оферте (§4 п. 2): бисекция по фактическим потокам, y ∈ [−50 %; +500 %].
create or replace function ref.bond_ytm(p_bond_id bigint, p_dirty_price double precision, p_as_of date)
returns double precision
language plpgsql stable as $$
declare
    v_t double precision[]; v_cf double precision[];
    lo double precision := -0.5; hi double precision := 5.0; mid double precision;
    f_lo double precision; f_mid double precision; i int;
begin
    select array_agg(t_years order by flow_date), array_agg(amount order by flow_date)
      into v_t, v_cf from ref.bond_cash_flows(p_bond_id, ref.add_business_days(p_as_of, 2));
    if v_t is null or p_dirty_price is null or p_dirty_price <= 0 then
        return null;
    end if;
    f_lo := ref.pv_of_flows(v_t, v_cf, lo) - p_dirty_price;
    if f_lo < 0 or ref.pv_of_flows(v_t, v_cf, hi) - p_dirty_price > 0 then
        return null;                                         -- корень вне диапазона
    end if;
    for i in 1 .. 200 loop
        mid := (lo + hi) / 2;
        f_mid := ref.pv_of_flows(v_t, v_cf, mid) - p_dirty_price;
        if abs(f_mid) < 1e-10 or (hi - lo) < 1e-12 then
            exit;
        end if;
        if sign(f_mid) = sign(f_lo) then
            lo := mid; f_lo := f_mid;
        else
            hi := mid;
        end if;
    end loop;
    return mid;
end $$;

-- Дюрация (§5) и конвексность (§6) при доходности y. Порядок методов дюрации: флоутер (срок до пересмотра
-- купона или оферты) → рыночная дюрация MOEX в днях → по графику потоков → аппроксимация
-- D_mod = (1 − (1 + y/f)^(−n)) / y, n = T·f (нет потоков или расчёт не дал положительного значения).
-- Конвексность: флоутер — как у бескупонной на срок до пересмотра; иначе формула §6, при неположительном
-- результате — C ≈ D_Mac · (D_Mac + 0,5) / (1 + y/2)².
create or replace function ref.bond_risk_measures(p_bond_id bigint, p_as_of date, p_y double precision,
                                                  p_market_duration_days double precision default null)
returns table (duration_mac double precision, duration_mod double precision, convexity double precision)
language plpgsql stable as $$
declare
    b ref.bond%rowtype;
    v_t double precision[]; v_cf double precision[];
    v_f int; v_ip double precision; v_n double precision; v_disc double precision;
    v_pv double precision := 0; v_tpv double precision := 0; v_cxn double precision := 0;
    v_next double precision; v_mat double precision; i int;
begin
    select * into b from ref.bond where bond_id = p_bond_id;
    if p_y is null or p_y <= -0.99 then                      -- вырожденная доходность: (1+y)^−t не определена
        return;
    end if;
    if b.coupon_type = 'floating' then
        select min(t_years) into v_next from ref.bond_cash_flows(p_bond_id, ref.add_business_days(p_as_of, 2));
        if v_next is null then return; end if;
        duration_mac := v_next;
        duration_mod := v_next / (1 + p_y);
        convexity    := v_next * (v_next + 1) / power(1 + p_y, 2);
        return next;
        return;
    end if;
    v_f := greatest(coalesce(b.coupon_freq, 1), 1);
    v_ip := power(1 + p_y, 1.0 / v_f) - 1;
    select array_agg(t_years order by flow_date), array_agg(amount order by flow_date)
      into v_t, v_cf from ref.bond_cash_flows(p_bond_id, ref.add_business_days(p_as_of, 2));
    for i in 1 .. coalesce(array_length(v_t, 1), 0) loop
        v_n := v_f * v_t[i];
        v_disc := v_cf[i] * power(1 + v_ip, -v_n);
        v_pv  := v_pv + v_disc;
        v_tpv := v_tpv + v_t[i] * v_disc;
        v_cxn := v_cxn + v_cf[i] * v_n * (v_n + 1) * power(1 + v_ip, -(v_n + 2));
    end loop;

    if p_market_duration_days is not null and p_market_duration_days > 0 then
        duration_mac := p_market_duration_days / 365.0;
    elsif v_pv > 0 and v_tpv / v_pv > 0 then
        duration_mac := v_tpv / v_pv;
    else
        v_mat := (b.maturity_date - p_as_of) / 365.0;
        if v_mat <= 0 then return; end if;
        duration_mod := case when abs(p_y) < 1e-12 then v_mat
                             else (1 - power(1 + p_y / v_f, -v_mat * v_f)) / p_y end;
        duration_mac := duration_mod * (1 + p_y);
    end if;
    duration_mod := duration_mac / (1 + p_y);
    convexity := case when v_pv > 0 and v_cxn > 0 then v_cxn / v_pv / (v_f * v_f) end;
    if convexity is null or convexity <= 0 then
        convexity := duration_mac * (duration_mac + 0.5) / power(1 + p_y / 2, 2);
    end if;
    return next;
end $$;

-- Дисконтная маржа флоутера (§8): P + AI = Σ (C_i + N_i) / (1 + (r/100 + DM)/f)^(τ_i·f), r — последняя
-- ненулевая ставка графика (проекция постоянна), потоки до погашения без усечения по оферте; бисекция на
-- [−5000; +50 000] б.п., результат принимается в (−3000; +6000) б.п. Возвращает б.п.
create or replace function ref.bond_dm(p_bond_id bigint, p_as_of date, p_dirty_price double precision)
returns double precision
language plpgsql stable as $$
declare
    v_t double precision[]; v_cf double precision[]; v_f int; v_r double precision;
    lo double precision := -0.5; hi double precision := 5.0; mid double precision;
    f_lo double precision; f_mid double precision; i int; k int;
    function_pv double precision;
begin
    if p_dirty_price is null or p_dirty_price <= 0 then return null; end if;
    select greatest(coalesce(coupon_freq, 1), 1) into v_f from ref.bond where bond_id = p_bond_id;
    v_r := ref.coupon_rate_at(p_bond_id, p_as_of) / 100.0;
    select array_agg(t_years order by flow_date), array_agg(amount order by flow_date)
      into v_t, v_cf from ref.bond_cash_flows(p_bond_id, ref.add_business_days(p_as_of, 2), true);
    if v_t is null then return null; end if;
    for k in 0 .. 201 loop
        mid := case k when 0 then lo when 1 then hi else (lo + hi) / 2 end;
        function_pv := 0;
        for i in 1 .. array_length(v_t, 1) loop
            function_pv := function_pv + v_cf[i] * power(1 + (v_r + mid) / v_f, -v_t[i] * v_f);
        end loop;
        f_mid := function_pv - p_dirty_price;
        if k = 0 then
            f_lo := f_mid;
            if f_lo < 0 then return null; end if;            -- даже при DM = −5000 б.п. цена не достигается
        elsif k = 1 then
            if f_mid > 0 then return null; end if;           -- корень правее +50 000 б.п.
        else
            exit when abs(f_mid) < 1e-10 or (hi - lo) < 1e-12;
            if sign(f_mid) = sign(f_lo) then lo := mid; f_lo := f_mid; else hi := mid; end if;
        end if;
    end loop;
    return case when mid * 10000 > -3000 and mid * 10000 < 6000 then mid * 10000 end;
end $$;

-- Z-спред (§10): Σ CF_t / (1 + y(t) + z)^t = P_dirty, y(t) — спот-ставка КБД (эффективная) на срок t,
-- линейно между узлами, за пределами — крайний узел; z ищется бисекцией на [−5 %; +50 %].
-- CS01 одной бумаги = P(z) − P(z + 1 б.п.) в валюте выпуска. Только рублёвые бумаги (КБД — рублёвая).
create or replace function ref.bond_zspread(p_bond_id bigint, p_as_of date, p_dirty_price double precision)
returns table (z_spread_bp double precision, cs01_local double precision)
language plpgsql stable as $$
declare
    v_t double precision[]; v_cf double precision[]; v_y double precision[];
    c_t double precision[]; c_y double precision[]; v_cur char(3);
    lo double precision := -0.3; hi double precision := 5.0; mid double precision;   -- как у YTM: до 500 %
    f_lo double precision; f_mid double precision; i int; j int; k int; n int; pv double precision;
begin
    select currency into v_cur from ref.bond where bond_id = p_bond_id;
    if v_cur <> 'RUB' or p_dirty_price is null or p_dirty_price <= 0 then return; end if;
    select array_agg(tenor_years::double precision order by tenor_years), array_agg(rate_pct / 100.0 order by tenor_years)
      into c_t, c_y from ts.yield_curve where ts = risk.curve_date_at(p_as_of);
    select array_agg(t_years order by flow_date), array_agg(amount order by flow_date)
      into v_t, v_cf from ref.bond_cash_flows(p_bond_id, ref.add_business_days(p_as_of, 2));
    if c_t is null or v_t is null then return; end if;
    n := array_length(c_t, 1);
    v_y := array_fill(0::double precision, array[array_length(v_t, 1)]);
    for i in 1 .. array_length(v_t, 1) loop
        if v_t[i] <= c_t[1] then v_y[i] := c_y[1];
        elsif v_t[i] >= c_t[n] then v_y[i] := c_y[n];
        else
            for j in 2 .. n loop
                if v_t[i] <= c_t[j] then
                    v_y[i] := c_y[j-1] + (c_y[j] - c_y[j-1]) * (v_t[i] - c_t[j-1]) / (c_t[j] - c_t[j-1]);
                    exit;
                end if;
            end loop;
        end if;
    end loop;
    for k in 0 .. 201 loop
        mid := case k when 0 then lo when 1 then hi else (lo + hi) / 2 end;
        pv := 0;
        for i in 1 .. array_length(v_t, 1) loop
            pv := pv + v_cf[i] * power(1 + v_y[i] + mid, -v_t[i]);
        end loop;
        f_mid := pv - p_dirty_price;
        if k = 0 then
            f_lo := f_mid;
            if f_lo < 0 then return; end if;
        elsif k = 1 then
            if f_mid > 0 then return; end if;
        else
            exit when abs(f_mid) < 1e-10 or (hi - lo) < 1e-12;
            if sign(f_mid) = sign(f_lo) then lo := mid; f_lo := f_mid; else hi := mid; end if;
        end if;
    end loop;
    z_spread_bp := mid * 10000;
    pv := 0;
    for i in 1 .. array_length(v_t, 1) loop
        pv := pv + v_cf[i] * power(1 + v_y[i] + mid + 0.0001, -v_t[i]);
    end loop;
    cs01_local := (f_mid + p_dirty_price) - pv;
    return next;
end $$;

-- Полный набор метрик одной бумаги на дату (§3–§10). p_cost_price_pct — средняя цена постановки на учёт:
-- применяется, если котировки за 90 дней нет. YTM — рыночная MOEX на дату D, иначе расчётная (§4);
-- дюрация — §5; у флоутера ещё дисконтная маржа (§8); у рублёвых бумаг Z-спред и CS01 одной бумаги (§10).
create or replace function ref.bond_metrics(p_bond_id bigint, p_as_of date, p_cost_price_pct double precision default null)
returns table (
    clean_price_pct double precision, price_date date, accrued_interest double precision,
    face_current double precision, dirty_price double precision, ytm double precision,
    current_yield_pct double precision,
    duration_mac double precision, duration_mod double precision, convexity double precision,
    dv01_local double precision,
    price_source text, ytm_source text, dm_bp double precision,
    z_spread_bp double precision, cs01_local double precision
)
language plpgsql stable as $$
declare
    q record; v_rate double precision; v_type ref.coupon_type;
begin
    select * into q from ref.bond_quote(p_bond_id, p_as_of, p_cost_price_pct);
    if q.clean_price_pct is null then
        return;
    end if;
    select coupon_type into v_type from ref.bond where bond_id = p_bond_id;
    clean_price_pct := q.clean_price_pct; price_date := q.price_date; accrued_interest := q.accrued_interest;
    face_current := q.face_current; dirty_price := q.dirty_price; price_source := q.price_source;
    -- биржевая доходность ниже −50 % бывает за дни до погашения при цене выше номинала (MOEX
    -- отдаёт до −100 %) — такой ориентир не годится, считаем по потокам
    if q.market_ytm is not null and q.market_ytm > -0.5 then
        ytm := q.market_ytm; ytm_source := 'market';
    else
        ytm := ref.bond_ytm(p_bond_id, dirty_price, p_as_of); ytm_source := 'calc';
    end if;
    v_rate := ref.coupon_rate_at(p_bond_id, p_as_of);
    current_yield_pct := case when clean_price_pct > 0 then v_rate / clean_price_pct * 100 end;
    select m.duration_mac, m.duration_mod, m.convexity
      into duration_mac, duration_mod, convexity
      from ref.bond_risk_measures(p_bond_id, p_as_of, ytm, q.market_duration_days) m;
    dv01_local := dirty_price * duration_mod / 10000.0;      -- нет дюрации — нет и DV01, а не ноль
    if v_type = 'floating' then
        dm_bp := ref.bond_dm(p_bond_id, p_as_of, dirty_price);
    end if;
    select z.z_spread_bp, z.cs01_local into z_spread_bp, cs01_local
      from ref.bond_zspread(p_bond_id, p_as_of, dirty_price) z;
    return next;
end $$;
