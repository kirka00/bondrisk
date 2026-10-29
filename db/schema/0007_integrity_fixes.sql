-- Миграция 0007: исправления по итогам ревью целостности.
--  * risk_limit.updated_at — момент последнего изменения лимита: снятое нарушение действует, пока лимит
--    не менялся (раньше сравнивался limit_value, который у порога в % от брутто меняется ежедневно);
--  * limit_breach.waived_status — вид нарушения на момент снятия (предупреждение/нарушение);
--  * журнал аудита — только добавление записей для роли приложения;
--  * политика обновления недельного непрерывного агрегата (раньше не было — агрегат пустовал).

alter table risk.risk_limit add column if not exists updated_at timestamptz;
update risk.risk_limit set updated_at = created_at where updated_at is null;
alter table risk.risk_limit alter column updated_at set default now(), alter column updated_at set not null;

create or replace function risk.trg_limit_touch() returns trigger
language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end $$;
create or replace trigger risk_limit_touch before update on risk.risk_limit
    for each row execute function risk.trg_limit_touch();

alter table risk.limit_breach add column if not exists waived_status risk.breach_status;
-- для уже снятых нарушений вид восстанавливается по загрузке
update risk.limit_breach set waived_status = case when utilization_pct >= 100 then 'breach' else 'warning' end::risk.breach_status
 where status = 'waived' and waived_status is null;
alter table risk.limit_breach drop constraint if exists breach_waived_status;
alter table risk.limit_breach add constraint breach_waived_status
    check ((status = 'waived') = (waived_status is not null) and waived_status is distinct from 'waived');

revoke update, delete, truncate on audit.audit_log from app_rw;

select add_continuous_aggregate_policy('ts.price_1w', start_offset => interval '3 years',
       end_offset => interval '1 day', schedule_interval => interval '1 day', if_not_exists => true);
