-- q10. История и миграции рейтингов: для каждого рейтингового объекта (выпуск/эмитент × агентство)
-- сравнение с предыдущим действием — upgrade/downgrade/affirm, ступени, дни между действиями.
-- Конструкции: оконная функция LAG с именованным окном (PARTITION BY … ORDER BY), JOIN со шкалой,
-- LEFT JOIN, подзапрос IN, CASE. Параметр :issuer_id = NULL — все эмитенты.
-- Параметры: :issuer_id, :lim (сколько последних действий вернуть)
with r as (
    select r.rating_id, r.agency_id, a.code as agency, r.issuer_id, r.bond_id, r.grade, s.score,
           r.outlook, r.action, r.assigned_on, r.status, r.source,
           lag(r.grade)       over w as prev_grade,
           lag(s.score)       over w as prev_score,
           lag(r.assigned_on) over w as prev_date
      from ref.credit_rating r
      join ref.rating_agency a on a.agency_id = r.agency_id
      join ref.rating_scale  s on s.grade = r.grade
     where cast(:issuer_id as bigint) is null
        or r.issuer_id = cast(:issuer_id as bigint)
        or r.bond_id in (select bond_id from ref.bond where issuer_id = cast(:issuer_id as bigint))
    window w as (partition by r.agency_id, coalesce(r.bond_id, 0), coalesce(r.issuer_id, 0)
                 order by r.assigned_on, r.rating_id)
)
select r.rating_id, r.agency, r.issuer_id, coalesce(i.name, bi.name) as issuer_name,
       r.bond_id, b.short_name as bond_name,
       case when r.bond_id is not null then 'issue' else 'issuer' end as scope,
       r.grade, r.prev_grade, r.outlook, r.action, r.assigned_on, r.prev_date, r.status, r.source,
       case when r.prev_score is null then 'initial'
            when r.score < r.prev_score then 'upgrade'
            when r.score > r.prev_score then 'downgrade'
            else 'affirm' end as migration,
       r.prev_score - r.score            as notches,
       r.assigned_on - r.prev_date       as days_since_prev
  from r
  left join ref.issuer i  on i.issuer_id = r.issuer_id
  left join ref.bond   b  on b.bond_id = r.bond_id
  left join ref.issuer bi on bi.issuer_id = b.issuer_id
 order by r.assigned_on desc, r.rating_id desc
 limit :lim;
