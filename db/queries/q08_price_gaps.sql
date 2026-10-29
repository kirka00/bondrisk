-- q08. Пропуски котировок: бумаги с ненулевой позицией (во всех активных портфелях или в одном),
-- у которых нет цены закрытия на дату D, и последняя котировка в окне 90 дней (методология §3, fallback).
-- Конструкции: CTE с GROUP BY/HAVING по сделкам, NOT EXISTS, LEFT JOIN LATERAL … LIMIT 1, CASE.
-- Параметры: :as_of, :portfolio_id (NULL — все активные портфели)
with pos as (
    select t.bond_id
      from ops.trade t join ops.portfolio p on p.portfolio_id = t.portfolio_id
     where t.trade_date <= cast(:as_of as date) and t.status <> 'cancelled' and p.status = 'active'
       and (cast(:portfolio_id as bigint) is null or t.portfolio_id = cast(:portfolio_id as bigint))
     group by t.bond_id
    having sum(case when t.side = 'buy' then t.qty else -t.qty end) <> 0
)
select b.bond_id, b.isin, b.short_name, b.maturity_date,
       lp.price_date as last_price_date, lp.close_pct as last_close_pct,
       cast(:as_of as date) - lp.price_date as days_stale,
       case when lp.price_date is null then 'нет котировок за 90 дней — позиция без цены'
            else 'используется последняя котировка (locf)' end as fallback
  from pos
  join ref.bond b on b.bond_id = pos.bond_id
  left join lateral (
        select ph.ts as price_date, ph.close_pct
          from ts.price_history ph
         where ph.bond_id = b.bond_id and ph.ts <= cast(:as_of as date)
           and ph.ts > cast(:as_of as date) - 90 and ph.close_pct is not null
         order by ph.ts desc limit 1) lp on true
 where not exists (select 1 from ts.price_history ph
                    where ph.bond_id = b.bond_id and ph.ts = cast(:as_of as date) and ph.close_pct is not null)
 order by days_stale desc nulls first, b.short_name;
