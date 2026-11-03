-- =====================================================================
--  Канонический рейтинг бумаги на дату D (методология §15): действующий рейтинг выпуска по приоритету
--  агентств (при равном приоритете — более поздний), иначе действующий рейтинг эмитента (источник 'issuer',
--  в таблицах — «*»); отозваны оба — последний известный рейтинг с пометкой об отзыве (источник
--  'withdrawn'); ОФЗ и прочие суверенные без рейтинга — AAA; остальные без рейтинга — NR.
--  «Действующий на D» — последняя запись агентства по объекту с assigned_on ≤ D, если это не отзыв:
--  история берётся из самих записей, а не из текущего status, поэтому исторический EOD видит рейтинг,
--  который был на дату оценки, а не сегодняшний. Без даты — последняя известная запись (справочник).
--  История агентств загружена не полностью (АКРА и НКР отдают только последнее действие), поэтому до
--  первой загруженной записи по объекту действует она же: «рейтинга не было» мы не знаем.
-- =====================================================================
drop function if exists risk.canonical_rating(bigint);

create or replace function risk.canonical_rating(p_bond_id bigint, p_as_of date default null)
returns table (grade text, score smallint, source text, agency_code text, assigned_on date)
language sql stable as $$
    with b as (select bond_id, issuer_id from ref.bond where bond_id = p_bond_id),
         iss as (select i.is_sovereign from ref.issuer i join b on b.issuer_id = i.issuer_id),
         hist as (
             select r.rating_id, r.agency_id, r.grade, r.action, r.status, r.assigned_on, a.code, a.priority,
                    r.bond_id is not null as is_issue,
                    p_as_of is null or r.assigned_on <= p_as_of as known   -- запись уже существовала на D
               from ref.credit_rating r join ref.rating_agency a on a.agency_id = r.agency_id
               join b on (r.bond_id = b.bond_id or r.issuer_id = b.issuer_id)),
         -- по каждому агентству и объекту (выпуск / эмитент) — последняя запись на D, а если до D записей
         -- нет — первая загруженная
         cur as (
             select distinct on (agency_id, is_issue) *
               from hist
              order by agency_id, is_issue, known desc,
                       case when known then assigned_on end desc nulls last, assigned_on, rating_id desc),
         issue_r as (
             select grade, code, assigned_on from cur
              where is_issue and action <> 'withdrawn' and status <> 'withdrawn'
              order by priority, assigned_on desc limit 1),
         issuer_r as (
             select grade, code, assigned_on from cur
              where not is_issue and action <> 'withdrawn' and status <> 'withdrawn'
              order by priority, assigned_on desc limit 1),
         -- последний известный: среди отозванных и заменённых — самая поздняя запись (выпуск раньше эмитента)
         last_r as (
             select grade, code, assigned_on from hist
              where known and grade not in ('NR')
                and exists (select 1 from hist w where w.known and (w.action = 'withdrawn' or w.status = 'withdrawn'))
              order by assigned_on desc, is_issue desc, priority limit 1)
    select g.grade, s.score, g.source, g.code, g.assigned_on
      from (
          select grade, code, assigned_on, 'issue' as source, 1 as pri from issue_r
          union all
          select grade, code, assigned_on, 'issuer', 2 from issuer_r
          union all
          select grade, code, assigned_on, 'withdrawn', 3 from last_r
          union all
          select 'AAA', null, null, 'sovereign', 4 from iss where is_sovereign
          union all
          select 'NR', null, null, 'none', 5
      ) g join ref.rating_scale s on s.grade = g.grade
     order by g.pri limit 1
$$;
