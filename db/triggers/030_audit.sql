-- =====================================================================
--  Аудит: кто, когда, какую операцию, старые и новые данные (jsonb).
--  Пользователь приложения передаётся через set_config('bondrisk.user_id', ...).
-- =====================================================================
create or replace function audit.log_changes() returns trigger
language plpgsql as $$
declare v_pk text; v_user bigint;
begin
    v_user := nullif(current_setting('bondrisk.user_id', true), '')::bigint;
    if tg_op = 'DELETE' then
        v_pk := (to_jsonb(old) ->> tg_argv[0]);
        insert into audit.audit_log (table_name, op, row_pk, old_data, app_user_id)
            values (tg_table_schema || '.' || tg_table_name, tg_op, v_pk, to_jsonb(old), v_user);
        return old;
    elsif tg_op = 'UPDATE' then
        v_pk := (to_jsonb(new) ->> tg_argv[0]);
        insert into audit.audit_log (table_name, op, row_pk, old_data, new_data, app_user_id)
            values (tg_table_schema || '.' || tg_table_name, tg_op, v_pk, to_jsonb(old), to_jsonb(new), v_user);
    else
        v_pk := (to_jsonb(new) ->> tg_argv[0]);
        insert into audit.audit_log (table_name, op, row_pk, new_data, app_user_id)
            values (tg_table_schema || '.' || tg_table_name, tg_op, v_pk, to_jsonb(new), v_user);
    end if;
    return new;
end $$;

create trigger audit_trade        after insert or update or delete on ops.trade
    for each row execute function audit.log_changes('trade_id');
create trigger audit_risk_limit   after insert or update or delete on risk.risk_limit
    for each row execute function audit.log_changes('limit_id');
create trigger audit_limit_breach after insert or update or delete on risk.limit_breach
    for each row execute function audit.log_changes('breach_id');
create trigger audit_portfolio    after insert or update or delete on ops.portfolio
    for each row execute function audit.log_changes('portfolio_id');
create trigger audit_credit_rating after insert or update or delete on ref.credit_rating
    for each row execute function audit.log_changes('rating_id');
