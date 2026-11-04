-- q03. Комплексный отчёт: ADV01 по рейтинговым бакетам (методология §14–§15).
-- Этапы: 1) последний расчёт конца дня на дату; 2) позиции среза с каноническим рейтингом на дату оценки
-- (выпуск → эмитент, помечается → ОФЗ = AAA → NR; его фиксирует risk.canonical_rating при расчёте);
-- 3) бакеты шкалы: DV01 длинных/коротких, нетто × коэффициент.
-- Конструкции: многоэтапный CTE, JOIN, COALESCE, FILTER, SUM() OVER ().
-- Параметры: :portfolio_id, :as_of
with snap as (
    select max(as_of) as as_of from risk.position_snapshot
     where portfolio_id = :portfolio_id and as_of <= cast(:as_of as date) and not is_proforma
),
canon as (
    select ps.qty, ps.dv01, ps.mv_rub, coalesce(ps.rating_grade, 'NR') as grade, ps.rating_source
      from risk.position_snapshot ps
      join snap on snap.as_of = ps.as_of
     where ps.portfolio_id = :portfolio_id and not ps.is_proforma
),
buckets as (
    select s.adv01_bucket as bucket, s.adv01_coef as coef, min(s.score) as order_key,
           count(*)                                              as positions,
           count(*) filter (where c.rating_source = 'issuer')    as issuer_level_ratings,
           coalesce(sum(c.dv01) filter (where c.qty > 0), 0)     as dv01_long,
           coalesce(sum(c.dv01) filter (where c.qty < 0), 0)     as dv01_short,
           sum(abs(c.mv_rub))                                    as mv_rub
      from canon c join ref.rating_scale s on s.grade = c.grade
     group by s.adv01_bucket, s.adv01_coef
)
select bucket, coef, positions, issuer_level_ratings, dv01_long, dv01_short,
       dv01_long - dv01_short                      as net_dv01,
       (dv01_long - dv01_short) * coef             as adv01,
       mv_rub,
       mv_rub / nullif(sum(mv_rub) over (), 0) * 100 as mv_share_pct,
       sum((dv01_long - dv01_short) * coef) over ()  as adv01_total
  from buckets
 order by order_key;
