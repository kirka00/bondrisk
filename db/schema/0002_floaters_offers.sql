-- Миграция 0002: изменение требований — поддержка флоутеров и оферт (пут-опционов).
-- Структура меняется ALTER'ами, данные сохраняются.
alter table ref.bond add column offer_date date;
alter table ref.bond add constraint bond_offer_before_maturity
    check (offer_date is null or offer_date < maturity_date);

create table ref.floater_terms (                      -- связь 1:1 с ref.bond
    bond_id             bigint primary key references ref.bond on delete cascade,
    reference_rate      text not null,                -- KEY_RATE | RUONIA | RUSFAR
    spread_bp           numeric(9,2),
    reset_period_months smallint not null default 3 check (reset_period_months in (1, 3, 6, 12)),
    note                text
);
comment on table ref.floater_terms is 'Параметры плавающего купона; существует только для coupon_type = floating';

-- обратная связь: у флоутера должны быть условия, у остальных — нет (проверяется триггером позже)
grant select, insert, update, delete on ref.floater_terms to app_rw;
grant select on ref.floater_terms to app_ro;
