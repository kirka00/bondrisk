-- q01. Позиции портфеля на последнюю дату снапшота ≤ :as_of: ранг по |MV|, доля и накопленная доля.
-- Конструкции: JOIN ×3, подзапрос (CTE snap), оконные функции RANK() OVER, SUM() OVER (), SUM() OVER (ORDER BY … ROWS).
-- Параметры: :portfolio_id, :as_of
with snap as (
    select max(as_of) as as_of
      from risk.position_snapshot
     where portfolio_id = :portfolio_id and as_of <= cast(:as_of as date)
)
select ps.as_of, ps.bond_id, b.isin, b.short_name, i.name as issuer_name, b.currency,
       ps.qty, ps.clean_price_pct, ps.mv_rub, ps.dv01, ps.ytm_pct, ps.duration_mac, ps.rating_grade,
       rank() over (order by abs(ps.mv_rub) desc)                                  as mv_rank,
       abs(ps.mv_rub) / nullif(sum(abs(ps.mv_rub)) over (), 0) * 100              as weight_pct,
       sum(abs(ps.mv_rub)) over (order by abs(ps.mv_rub) desc, ps.bond_id rows unbounded preceding)
           / nullif(sum(abs(ps.mv_rub)) over (), 0) * 100                        as cum_weight_pct
  from risk.position_snapshot ps
  join snap on snap.as_of = ps.as_of
  join ref.bond b   on b.bond_id = ps.bond_id
  join ref.issuer i on i.issuer_id = b.issuer_id
 where ps.portfolio_id = :portfolio_id
 order by mv_rank;
