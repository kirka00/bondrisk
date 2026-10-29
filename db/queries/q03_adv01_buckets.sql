-- q03. Комплексный отчёт: ADV01 по рейтинговым бакетам (методология §14–§15).
-- Этапы: 1) позиции последнего снапшота; 2) рейтинг выпуска по приоритету агентств (ROW_NUMBER);
-- 3) рейтинг эмитента аналогично; 4) канонический рейтинг: выпуск → эмитент (помечается) → ОФЗ = AAA → NR;
-- 5) бакеты шкалы: DV01 длинных/коротких, нетто × коэффициент.
-- Конструкции: многоэтапный CTE, LEFT JOIN, ROW_NUMBER() OVER (PARTITION BY), COALESCE/CASE, FILTER, SUM() OVER ().
-- Параметры: :portfolio_id, :as_of
with snap as (
    select max(as_of) as as_of from risk.position_snapshot
     where portfolio_id = :portfolio_id and as_of <= cast(:as_of as date)
),
pos as (
    select ps.bond_id, ps.qty, ps.dv01, ps.mv_rub, b.issuer_id, i.is_sovereign
      from risk.position_snapshot ps
      join snap on snap.as_of = ps.as_of
      join ref.bond b on b.bond_id = ps.bond_id
      join ref.issuer i on i.issuer_id = b.issuer_id
     where ps.portfolio_id = :portfolio_id
),
issue_r as (
    select r.bond_id, r.grade, a.code,
           row_number() over (partition by r.bond_id order by a.priority, r.assigned_on desc) as rn
      from ref.credit_rating r join ref.rating_agency a on a.agency_id = r.agency_id
     where r.status = 'active' and r.bond_id is not null
),
issuer_r as (
    select r.issuer_id, r.grade, a.code,
           row_number() over (partition by r.issuer_id order by a.priority, r.assigned_on desc) as rn
      from ref.credit_rating r join ref.rating_agency a on a.agency_id = r.agency_id
     where r.status = 'active' and r.issuer_id is not null
),
canon as (
    select p.*,
           coalesce(ir.grade, sr.grade, case when p.is_sovereign then 'AAA' end, 'NR') as grade,
           case when ir.grade is not null then 'issue'
                when sr.grade is not null then 'issuer'
                when p.is_sovereign then 'sovereign' else 'none' end as rating_source
      from pos p
      left join issue_r  ir on ir.bond_id = p.bond_id and ir.rn = 1
      left join issuer_r sr on sr.issuer_id = p.issuer_id and sr.rn = 1
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
