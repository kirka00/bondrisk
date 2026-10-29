-- =====================================================================
--  Бизнес-правила справочников: амортизация ≤ номинала, один действующий рейтинг,
--  условия флоутера только у флоутера.
-- =====================================================================

-- Сумма погашений тела по графику не может превышать номинал (методология §3).
create or replace function ref.trg_amortization_check() returns trigger
language plpgsql as $$
declare v_sum numeric; v_face numeric;
begin
    select coalesce(sum(amount), 0) into v_sum from ref.cash_flow_schedule
     where bond_id = new.bond_id and flow_type in ('amortization', 'redemption');
    select face_value_initial into v_face from ref.bond where bond_id = new.bond_id;
    if v_sum > v_face * 1.000001 then
        raise exception 'amortization schedule of bond % (%) exceeds face value %', new.bond_id, v_sum, v_face
            using errcode = 'BR006';
    end if;
    return new;
end $$;
create constraint trigger amortization_check after insert or update on ref.cash_flow_schedule
    deferrable initially deferred
    for each row when (new.flow_type in ('amortization', 'redemption'))
    execute function ref.trg_amortization_check();

-- Новый действующий рейтинг закрывает предыдущий по тому же объекту и агентству;
-- тип действия выводится сравнением со старым баллом.
create or replace function ref.trg_rating_supersede() returns trigger
language plpgsql as $$
declare v_old ref.credit_rating%rowtype; v_old_score smallint; v_new_score smallint;
begin
    if new.status <> 'active' then
        return new;
    end if;
    select * into v_old from ref.credit_rating
     where agency_id = new.agency_id and status = 'active'
       and coalesce(bond_id, 0) = coalesce(new.bond_id, 0)
       and coalesce(issuer_id, 0) = coalesce(new.issuer_id, 0)
     for update;
    if found then
        if v_old.assigned_on > new.assigned_on then
            new.status := 'superseded';                      -- загружена более старая запись истории
            return new;
        end if;
        update ref.credit_rating set status = 'superseded' where rating_id = v_old.rating_id;
        if new.action = 'assigned' then
            select score into v_old_score from ref.rating_scale where grade = v_old.grade;
            select score into v_new_score from ref.rating_scale where grade = new.grade;
            new.action := case when v_new_score < v_old_score then 'upgraded'
                               when v_new_score > v_old_score then 'downgraded'
                               else 'affirmed' end;
        end if;
    end if;
    return new;
end $$;
create trigger rating_supersede before insert on ref.credit_rating
    for each row execute function ref.trg_rating_supersede();

-- floater_terms только у выпусков с плавающим купоном
create or replace function ref.trg_floater_terms_check() returns trigger
language plpgsql as $$
declare v_type ref.coupon_type;
begin
    select coupon_type into v_type from ref.bond where bond_id = new.bond_id;
    if v_type <> 'floating' then
        raise exception 'floater_terms for bond % require coupon_type = floating (got %)', new.bond_id, v_type
            using errcode = 'BR006';
    end if;
    return new;
end $$;
create trigger floater_terms_check before insert or update on ref.floater_terms
    for each row execute function ref.trg_floater_terms_check();

create or replace function ref.trg_bond_coupon_type_check() returns trigger
language plpgsql as $$
begin
    if old.coupon_type = 'floating' and new.coupon_type <> 'floating'
       and exists (select 1 from ref.floater_terms where bond_id = new.bond_id) then
        raise exception 'bond % has floater_terms; delete them before changing coupon_type', new.bond_id
            using errcode = 'BR006';
    end if;
    return new;
end $$;
create trigger bond_coupon_type_check before update of coupon_type on ref.bond
    for each row execute function ref.trg_bond_coupon_type_check();
