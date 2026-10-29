-- q11. Нереализованный результат по позициям на дату (методология §17):
-- uPL = (MV_лок по грязной цене − B) × FX, B = Q × P̄% / 100 × N (базис по средней чистой цене покупки),
-- что эквивалентно (P_тек − P̄) · Q + НКД · Q; не определяется без средней цены (шорт без покупок).
-- Количество и средняя цена — по сделкам не позже даты; ранг лучших/худших и квартили.
-- Конструкции: табличная функция оценки, CASE, оконные RANK/NTILE.
-- Параметры: :portfolio_id, :as_of
with x as (
    select v.bond_id, v.isin, v.short_name, v.currency, v.qty, v.avg_cost_pct as avg_price,
           v.clean_price_pct as price, v.price_date, v.accrued_interest as ai, v.fx_rate as fx,
           case when v.avg_cost_pct is not null
                then (v.clean_price_pct - v.avg_cost_pct) / 100.0 * v.face_current * v.qty end as price_pnl_local,
           v.accrued_interest * v.qty                                                     as accrued_local,
           case when v.avg_cost_pct is not null
                then (v.mv_local - v.qty * v.avg_cost_pct / 100.0 * v.face_current) * v.fx_rate end as unrealized_rub,
           abs(v.qty * v.avg_cost_pct / 100.0 * v.face_current * v.fx_rate)             as basis_rub
      from risk.position_valuation(:portfolio_id, cast(:as_of as date)) v
)
select bond_id, isin, short_name, currency, qty, avg_price, price, price_date, ai, fx,
       price_pnl_local, accrued_local, unrealized_rub,
       unrealized_rub / nullif(basis_rub, 0) * 100           as return_pct,
       rank() over (order by unrealized_rub desc nulls last) as rank_best,
       rank() over (order by unrealized_rub asc nulls last)  as rank_worst,
       ntile(4) over (order by unrealized_rub nulls first)   as quartile
  from x
 order by unrealized_rub desc nulls last;
