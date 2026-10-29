-- q05. G-спреды бумаг портфеля и средний кредитный спред (методология §9, §9.1) с причинами исключения.
-- Конструкции: табличная функция в CTE, CASE-классификация, оконные агрегаты с FILTER, ORDER BY NULLS LAST.
-- Параметры: :portfolio_id, :as_of
with v as (
    select * from risk.position_valuation(:portfolio_id, cast(:as_of as date))
),
x as (
    select bond_id, isin, short_name, currency, coupon_type, is_sovereign, rating_grade, mv_rub,
           ytm_pct, duration_mod,
           risk.curve_rate_at(cast(:as_of as date), duration_mod) as curve_rate_pct,
           g_spread_bp,
           case when clean_price_pct is null          then 'нет цены'
                when currency <> 'RUB'                 then 'валютная бумага (кривая рублёвая)'
                when coupon_type = 'floating'          then 'флоутер — применяется дисконтная маржа'
                when is_sovereign                      then 'суверенная — база кривой'
                when rating_grade in ('D', 'SD')       then 'дефолт'
                when g_spread_bp is null               then 'нет доходности или кривой'
                when g_spread_bp < -200                then 'спред < −200 б.п. — ошибка данных'
                when g_spread_bp > 3000                then 'спред > 3000 б.п. — дистресс'
           end as exclusion_reason
      from v
)
select bond_id, isin, short_name, currency, rating_grade, ytm_pct, curve_rate_pct, g_spread_bp, mv_rub,
       exclusion_reason is null as included, exclusion_reason,
       sum(g_spread_bp * abs(mv_rub)) filter (where exclusion_reason is null) over ()
           / nullif(sum(abs(mv_rub)) filter (where exclusion_reason is null) over (), 0) as avg_spread_bp
  from x
 order by included desc, g_spread_bp desc nulls last;
