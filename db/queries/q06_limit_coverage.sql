-- q06. Контроль покрытия лимитами: эмитенты в портфеле, на которых нет действующего лимита концентрации.
-- Конструкции: табличная функция, JOIN, NOT EXISTS (коррелированный подзапрос), GROUP BY/HAVING, скалярный подзапрос.
-- Параметры: :portfolio_id, :as_of
with v as (
    select * from risk.position_valuation(:portfolio_id, cast(:as_of as date))
)
select i.issuer_id, i.name as issuer_name, i.sector,
       count(*)              as positions,
       sum(abs(v.mv_rub))    as mv_rub,
       sum(abs(v.mv_rub)) / nullif((select sum(abs(mv_rub)) from v), 0) * 100 as share_pct,
       min(v.rating_grade)   as rating_grade
  from v
  join ref.issuer i on i.issuer_id = v.issuer_id
 where not v.is_sovereign
   and not exists (
         select 1 from risk.risk_limit l
          where l.portfolio_id = :portfolio_id
            and l.metric = 'conc_issuer'
            and l.scope_issuer_id = i.issuer_id
            and l.valid_from <= cast(:as_of as date)
            and (l.valid_to is null or l.valid_to >= cast(:as_of as date)))
 group by i.issuer_id, i.name, i.sector
having sum(abs(v.mv_rub)) > 0
 order by mv_rub desc;
