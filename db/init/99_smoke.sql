-- Проверка дня 1 (план, раздел 14): hypertable на PG18 + TimescaleDB 2.31 создаётся.
-- Таблица временная для initdb-проверки; настоящая схема — в db/schema/.
create table ts._smoke (ts timestamptz not null, bond_id int not null, close_pct double precision);
select create_hypertable('ts._smoke', by_range('ts', interval '1 month'));
insert into ts._smoke values (now(), 1, 100.0), (now() - interval '40 days', 1, 99.5);
do $$
declare n int;
begin
    select count(*) into n from timescaledb_information.chunks where hypertable_name = '_smoke';
    if n <> 2 then raise exception 'ожидалось 2 чанка, получено %', n; end if;
    raise notice 'TimescaleDB OK: hypertable ts._smoke, чанков: %', n;
end $$;
drop table ts._smoke;
