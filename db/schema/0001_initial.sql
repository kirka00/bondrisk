-- =====================================================================
--  bondrisk — схема v1 (до миграций: обычные таблицы, без флоутеров/оферт)
--  Схемы: ref (справочники), ops (операции), ts (временные ряды),
--         risk (риск), audit (журнал), stg (staging загрузчика)
-- =====================================================================

-- ---------- перечисления ----------
create type ref.coupon_type   as enum ('fixed', 'floating', 'zero');
create type ref.flow_type     as enum ('coupon', 'amortization', 'redemption', 'offer');
create type ref.bond_status   as enum ('trading', 'matured', 'defaulted', 'suspended');
create type ref.rating_status as enum ('active', 'superseded', 'withdrawn');
create type ref.rating_action as enum ('assigned', 'affirmed', 'upgraded', 'downgraded', 'withdrawn', 'other');
create type ops.user_role     as enum ('trader', 'risk_manager', 'viewer', 'admin');
create type ops.trade_side    as enum ('buy', 'sell');
create type ops.trade_status  as enum ('new', 'settled', 'cancelled');
create type ops.movement_kind as enum ('trade', 'fee', 'coupon', 'redemption', 'deposit', 'withdrawal', 'fx');
create type ops.portfolio_status as enum ('active', 'closed');
create type risk.limit_metric as enum ('dv01', 'duration', 'var_99', 'mv_gross', 'conc_issuer', 'conc_sector',
                                       'conc_issue', 'short_mv', 'below_aaa_mv', 'fx_mv');
create type risk.limit_side   as enum ('long', 'short', 'both');
create type risk.breach_status as enum ('warning', 'breach', 'waived');
create type risk.scenario_kind as enum ('parallel', 'twist', 'fx');

-- ---------- ref: справочники ----------
create table ref.issuer (
    issuer_id        bigint generated always as identity primary key,
    name             text not null,
    short_name       text,
    inn              varchar(12) unique,
    sector           text not null default 'Прочее',
    country          char(2) not null default 'RU',
    is_sovereign     boolean not null default false,
    moex_emitter_id  integer unique,
    created_at       timestamptz not null default now(),
    constraint issuer_inn_digits check (inn is null or inn ~ '^\d{10}(\d{2})?$')
);
comment on table ref.issuer is 'Эмитент облигаций (суверен, субъект РФ, компания, банк)';

create table ref.bond (
    bond_id            bigint generated always as identity primary key,
    isin               char(12) not null unique,
    secid              text not null unique,
    issuer_id          bigint not null references ref.issuer on delete restrict,
    short_name         text not null,
    full_name          text,
    currency           char(3) not null default 'RUB',
    face_value_initial numeric(18,4) not null,
    coupon_type        ref.coupon_type not null default 'fixed',
    coupon_rate_pct    numeric(9,4),
    coupon_freq        smallint not null default 2,
    issue_date         date,
    maturity_date      date not null,
    is_amortizing      boolean not null default false,
    board              text not null default 'TQCB',
    list_level         smallint,
    status             ref.bond_status not null default 'trading',
    created_at         timestamptz not null default now(),
    constraint bond_face_positive   check (face_value_initial > 0),
    constraint bond_isin_format     check (isin ~ '^[A-Z]{2}[A-Z0-9]{9}\d$'),
    constraint bond_coupon_freq     check (coupon_freq in (0, 1, 2, 3, 4, 6, 12)),
    constraint bond_coupon_rate     check (coupon_rate_pct is null or coupon_rate_pct >= 0),
    constraint bond_zero_has_no_rate check (coupon_type <> 'zero' or coalesce(coupon_rate_pct, 0) = 0),
    constraint bond_dates           check (issue_date is null or maturity_date > issue_date),
    constraint bond_list_level      check (list_level is null or list_level between 1 and 3)
);
comment on table ref.bond is 'Выпуск облигации; цены в % от номинала, номинал — в валюте выпуска';

create table ref.cash_flow_schedule (
    flow_id          bigint generated always as identity primary key,
    bond_id          bigint not null references ref.bond on delete cascade,
    flow_type        ref.flow_type not null,
    period           daterange,                     -- купонный период [start, end)
    pay_date         date not null,
    rate_pct         numeric(9,4),                  -- ставка купона периода
    amount           numeric(18,6),                 -- на одну бумагу, в валюте выпуска
    face_value_after numeric(18,4),                 -- остаток номинала после амортизации
    source           text not null default 'moex',
    constraint cfs_amount_nonneg   check (amount is null or amount >= 0),
    constraint cfs_coupon_period   check (flow_type <> 'coupon' or period is not null),
    constraint cfs_unique_flow     unique (bond_id, flow_type, pay_date),
    -- купонные периоды одного выпуска не пересекаются (btree_gist)
    constraint cfs_coupon_no_overlap exclude using gist (bond_id with =, period with &&) where (flow_type = 'coupon')
);
comment on table ref.cash_flow_schedule is 'График платежей: купоны, частичные погашения, погашение, оферты';

create table ref.rating_agency (
    agency_id  smallint primary key,
    code       text not null unique,
    name       text not null,
    priority   smallint not null unique                 -- 1 — старший источник канонического рейтинга
);

create table ref.rating_scale (
    grade        text primary key,                      -- AAA … D, SD, NR
    score        smallint not null unique,              -- AAA = 1 … D = 22
    adv01_bucket text not null,
    adv01_coef   numeric(4,2) not null check (adv01_coef > 0)
);

create table ref.credit_rating (
    rating_id    bigint generated always as identity primary key,
    agency_id    smallint not null references ref.rating_agency on delete restrict,
    issuer_id    bigint references ref.issuer on delete cascade,
    bond_id      bigint references ref.bond on delete cascade,
    grade        text not null references ref.rating_scale on delete restrict,
    outlook      text,
    action       ref.rating_action not null default 'assigned',
    assigned_on  date not null,
    status       ref.rating_status not null default 'active',
    source       text not null default 'agency',        -- agency | synthetic
    source_url   text,
    created_at   timestamptz not null default now(),
    constraint rating_object check ((issuer_id is null) <> (bond_id is null))  -- ровно один объект
);
comment on table ref.credit_rating is 'Рейтинг выпуска (bond_id) или эмитента (issuer_id); история через status';
create unique index rating_one_active_per_agency
    on ref.credit_rating (agency_id, coalesce(bond_id, 0), coalesce(issuer_id, 0)) where status = 'active';
create index rating_issuer_idx on ref.credit_rating (issuer_id, assigned_on);
create index rating_bond_idx   on ref.credit_rating (bond_id, assigned_on);

-- ---------- ops: пользователи, портфели, сделки ----------
create table ops.app_user (
    user_id       bigint generated always as identity primary key,
    login         text not null unique,
    full_name     text not null,
    role          ops.user_role not null default 'viewer',
    password_hash text,
    is_active     boolean not null default true,
    created_at    timestamptz not null default now()
);

create table ops.portfolio (
    portfolio_id  bigint generated always as identity primary key,
    code          text not null unique,
    name          text not null,
    base_currency char(3) not null default 'RUB',
    manager_id    bigint not null references ops.app_user on delete restrict,
    allow_short   boolean not null default false,
    status        ops.portfolio_status not null default 'active',
    created_at    timestamptz not null default now()
);

create table ops.cash_account (
    cash_account_id bigint generated always as identity primary key,
    portfolio_id    bigint not null references ops.portfolio on delete cascade,
    currency        char(3) not null,
    balance         numeric(20,2) not null default 0,
    allow_overdraft boolean not null default false,
    constraint cash_unique_currency unique (portfolio_id, currency),
    constraint cash_no_negative check (balance >= 0 or allow_overdraft)
);

create table ops.trade (
    trade_id           bigint generated always as identity primary key,
    portfolio_id       bigint not null references ops.portfolio on delete restrict,
    bond_id            bigint not null references ref.bond on delete restrict,
    trade_date         date not null,
    trade_ts           timestamptz not null default now(),
    settlement_date    date not null,
    side               ops.trade_side not null,
    qty                bigint not null,
    clean_price_pct    numeric(12,6) not null,
    accrued_interest   numeric(18,6) not null default 0,   -- НКД на одну бумагу
    fee                numeric(18,2) not null default 0,
    counterparty       text,
    status             ops.trade_status not null default 'settled',
    created_by         bigint references ops.app_user on delete set null,
    created_at         timestamptz not null default now(),
    constraint trade_qty_positive    check (qty > 0),
    constraint trade_price_positive  check (clean_price_pct > 0),
    constraint trade_ai_nonneg       check (accrued_interest >= 0),
    constraint trade_fee_nonneg      check (fee >= 0),
    constraint trade_settlement      check (settlement_date >= trade_date and settlement_date <= trade_date + 10)
);
create index trade_portfolio_ts_idx on ops.trade (portfolio_id, trade_ts desc, trade_id desc);
create index trade_bond_idx        on ops.trade (bond_id, trade_date);

create table ops.position (
    portfolio_id        bigint not null references ops.portfolio on delete cascade,
    bond_id             bigint not null references ref.bond on delete restrict,
    qty                 bigint not null default 0,
    avg_clean_price_pct numeric(12,6),                 -- средняя чистая цена покупки
    cost_basis          numeric(20,2) not null default 0, -- уплачено (чистая), валюта выпуска
    updated_at          timestamptz not null default now(),
    primary key (portfolio_id, bond_id)
);
comment on table ops.position is 'Текущая позиция = Σ сделок; ведётся триггером, обоснованная денормализация';

create table ops.cash_movement (
    movement_id     bigint generated always as identity primary key,
    cash_account_id bigint not null references ops.cash_account on delete cascade,
    trade_id        bigint references ops.trade on delete restrict,
    kind            ops.movement_kind not null,
    amount          numeric(20,2) not null,
    value_date      date not null default current_date,
    note            text,
    created_at      timestamptz not null default now()
);
create index cash_movement_acc_idx on ops.cash_movement (cash_account_id, value_date);

-- ---------- ts: временные ряды (v1 — обычные таблицы, в миграции 0003 → hypertables) ----------
create table ts.price_history (
    ts               date not null,
    bond_id          bigint not null references ref.bond on delete restrict,
    close_pct        double precision,
    yield_close      double precision,
    duration_days    integer,
    volume           numeric(20,2),
    accrued_interest double precision,
    face_value       double precision,
    source           text not null default 'moex',
    primary key (bond_id, ts),
    constraint price_positive check (close_pct is null or close_pct > 0)
);
comment on table ts.price_history is 'Дневные цены закрытия (в % от номинала), доходность и дюрация биржи, НКД';

create table ts.fx_rate (
    ts       date not null,
    currency char(3) not null,
    rate_rub double precision not null check (rate_rub > 0),
    source   text not null default 'cbr',
    primary key (currency, ts)
);

create table ts.yield_curve (
    ts          date not null,
    tenor_years double precision not null check (tenor_years > 0),
    rate_pct    double precision not null,
    primary key (ts, tenor_years)
);
comment on table ts.yield_curve is 'Кривая бескупонной доходности Московской биржи (КБД), спот-ставки по срокам';

-- ---------- risk ----------
create table risk.risk_limit (
    limit_id        bigint generated always as identity primary key,
    portfolio_id    bigint not null references ops.portfolio on delete cascade,
    metric          risk.limit_metric not null,
    scope_issuer_id bigint references ref.issuer on delete cascade,
    scope_bond_id   bigint references ref.bond on delete cascade,
    scope_sector    text,
    side            risk.limit_side not null default 'both',
    threshold_abs   numeric(20,2),
    threshold_pct   numeric(7,4),
    warning_pct     numeric(5,2) not null default 80,
    valid_from      date not null default current_date,
    valid_to        date,
    is_hard         boolean not null default true,        -- жёсткий лимит блокирует сделку
    created_by      bigint references ops.app_user on delete set null,
    created_at      timestamptz not null default now(),
    constraint limit_threshold_present check (threshold_abs is not null or threshold_pct is not null),
    constraint limit_warning_range     check (warning_pct > 0 and warning_pct < 100),
    constraint limit_validity          check (valid_to is null or valid_to >= valid_from),
    constraint limit_scope_matches_metric check (
        (metric = 'conc_issuer' and scope_issuer_id is not null) or
        (metric = 'conc_issue'  and scope_bond_id   is not null) or
        (metric = 'conc_sector' and scope_sector    is not null) or
        (metric not in ('conc_issuer', 'conc_issue', 'conc_sector')
            and scope_issuer_id is null and scope_bond_id is null and scope_sector is null)
    )
);

create table risk.limit_breach (
    breach_id       bigint generated always as identity primary key,
    limit_id        bigint not null references risk.risk_limit on delete cascade,
    as_of           date not null,
    fact_value      numeric(20,4) not null,
    limit_value     numeric(20,4) not null,
    utilization_pct numeric(8,2) not null,
    status          risk.breach_status not null,
    waived_by       bigint references ops.app_user on delete set null,
    waived_at       timestamptz,
    waive_reason    text,
    created_at      timestamptz not null default now(),
    constraint breach_unique_day unique (limit_id, as_of),
    constraint breach_waive_consistent check (
        (status = 'waived') = (waived_by is not null and waived_at is not null and waive_reason is not null)
    )
);

create table risk.stress_scenario (
    scenario_id   smallint generated always as identity primary key,
    code          text not null unique,
    name          text not null,
    kind          risk.scenario_kind not null,
    shift_bp      numeric(8,2),
    pivot_years   numeric(5,2),
    amplitude_bp  numeric(8,2),
    fx_currency   char(3),
    fx_change_pct numeric(8,4),
    constraint scenario_params check (
        (kind = 'parallel' and shift_bp is not null) or
        (kind = 'twist' and pivot_years is not null and amplitude_bp is not null) or
        (kind = 'fx' and fx_currency is not null and fx_change_pct is not null)
    )
);

create table risk.risk_snapshot (
    as_of            date not null,
    portfolio_id     bigint not null references ops.portfolio on delete cascade,
    mv_net           numeric(20,2) not null,
    mv_gross         numeric(20,2) not null,
    cash_total_rub   numeric(20,2) not null default 0,
    dv01             numeric(20,2) not null,
    cs01             numeric(20,2) not null,
    adv01            numeric(20,2) not null,
    duration_mac     double precision,
    duration_mod     double precision,
    convexity        double precision,
    ytm_avg          double precision,
    current_yield_avg double precision,
    g_spread_avg_bp  double precision,
    var_99_1d        numeric(20,2) not null,
    rating_score     double precision,
    rating_grade     text,
    positions_count  integer not null,
    computed_at      timestamptz not null default now(),
    primary key (portfolio_id, as_of)
);

create table risk.position_snapshot (
    as_of            date not null,
    portfolio_id     bigint not null references ops.portfolio on delete cascade,
    bond_id          bigint not null references ref.bond on delete restrict,
    qty              bigint not null,
    clean_price_pct  double precision,
    price_date       date,
    accrued_interest double precision,
    fx_rate          double precision,
    mv_rub           numeric(20,2) not null,
    ytm_pct          double precision,
    duration_mac     double precision,
    duration_mod     double precision,
    convexity        double precision,
    dv01             numeric(20,2) not null,
    g_spread_bp      double precision,
    rating_grade     text,
    rating_source    text,
    primary key (portfolio_id, bond_id, as_of)
);

-- ---------- audit ----------
create table audit.audit_log (
    audit_id    bigint generated always as identity primary key,
    table_name  text not null,
    op          text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
    row_pk      text,
    old_data    jsonb,
    new_data    jsonb,
    db_user     text not null default current_user,
    app_user_id bigint,
    changed_at  timestamptz not null default now()
);
create index audit_table_time_idx on audit.audit_log (table_name, changed_at desc);

-- ---------- stg ----------
create table stg.load_run (
    run_id      bigint generated always as identity primary key,
    source      text not null,
    params      jsonb,
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    rows_ok     integer not null default 0,
    rows_failed integer not null default 0
);
create table stg.load_error (
    error_id   bigint generated always as identity primary key,
    run_id     bigint references stg.load_run on delete cascade,
    source     text not null,
    payload    jsonb,
    reason     text not null,
    created_at timestamptz not null default now()
);
create table stg.price_history (
    secid text, ts date, close_pct double precision, yield_close double precision, duration_days integer,
    volume numeric(20,2), accrued_interest double precision, face_value double precision
);

-- ---------- права ролей на созданные объекты ----------
grant select, insert, update, delete on all tables in schema ref, ops, ts, risk, audit, stg to app_rw;
grant usage, select on all sequences in schema ref, ops, ts, risk, audit, stg to app_rw;
grant select on all tables in schema ref, ops, ts, risk to app_ro;
