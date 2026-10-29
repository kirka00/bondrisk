-- =====================================================================
--  Канонический рейтинг бумаги (методология §15): действующий рейтинг выпуска по приоритету агентств
--  (при равном приоритете — более поздний), иначе действующий рейтинг эмитента (источник 'issuer',
--  в таблицах — «*»); отозваны оба — последний известный рейтинг с пометкой об отзыве (источник
--  'withdrawn'); ОФЗ и прочие суверенные без рейтинга — AAA; остальные без рейтинга — NR.
-- =====================================================================
create or replace function risk.canonical_rating(p_bond_id bigint)
returns table (grade text, score smallint, source text, agency_code text, assigned_on date)
language sql stable as $$
    with b as (select bond_id, issuer_id from ref.bond where bond_id = p_bond_id),
         iss as (select i.is_sovereign from ref.issuer i join b on b.issuer_id = i.issuer_id),
         issue_r as (
             select r.grade, a.code, r.assigned_on
               from ref.credit_rating r join ref.rating_agency a on a.agency_id = r.agency_id
              where r.bond_id = p_bond_id and r.status = 'active'
              order by a.priority, r.assigned_on desc limit 1),
         issuer_r as (
             select r.grade, a.code, r.assigned_on
               from ref.credit_rating r join ref.rating_agency a on a.agency_id = r.agency_id
               join b on b.issuer_id = r.issuer_id
              where r.status = 'active'
              order by a.priority, r.assigned_on desc limit 1),
         -- последний известный: среди отозванных и заменённых — самая поздняя запись (выпуск раньше эмитента)
         last_r as (
             select r.grade, a.code, r.assigned_on
               from ref.credit_rating r join ref.rating_agency a on a.agency_id = r.agency_id
               join b on (r.bond_id = b.bond_id or r.issuer_id = b.issuer_id)
              where r.grade not in ('NR')
                and exists (select 1 from ref.credit_rating w
                             where w.status = 'withdrawn' and (w.bond_id = b.bond_id or w.issuer_id = b.issuer_id))
              order by r.assigned_on desc, (r.bond_id is not null) desc, a.priority limit 1)
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
