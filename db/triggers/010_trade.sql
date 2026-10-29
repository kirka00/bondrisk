-- =====================================================================
--  Триггеры сделки: проверка до вставки, бухгалтерия позиции и кассы после вставки,
--  неизменяемость сделок.
-- =====================================================================
create or replace function ops.trg_trade_before_insert() returns trigger
language plpgsql as $$
declare b ref.bond%rowtype;
begin
    select * into b from ref.bond where bond_id = new.bond_id;
    -- погашенный выпуск торговался до даты погашения: исторические сделки допустимы, дату проверяет условие ниже
    if b.status not in ('trading', 'matured') then
        raise exception 'bond % is not trading (%)', b.secid, b.status using errcode = 'BR004';
    end if;
    if new.trade_date > coalesce(b.maturity_date, new.trade_date) then
        raise exception 'trade date % after maturity %', new.trade_date, b.maturity_date using errcode = 'BR004';
    end if;
    if b.issue_date is not null and new.trade_date < b.issue_date then
        raise exception 'trade date % before issue date %', new.trade_date, b.issue_date using errcode = 'BR004';
    end if;
    return new;
end $$;
create or replace trigger trade_before_insert before insert on ops.trade
    for each row execute function ops.trg_trade_before_insert();

-- Применение сделки: позиция (средняя цена, базис) и касса (нога сделки, комиссия).
create or replace function ops.trg_trade_apply() returns trigger
language plpgsql as $$
declare
    pos   ops.position%rowtype;
    v_face numeric;
    v_dq  bigint := case when new.side = 'buy' then new.qty else -new.qty end;
    v_leg numeric;
    v_acc bigint;
    v_cur char(3);
begin
    select face_value_initial, currency into v_face, v_cur from ref.bond where bond_id = new.bond_id;
    v_face := ref.face_value_at(new.bond_id, new.trade_date);
    -- нога округляется до копейки один раз: и движение, и остаток считаются от одного числа
    v_leg  := round(new.qty * (new.clean_price_pct / 100.0 * v_face + new.accrued_interest), 2);

    insert into ops.position (portfolio_id, bond_id) values (new.portfolio_id, new.bond_id)
        on conflict do nothing;
    select * into pos from ops.position
     where portfolio_id = new.portfolio_id and bond_id = new.bond_id for update;

    if (pos.qty >= 0 and new.side = 'buy') or (pos.qty <= 0 and new.side = 'sell') then
        -- наращивание позиции: средняя цена взвешивается по количеству
        update ops.position
           set avg_clean_price_pct = (coalesce(avg_clean_price_pct, 0) * abs(qty) + new.clean_price_pct * new.qty)
                                     / (abs(qty) + new.qty),
               cost_basis = cost_basis + new.qty * new.clean_price_pct / 100.0 * v_face,
               qty = qty + v_dq, updated_at = now()
         where portfolio_id = new.portfolio_id and bond_id = new.bond_id;
    else
        -- сокращение позиции: базис уменьшается пропорционально по средней цене;
        -- переворот через ноль: новая позиция с базисом по цене этой сделки
        update ops.position
           set cost_basis = case when abs(qty) > new.qty
                                 then cost_basis * (abs(qty) - new.qty) / abs(qty)
                                 else (new.qty - abs(qty)) * new.clean_price_pct / 100.0 * v_face end,
               avg_clean_price_pct = case when abs(qty) > new.qty then avg_clean_price_pct
                                          when abs(qty) = new.qty then null
                                          else new.clean_price_pct end,          -- переворот через ноль
               qty = qty + v_dq, updated_at = now()
         where portfolio_id = new.portfolio_id and bond_id = new.bond_id;
    end if;

    -- запрет короткой позиции — и для прямой вставки в ops.trade, не только через execute_trade
    if exists (select 1 from ops.position x join ops.portfolio p using (portfolio_id)
                where x.portfolio_id = new.portfolio_id and x.bond_id = new.bond_id
                  and x.qty < 0 and not p.allow_short) then
        raise exception 'short position is not allowed in this portfolio' using errcode = 'BR001';
    end if;

    insert into ops.cash_account (portfolio_id, currency) values (new.portfolio_id, v_cur)
        on conflict (portfolio_id, currency) do nothing;
    select cash_account_id into v_acc from ops.cash_account
     where portfolio_id = new.portfolio_id and currency = v_cur for update;
    insert into ops.cash_movement (cash_account_id, trade_id, kind, amount, value_date, note)
        values (v_acc, new.trade_id, 'trade', case when new.side = 'buy' then -v_leg else v_leg end,
                new.settlement_date, format('%s %s шт. по %s', new.side, new.qty, new.clean_price_pct));
    if new.fee > 0 then
        insert into ops.cash_movement (cash_account_id, trade_id, kind, amount, value_date, note)
            values (v_acc, new.trade_id, 'fee', -new.fee, new.settlement_date, 'комиссия');
    end if;
    update ops.cash_account
       set balance = balance + (case when new.side = 'buy' then -v_leg else v_leg end) - new.fee
     where cash_account_id = v_acc;                 -- CHECK cash_no_negative ловит овердрафт
    return new;
end $$;
create or replace trigger trade_apply after insert on ops.trade
    for each row execute function ops.trg_trade_apply();

-- Сделка неизменяема: менять можно только контрагента; удалять нельзя. Отмена — встречной сделкой:
-- позиция и касса проводятся триггером только при вставке, поэтому смена статуса, комиссии или НКД
-- разошлась бы с уже проведённой бухгалтерией.
create or replace function ops.trg_trade_immutable() returns trigger
language plpgsql as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'trades cannot be deleted; book an offsetting trade' using errcode = 'BR005';
    end if;
    if (new.*) is distinct from (old.*) and
       (to_jsonb(new) - 'counterparty') is distinct from (to_jsonb(old) - 'counterparty') then
        raise exception 'trade is immutable (only counterparty may change); book an offsetting trade'
            using errcode = 'BR005';
    end if;
    return new;
end $$;
create or replace trigger trade_immutable before update or delete on ops.trade
    for each row execute function ops.trg_trade_immutable();
