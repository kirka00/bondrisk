-- Миграция 0012: приведение к методологии риск-дашборда (ред. 25.10.2026).
--  * ref.bond.issue_size — объём выпуска в штуках: доля портфеля в объёме эмиссии (§16.2);
--  * risk.price_override — ручные корректировки цены, НКД и номинала исторических срезов (§3, §19);
--  * risk.cash_adjustment — ручная корректировка кассы: целевой остаток на дату или единый сдвиг (§2);
--  * ref.name_synonym — синонимы эмитентов и отраслей книги лимитов (§16.2);
--  * книга лимитной политики: база оценки, база процента, доля эмиссии, лимит по названию эмитента,
--    комитет и порог самостоятельной корректировки, минимальный рейтинг новых эмитентов (§16.2);
--  * исторические стресс-сценарии: эпизод, горизонт, окно дат, изменение фактора, β (§13);
--  * ts.index_value — индексы MOEX (гособлигации, акции) и RUSFAR CNY для сценариев и carry (§13, §22);
--  * снапшоты: дисконтная маржа флоутеров и источник цены (§3, §8, §11).

alter table ref.bond add column if not exists issue_size bigint;
alter table ref.bond drop constraint if exists bond_issue_size;
alter table ref.bond add constraint bond_issue_size check (issue_size is null or issue_size > 0);

create table if not exists risk.price_override (
    bond_id          bigint not null references ref.bond on delete cascade,
    as_of            date not null,
    clean_price_pct  numeric(12,6),
    accrued_interest numeric(18,6),
    face_value       numeric(18,4),
    reason           text not null,
    created_by       bigint references ops.app_user on delete set null,
    created_at       timestamptz not null default now(),
    primary key (bond_id, as_of),
    constraint override_present check (num_nonnulls(clean_price_pct, accrued_interest, face_value) > 0),
    constraint override_values  check (coalesce(clean_price_pct, 1) > 0 and coalesce(accrued_interest, 0) >= 0
                                       and coalesce(face_value, 1) > 0),
    constraint override_reason  check (length(trim(reason)) >= 3)
);
comment on table risk.price_override is 'Ручные корректировки риск-менеджмента для исторических срезов (методология §3, §19)';

create table if not exists risk.cash_adjustment (
    adjustment_id  bigint generated always as identity primary key,
    portfolio_id   bigint not null references ops.portfolio on delete cascade,
    currency       char(3) not null,
    as_of          date,                       -- null — единый сдвиг ко всем историческим срезам
    target_balance numeric(20,2),
    shift          numeric(20,2),
    reason         text not null,
    created_by     bigint references ops.app_user on delete set null,
    created_at     timestamptz not null default now(),
    constraint cash_adj_currency check (currency in ('RUB', 'USD', 'EUR', 'CNY', 'GBP')),
    constraint cash_adj_kind check ((as_of is not null and target_balance is not null and shift is null)
                                 or (as_of is null and shift is not null and target_balance is null)),
    constraint cash_adj_reason check (length(trim(reason)) >= 3),
    constraint cash_adj_unique unique nulls not distinct (portfolio_id, currency, as_of)
);
comment on table risk.cash_adjustment is 'Ручная корректировка кассы (§2): целевой остаток на дату или единый сдвиг по валюте';

create table if not exists ref.name_synonym (
    kind      text not null,
    alias     text not null,
    canonical text not null,
    primary key (kind, alias),
    constraint synonym_kind check (kind in ('issuer', 'sector'))
);
comment on table ref.name_synonym is 'Синонимы книги лимитов (§16.2): alias и canonical хранятся нормализованными (ref.norm_name)';

-- книга лимитной политики (§16.2)
alter table risk.risk_limit
    add column if not exists basis              text not null default 'cost',
    add column if not exists pct_base           text not null default 'gross',
    add column if not exists emission_share_pct numeric(7,4),
    add column if not exists scope_name         text,
    add column if not exists committee          text,
    add column if not exists self_adjust_pct    numeric(7,2),
    add column if not exists min_grade          text references ref.rating_scale (grade) on delete restrict;
alter table risk.risk_limit
    drop constraint if exists limit_threshold_present,
    drop constraint if exists limit_scope_matches_metric,
    drop constraint if exists limit_basis, drop constraint if exists limit_pct_base,
    drop constraint if exists limit_emission_share, drop constraint if exists limit_committee,
    drop constraint if exists limit_min_grade;
alter table risk.risk_limit
    add constraint limit_basis    check (basis in ('cost', 'market', 'max')),
    add constraint limit_pct_base check (pct_base in ('gross', 'total_limit')),
    add constraint limit_emission_share check (emission_share_pct is null
                                               or (metric = 'conc_issue' and emission_share_pct > 0 and emission_share_pct <= 100)),
    add constraint limit_committee check ((committee is null or committee in ('IC', 'RC'))
                                          and (self_adjust_pct is null or (committee is not null and self_adjust_pct > 0))),
    add constraint limit_min_grade check ((metric = 'new_issuer_rating') = (min_grade is not null)),
    add constraint limit_threshold_present check (threshold_abs is not null or threshold_pct is not null
                                                  or emission_share_pct is not null or metric = 'new_issuer_rating'),
    add constraint limit_scope_matches_metric check (
        (metric = 'conc_issuer' and (scope_issuer_id is not null or scope_name is not null)
            and scope_bond_id is null and scope_sector is null) or
        (metric = 'conc_issue'  and scope_bond_id is not null and scope_issuer_id is null
            and scope_sector is null and scope_name is null) or
        (metric = 'conc_sector' and scope_sector is not null and scope_issuer_id is null
            and scope_bond_id is null and scope_name is null) or
        (metric not in ('conc_issuer', 'conc_issue', 'conc_sector')
            and scope_issuer_id is null and scope_bond_id is null and scope_sector is null and scope_name is null));
comment on column risk.risk_limit.basis is 'База оценки позиции против лимита концентрации: цена покупки (по умолчанию), рынок или большая из двух';
comment on column risk.risk_limit.pct_base is 'База процентного лимита: брутто-стоимость портфеля или общий лимит на портфель (conc_portfolio)';
comment on column risk.risk_limit.self_adjust_pct is 'Порог самостоятельной корректировки лимита комитета, %: сверх него — согласование совета директоров (admin)';

-- сверх порога самостоятельной корректировки лимит комитета меняет только администратор (совет директоров)
create or replace function risk.trg_limit_committee() returns trigger
language plpgsql as $$
declare
    v_old double precision := coalesce(old.threshold_abs, old.threshold_pct);
    v_new double precision := coalesce(new.threshold_abs, new.threshold_pct);
    v_user bigint := nullif(current_setting('bondrisk.user_id', true), '')::bigint;
begin
    if old.committee is not null and old.self_adjust_pct is not null and v_old > 0 and v_new is not null
       and abs(v_new - v_old) / v_old * 100 > old.self_adjust_pct
       and not exists (select 1 from ops.app_user where user_id = v_user and role = 'admin') then
        raise exception 'limit % change %%% exceeds self-adjust threshold %%%: board approval required',
              old.limit_id, round((abs(v_new - v_old) / v_old * 100)::numeric, 2), old.self_adjust_pct
            using errcode = 'BR005';
    end if;
    return new;
end $$;
create or replace trigger risk_limit_committee before update on risk.risk_limit
    for each row execute function risk.trg_limit_committee();

-- исторические стресс-сценарии (§13)
alter table risk.stress_scenario
    add column if not exists episode      text,
    add column if not exists horizon_days smallint,
    add column if not exists date_from    date,
    add column if not exists date_to      date,
    add column if not exists change_pct   numeric(10,4),
    add column if not exists beta         numeric(6,3);
alter table risk.stress_scenario drop constraint if exists scenario_params;
alter table risk.stress_scenario add constraint scenario_params check (
    (kind = 'parallel' and shift_bp is not null) or
    (kind = 'twist' and pivot_years is not null and amplitude_bp is not null) or
    (kind = 'fx' and fx_currency is not null and fx_change_pct is not null) or
    (kind = 'fx_hist' and fx_currency is not null and change_pct is not null and date_to > date_from) or
    (kind = 'ofz_index' and change_pct is not null and date_to > date_from) or
    (kind = 'equity_index' and change_pct is not null and beta is not null and date_to > date_from));

-- индексы MOEX и ставка RUSFAR CNY (§13, §22)
create table if not exists ts.index_value (
    index_code text not null,
    ts         date not null,
    value      double precision not null,
    primary key (index_code, ts)
);
comment on table ts.index_value is 'Значения индексов MOEX (RGBITR, IMOEX) и ставки RUSFAR CNY на дату';

-- снапшоты: дисконтная маржа флоутеров (§8, §11), источник цены (§3)
alter table risk.position_snapshot add column if not exists dm_bp double precision;
alter table risk.position_snapshot add column if not exists price_source text;
alter table risk.risk_snapshot add column if not exists dm_avg_bp double precision;
alter table risk.risk_snapshot add column if not exists floater_share_pct double precision;

grant select, insert, update, delete on risk.price_override, risk.cash_adjustment, ref.name_synonym to app_rw;
grant select, insert, update, delete on ts.index_value to app_rw;
grant usage on all sequences in schema risk to app_rw;
grant select on risk.price_override, risk.cash_adjustment, ref.name_synonym, ts.index_value to app_ro;

-- ручные корректировки меняют исторические цифры — журналируются, как сделки и лимиты
create or replace trigger audit_price_override after insert or update or delete on risk.price_override
    for each row execute function audit.log_changes('bond_id');
create or replace trigger audit_cash_adjustment after insert or update or delete on risk.cash_adjustment
    for each row execute function audit.log_changes('adjustment_id');
