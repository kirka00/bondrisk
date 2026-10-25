-- Выполняется один раз при создании пустой базы (docker-entrypoint-initdb.d).
create extension if not exists timescaledb;
create extension if not exists btree_gist;   -- EXCLUDE по диапазонам (купонные периоды)

create schema if not exists ref;    -- справочники: эмитенты, выпуски, графики, рейтинги
create schema if not exists ops;    -- портфели, сделки, позиции, касса
create schema if not exists ts;     -- временные ряды (hypertables): цены, курсы, КБД
create schema if not exists risk;   -- лимиты, снапшоты, сценарии
create schema if not exists audit;  -- журнал изменений
create schema if not exists stg;    -- staging загрузчика

-- Роли приложения с минимальными привилегиями (ТЗ §7). Пароли — только для dev-compose,
-- в продакшене задаются через ALTER ROLE из секрета.
create role app_rw login password 'app_rw';
create role app_ro login password 'app_ro';
grant usage on schema ref, ops, ts, risk, audit, stg to app_rw;
grant usage on schema ref, ops, ts, risk to app_ro;
alter default privileges in schema ref, ops, ts, risk, audit, stg
    grant select, insert, update, delete on tables to app_rw;
alter default privileges in schema ref, ops, ts, risk, audit, stg
    grant usage, select on sequences to app_rw;
alter default privileges in schema ref, ops, ts, risk, audit, stg
    grant execute on functions to app_rw;
alter default privileges in schema ref, ops, ts, risk grant select on tables to app_ro;
