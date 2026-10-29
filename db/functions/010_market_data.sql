-- =====================================================================
--  Рыночные данные: цена с fallback (методология §3), курс (§3, §19), кривая КБД (§9), рабочие дни (§20.1)
-- =====================================================================

-- Цена закрытия на дату D, иначе последняя котировка не позже D в окне 90 дней.
create or replace function risk.price_at(p_bond_id bigint, p_as_of date, p_window_days int default 90)
returns table (close_pct double precision, price_date date, accrued_interest double precision)
language sql stable as $$
    select close_pct, ts, accrued_interest
    from ts.price_history
    where bond_id = p_bond_id
      and ts <= p_as_of
      and ts > p_as_of - p_window_days
      and close_pct is not null
    order by ts desc
    limit 1
$$;

-- Сдвиг даты на n рабочих дней (суббота и воскресенье пропускаются, праздничный календарь не ведётся, §20.1);
-- n < 0 — назад.
create or replace function ref.add_business_days(p_date date, p_n int)
returns date
language plpgsql immutable as $$
declare
    v date := p_date; step int := sign(p_n)::int; i int;
begin
    for i in 1 .. abs(p_n) loop
        v := v + step;
        while extract(isodow from v) >= 6 loop v := v + step; end loop;
    end loop;
    return v;
end $$;

-- Курс, действующий на дату (последний установленный ЦБ не позже D); RUB = 1.
create or replace function risk.fx_on(p_currency char(3), p_date date)
returns double precision
language sql stable as $$
    select case when p_currency = 'RUB' then 1.0
                else (select rate_rub from ts.fx_rate
                      where currency = p_currency and ts <= p_date
                      order by ts desc limit 1)
           end
$$;

-- Курс для оценки (§3, общие конвенции): текущий срез — на дату D, прошлые даты — курс предыдущего
-- рабочего дня относительно D. Резерв «середина биржевых котировок» не нужен: ЦБ публикует курс каждый
-- рабочий день, а последний установленный курс действует до следующего.
create or replace function risk.fx_at(p_currency char(3), p_as_of date)
returns double precision
language sql stable as $$
    select risk.fx_on(p_currency, case when p_as_of >= current_date then p_as_of
                                       else ref.add_business_days(p_as_of, -1) end)
$$;

-- Дата последней доступной кривой КБД не позже D (в окне 30 дней).
create or replace function risk.curve_date_at(p_as_of date)
returns date
language sql stable as $$
    select max(ts) from ts.yield_curve where ts <= p_as_of and ts > p_as_of - 30
$$;

-- Ставка КБД, интерполированная по модифицированной дюрации (§9). Значения MOEX (yearyields) — эффективная
-- годовая доходность: совпадает с exp(G(t)) − 1 по параметрам кривой, как и YTM бумаг.
-- Узел (T, y) переводится в координаты дюрации D = T / (1 + y), между узлами — линейная интерполяция по D,
-- за пределами диапазона — крайний узел. Возвращает % годовых.
create or replace function risk.curve_rate_at(p_as_of date, p_duration_mod double precision)
returns double precision
language plpgsql stable as $$
declare
    v_date date := risk.curve_date_at(p_as_of);
    v_d  double precision[];
    v_y  double precision[];
    i int;
begin
    if v_date is null or p_duration_mod is null then
        return null;
    end if;
    select array_agg(tenor_years / (1 + rate_pct / 100.0) order by tenor_years),
           array_agg(rate_pct order by tenor_years)
      into v_d, v_y
    from ts.yield_curve where ts = v_date;

    if p_duration_mod <= v_d[1] then
        return v_y[1];
    end if;
    for i in 2 .. array_length(v_d, 1) loop
        if p_duration_mod <= v_d[i] then
            return v_y[i-1] + (v_y[i] - v_y[i-1]) * (p_duration_mod - v_d[i-1]) / (v_d[i] - v_d[i-1]);
        end if;
    end loop;
    return v_y[array_length(v_y, 1)];
end $$;

-- Спот-ставка КБД на срок t лет (линейно между узлами, за пределами — крайний узел), % годовых.
create or replace function risk.curve_spot_at(p_as_of date, p_t double precision)
returns double precision
language sql stable as $$
    with c as (select tenor_years, rate_pct from ts.yield_curve where ts = risk.curve_date_at(p_as_of)),
         lo as (select * from c where tenor_years <= p_t order by tenor_years desc limit 1),
         hi as (select * from c where tenor_years >= p_t order by tenor_years limit 1)
    select case
               when (select count(*) from c) = 0 then null
               when not exists (select 1 from lo) then (select rate_pct from c order by tenor_years limit 1)
               when not exists (select 1 from hi) then (select rate_pct from c order by tenor_years desc limit 1)
               when (select tenor_years from hi) = (select tenor_years from lo) then (select rate_pct from lo)
               else (select lo.rate_pct + (hi.rate_pct - lo.rate_pct) * (p_t - lo.tenor_years)
                                           / (hi.tenor_years - lo.tenor_years) from lo, hi)
           end
$$;
