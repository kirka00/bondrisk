-- =====================================================================
--  0014. Журнал и производные остатки, история лимитов.
--  * ops.position, ops.cash_account.balance — производные от журналов ops.trade и ops.cash_movement:
--    роль приложения пишет в них только через процедуры учёта (SECURITY DEFINER), прямой записи нет;
--    ops.ledger_discrepancies() сверяет остатки с журналами.
--  * сделка проводится один раз при вставке, отмена — встречной сделкой: статус всегда 'settled'.
--  * лимит — цепочка редакций с общим origin_id (SCD2): изменение условий закрывает действующую редакцию
--    датой вступления новой, период [valid_from, valid_to), редакции одного правила не пересекаются.
-- =====================================================================

-- ---------- журнал сделок и кассы ----------
alter table ops.trade drop constraint if exists trade_status_settled;
alter table ops.trade add constraint trade_status_settled check (status = 'settled');
comment on column ops.trade.status is
    'Всегда settled: позиция и касса проводятся при вставке, сделка неизменяема, отмена — встречной сделкой';

revoke insert, update, delete, truncate on ops.position, ops.cash_account, ops.cash_movement from app_rw;

comment on table ops.cash_account is
    'Счёт портфеля; balance = Σ ops.cash_movement.amount, ведётся процедурами учёта (обоснованная денормализация)';

-- Сверка производных остатков с журналами: пустой результат — остатки согласованы.
create or replace function ops.ledger_discrepancies(p_portfolio_id bigint default null)
returns table (portfolio_id bigint, kind text, object_id bigint, stored numeric, expected numeric)
language sql stable as $$
    with p as (select x.portfolio_id, x.bond_id, x.qty from ops.position x
                where p_portfolio_id is null or x.portfolio_id = p_portfolio_id),
         t as (select x.portfolio_id, x.bond_id, sum(case when x.side = 'buy' then x.qty else -x.qty end) as qty
                 from ops.trade x
                where p_portfolio_id is null or x.portfolio_id = p_portfolio_id
                group by 1, 2),
         a as (select x.cash_account_id, x.portfolio_id, x.balance from ops.cash_account x
                where p_portfolio_id is null or x.portfolio_id = p_portfolio_id),
         m as (select x.cash_account_id, sum(x.amount) as amount from ops.cash_movement x group by 1),
         tm as (select x.trade_id, count(*) as n from ops.cash_movement x
                 where x.trade_id is not null and x.kind = 'trade' group by 1)
    -- позиция = Σ сделок со знаком
    select coalesce(p.portfolio_id, t.portfolio_id), 'position', coalesce(p.bond_id, t.bond_id),
           p.qty::numeric, coalesce(t.qty, 0)::numeric
      from p full join t on t.portfolio_id = p.portfolio_id and t.bond_id = p.bond_id
     where coalesce(p.qty, 0) <> coalesce(t.qty, 0)
    union all
    -- остаток счёта = Σ движений
    select a.portfolio_id, 'cash', a.cash_account_id, a.balance, coalesce(m.amount, 0)
      from a left join m on m.cash_account_id = a.cash_account_id
     where a.balance <> coalesce(m.amount, 0)
    union all
    -- у каждой сделки ровно одна денежная нога
    select x.portfolio_id, 'trade_leg', x.trade_id, coalesce(tm.n, 0), 1
      from ops.trade x left join tm on tm.trade_id = x.trade_id
     where (p_portfolio_id is null or x.portfolio_id = p_portfolio_id) and coalesce(tm.n, 0) <> 1
$$;
comment on function ops.ledger_discrepancies(bigint) is
    'Сверка: позиция = Σ сделок, остаток = Σ движений, у сделки одна денежная нога; пусто — согласовано';
grant execute on function ops.ledger_discrepancies(bigint) to app_rw, app_ro;

-- Разовое исправление: до 0014 deposit_cash прибавлял к остатку неокруглённую сумму, а в движение
-- писал округлённую — остаток расходился с журналом на копейки. Источник истины — журнал.
update ops.cash_account a set balance = coalesce(m.amount, 0)
  from (select cash_account_id, sum(amount) as amount from ops.cash_movement group by 1) m
 where m.cash_account_id = a.cash_account_id and a.balance <> m.amount;

-- ---------- редакции лимитов ----------
alter table risk.risk_limit add column if not exists origin_id bigint;
update risk.risk_limit set origin_id = limit_id where origin_id is null;
alter table risk.risk_limit alter column origin_id set not null;
alter table risk.risk_limit drop constraint if exists risk_limit_origin_fkey;
alter table risk.risk_limit add constraint risk_limit_origin_fkey
    foreign key (origin_id) references risk.risk_limit (limit_id) on delete cascade;
create index if not exists risk_limit_origin_idx on risk.risk_limit (origin_id, valid_from);
comment on column risk.risk_limit.origin_id is 'Первая редакция лимита; все редакции одного правила ссылаются на неё';

create or replace function risk.trg_limit_origin() returns trigger
language plpgsql as $$
begin
    new.origin_id := coalesce(new.origin_id, new.limit_id);   -- новая цепочка начинается с себя
    return new;
end $$;
create or replace trigger risk_limit_origin before insert on risk.risk_limit
    for each row execute function risk.trg_limit_origin();

-- полуоткрытый период: valid_to — первый день, когда редакция уже не действует
alter table risk.risk_limit drop constraint if exists limit_validity;
alter table risk.risk_limit add constraint limit_validity check (valid_to is null or valid_to > valid_from);

alter table risk.risk_limit drop constraint if exists limit_no_overlap;
alter table risk.risk_limit add constraint limit_no_overlap exclude using gist (
    portfolio_id with =, metric with =, side with =,
    (coalesce(scope_issuer_id, 0)) with =, (coalesce(scope_bond_id, 0)) with =,
    (coalesce(scope_sector, '')) with =, (coalesce(lower(scope_name), '')) with =,
    daterange(valid_from, valid_to, '[)') with &&);

-- Регламент комитета (§16): изменение порога сверх самостоятельной корректировки — только admin.
-- Порог сравнивается с прежней редакцией и при правке на месте (UPDATE), и при новой редакции (INSERT).
create or replace function risk.trg_limit_committee() returns trigger
language plpgsql as $$
declare
    v_prev risk.risk_limit%rowtype;
    v_old  double precision;
    v_new  double precision := coalesce(new.threshold_abs, new.threshold_pct);
    v_user bigint := nullif(current_setting('bondrisk.user_id', true), '')::bigint;
begin
    if tg_op = 'UPDATE' then
        v_prev := old;
    else
        select * into v_prev from risk.risk_limit
         where origin_id = new.origin_id and limit_id <> new.limit_id
         order by valid_from desc limit 1;
        if not found then
            return new;
        end if;
    end if;
    v_old := coalesce(v_prev.threshold_abs, v_prev.threshold_pct);
    if v_prev.committee is not null and v_prev.self_adjust_pct is not null and v_old > 0 and v_new is not null
       and abs(v_new - v_old) / v_old * 100 > v_prev.self_adjust_pct
       and not exists (select 1 from ops.app_user where user_id = v_user and role = 'admin') then
        raise exception 'limit % change %%% exceeds self-adjust threshold %%%: board approval required',
              v_prev.limit_id, round((abs(v_new - v_old) / v_old * 100)::numeric, 2), v_prev.self_adjust_pct
            using errcode = 'BR005';
    end if;
    return new;
end $$;
create or replace trigger risk_limit_committee before insert or update on risk.risk_limit
    for each row execute function risk.trg_limit_committee();

-- Изменение лимита. Меняется только срок или редакция ещё не вступила в силу к p_effective_from —
-- правка на месте; иначе действующая редакция закрывается датой p_effective_from, и с неё действует новая.
-- Нарушения прежней редакции с даты вступления новой удаляются: следующий EOD считает их по новой.
-- Возвращает id редакции, действующей с p_effective_from.
create or replace function risk.revise_limit(p_limit_id bigint, p_changes jsonb,
                                             p_effective_from date default current_date)
returns bigint
language plpgsql as $$
declare
    v_old risk.risk_limit%rowtype;
    v_new risk.risk_limit%rowtype;
    v_id  bigint;
begin
    select * into v_old from risk.risk_limit where limit_id = p_limit_id for update;
    if not found then
        raise exception 'limit % not found', p_limit_id using errcode = 'BR404';
    end if;
    v_new := jsonb_populate_record(v_old, p_changes);

    if (to_jsonb(v_new) - 'valid_to') = (to_jsonb(v_old) - 'valid_to') or p_effective_from <= v_old.valid_from then
        update risk.risk_limit
           set side = v_new.side, threshold_abs = v_new.threshold_abs, threshold_pct = v_new.threshold_pct,
               warning_pct = v_new.warning_pct, is_hard = v_new.is_hard, valid_to = v_new.valid_to,
               basis = v_new.basis, pct_base = v_new.pct_base, emission_share_pct = v_new.emission_share_pct,
               min_grade = v_new.min_grade
         where limit_id = p_limit_id;
        return p_limit_id;
    end if;
    if v_old.valid_to is not null and p_effective_from >= v_old.valid_to then
        raise exception 'limit % is not in force on % (valid to %)', p_limit_id, p_effective_from, v_old.valid_to
            using errcode = '22023';
    end if;

    delete from risk.limit_breach where limit_id = p_limit_id and as_of >= p_effective_from;
    update risk.risk_limit set valid_to = p_effective_from where limit_id = p_limit_id;
    insert into risk.risk_limit (origin_id, portfolio_id, metric, scope_issuer_id, scope_bond_id, scope_sector,
                                 scope_name, side, threshold_abs, threshold_pct, warning_pct, is_hard,
                                 valid_from, valid_to, created_by, basis, pct_base, emission_share_pct,
                                 committee, self_adjust_pct, min_grade)
    values (v_old.origin_id, v_old.portfolio_id, v_old.metric, v_old.scope_issuer_id, v_old.scope_bond_id,
            v_old.scope_sector, v_old.scope_name, v_new.side, v_new.threshold_abs, v_new.threshold_pct,
            v_new.warning_pct, v_new.is_hard, p_effective_from, v_new.valid_to,
            coalesce(nullif(current_setting('bondrisk.user_id', true), '')::bigint, v_old.created_by),
            v_new.basis, v_new.pct_base, v_new.emission_share_pct, v_old.committee, v_old.self_adjust_pct,
            v_new.min_grade)
    returning limit_id into v_id;
    return v_id;
end $$;
comment on function risk.revise_limit(bigint, jsonb, date) is
    'SCD2 для лимита: новая редакция с даты вступления, прежняя закрывается; история порогов сохраняется';
