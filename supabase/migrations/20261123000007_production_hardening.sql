-- =============================================================================
-- Tranquil Rest PMS — production hardening (migration 0007)
--
-- Safe to run on the live database that already has migrations 0001–0006:
-- nothing is dropped except one policy, one CHECK constraint and functions that
-- are recreated in the same script; no rows are deleted or rewritten.
-- Run it once in Supabase → SQL Editor. It runs as one transaction.
--
--  1. Caretakers can no longer UPDATE bookings directly. Every caretaker change
--     goes through an audited SECURITY INVOKER function (check-in, cancel with
--     refund, check-out, extend, move room, notes). Admins keep full edit rights.
--  2. Refunds table (money returned when a booking with an advance is cancelled).
--  3. Server-side PIN rate limiting inside verify_pin().
--  4. Caretakers cannot create bookings that start in the past.
--  5. International guest phone numbers (up to 15 digits, E.164).
--  6. Backups and restore include refunds.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Caretaker booking changes only through dedicated functions
-- -----------------------------------------------------------------------------
-- The functions below set a transaction-local marker (tranquil.rpc = 'on').
-- Clients cannot set this marker themselves: PostgREST only sets request.*
-- settings, and set_config() is not exposed through the API.
create or replace function public.in_trusted_rpc()
returns boolean
language sql stable
as $$
  select coalesce(current_setting('tranquil.rpc', true), '') = 'on'
$$;

drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings for update to authenticated
  using (public.is_staff())
  with check (public.is_admin() or (public.is_staff() and public.in_trusted_rpc()));

-- Guest arrived.
create or replace function public.checkin_booking(p_booking_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_room uuid;
begin
  perform set_config('tranquil.rpc', 'on', true);
  update public.bookings
     set status = 'checked_in', actual_check_in_at = now()
   where id = p_booking_id and status = 'booked'
  returning room_id into v_room;
  if v_room is null then
    raise exception 'BOOKING_NOT_WAITING' using hint = 'Only a booked (not yet arrived) booking can be checked in';
  end if;
  perform public.set_room_housekeeping(v_room, 'ready');
  perform set_config('tranquil.rpc', 'off', true);
end $$;

-- Check-out (recreated so it can pass the new update policy).
create or replace function public.checkout_booking(p_booking_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_room uuid;
begin
  perform set_config('tranquil.rpc', 'on', true);
  update public.bookings
     set status = 'checked_out',
         actual_check_out_at = now(),
         check_out_time = greatest(check_in_time + interval '1 minute', least(check_out_time, now()))
   where id = p_booking_id and status = 'checked_in'
  returning room_id into v_room;
  if v_room is null then
    raise exception 'Booking is not checked in';
  end if;
  perform public.set_room_housekeeping(v_room, 'cleaning');
  perform set_config('tranquil.rpc', 'off', true);
end $$;

-- Longer stay. The new check-out must be later; an optional extra charge can only
-- add to the room charge, never reduce it. Overlaps are still rejected by
-- bookings_no_overlap.
create or replace function public.extend_booking(p_booking_id uuid, p_new_check_out timestamptz, p_extra_charge numeric default 0)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking_id and status in ('booked', 'checked_in');
  if v_b.id is null then
    raise exception 'BOOKING_NOT_ACTIVE';
  end if;
  if p_new_check_out <= v_b.check_out_time then
    raise exception 'EXTEND_MUST_BE_LATER';
  end if;
  if p_new_check_out > v_b.check_in_time + interval '14 days' then
    raise exception 'EXTEND_TOO_LONG';
  end if;
  if coalesce(p_extra_charge, 0) < 0 then
    raise exception 'EXTRA_CHARGE_NEGATIVE';
  end if;
  perform set_config('tranquil.rpc', 'on', true);
  update public.bookings
     set check_out_time = p_new_check_out,
         room_charge = room_charge + coalesce(p_extra_charge, 0)
   where id = p_booking_id;
  perform set_config('tranquil.rpc', 'off', true);
end $$;

-- Move to another room (same times). Overlaps are rejected by bookings_no_overlap.
create or replace function public.move_booking(p_booking_id uuid, p_new_room_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking_id and status in ('booked', 'checked_in');
  if v_b.id is null then
    raise exception 'BOOKING_NOT_ACTIVE';
  end if;
  if v_b.room_id = p_new_room_id then
    return;
  end if;
  if not exists (select 1 from public.rooms where id = p_new_room_id and active) then
    raise exception 'ROOM_NOT_AVAILABLE';
  end if;
  perform set_config('tranquil.rpc', 'on', true);
  update public.bookings set room_id = p_new_room_id where id = p_booking_id;
  perform set_config('tranquil.rpc', 'off', true);
  if v_b.status = 'checked_in' then
    perform public.set_room_housekeeping(v_b.room_id, 'cleaning');
    perform public.set_room_housekeeping(p_new_room_id, 'ready');
  end if;
end $$;

create or replace function public.set_booking_notes(p_booking_id uuid, p_notes text)
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'NOTES_TOO_LONG';
  end if;
  perform set_config('tranquil.rpc', 'on', true);
  update public.bookings set notes = nullif(trim(p_notes), '') where id = p_booking_id;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  perform set_config('tranquil.rpc', 'off', true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Refunds
-- -----------------------------------------------------------------------------
create table if not exists public.refunds (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id),
  method       public.payment_method not null,
  amount       numeric(10,2) not null check (amount > 0),
  reason       text,
  refunded_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) default auth.uid()
);
create index if not exists refunds_refunded_at_idx on public.refunds (refunded_at);
create index if not exists refunds_booking_idx on public.refunds (booking_id);

alter table public.refunds enable row level security;
drop policy if exists refunds_select on public.refunds;
drop policy if exists refunds_insert on public.refunds;
drop policy if exists refunds_admin_update on public.refunds;
drop policy if exists refunds_admin_delete on public.refunds;
create policy refunds_select on public.refunds for select to authenticated
  using (public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id));
-- Caretakers can only record a refund as part of cancel_booking(), never directly.
create policy refunds_insert on public.refunds for insert to authenticated
  with check (public.is_admin() or (public.is_staff() and public.in_trusted_rpc() and created_by = auth.uid()));
create policy refunds_admin_update on public.refunds for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy refunds_admin_delete on public.refunds for delete to authenticated using (public.is_admin());
revoke all on public.refunds from anon;
grant select, insert, update, delete on public.refunds to authenticated;

drop trigger if exists audit_refunds on public.refunds;
create trigger audit_refunds after insert or update or delete on public.refunds
  for each row execute function public.tg_audit();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'refunds') then
    alter publication supabase_realtime add table public.refunds;
  end if;
end $$;

-- Cancel, optionally refunding part or all of what was paid.
-- p_refund_amount = 0 means the advance is kept (forfeited).
create or replace function public.cancel_booking(
  p_booking_id uuid, p_reason text default null,
  p_refund_amount numeric default 0, p_refund_method public.payment_method default null
)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_b public.bookings;
  v_net_paid numeric;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if v_b.id is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if not (v_b.status = 'booked' or (public.is_admin() and v_b.status = 'checked_in')) then
    raise exception 'BOOKING_NOT_CANCELLABLE';
  end if;
  v_net_paid := coalesce((select sum(amount) from public.payments where booking_id = p_booking_id), 0)
              - coalesce((select sum(amount) from public.refunds where booking_id = p_booking_id), 0);
  if coalesce(p_refund_amount, 0) < 0 or coalesce(p_refund_amount, 0) > v_net_paid then
    raise exception 'REFUND_AMOUNT_INVALID';
  end if;
  if coalesce(p_refund_amount, 0) > 0 and p_refund_method is null then
    raise exception 'REFUND_METHOD_REQUIRED';
  end if;

  perform set_config('tranquil.rpc', 'on', true);
  update public.bookings
     set status = 'cancelled', cancel_reason = nullif(trim(p_reason), '')
   where id = p_booking_id;
  if coalesce(p_refund_amount, 0) > 0 then
    insert into public.refunds (booking_id, method, amount, reason)
    values (p_booking_id, p_refund_method, p_refund_amount, 'cancellation');
  end if;
  perform set_config('tranquil.rpc', 'off', true);
end $$;

-- -----------------------------------------------------------------------------
-- 3. Server-side PIN rate limiting
-- -----------------------------------------------------------------------------
-- 5 wrong PINs lock the account's PIN for 60 s; each further lock doubles
-- (60 s, 2 min, 4 min … max 1 hour). A correct PIN resets everything.
create table if not exists private.pin_attempts (
  user_id       uuid primary key,
  failed        integer not null default 0,
  lock_count    integer not null default 0,
  locked_until  timestamptz
);

create or replace function public.verify_pin(p_pin text)
returns boolean
language plpgsql volatile security definer set search_path = public, private, extensions
as $$
declare
  v_uid  uuid := auth.uid();
  v_hash text;
  v_row  private.pin_attempts;
begin
  if v_uid is null then
    return false;
  end if;

  select * into v_row from private.pin_attempts where user_id = v_uid for update;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    -- PostgREST turns SQLSTATE PT429 into HTTP 429; detail = seconds left.
    raise exception 'PIN_LOCKED'
      using errcode = 'PT429', detail = ceil(extract(epoch from v_row.locked_until - now()))::int::text;
  end if;

  select pin_hash into v_hash from public.profiles where id = v_uid and active;
  if v_hash is not null and v_hash = crypt(coalesce(p_pin, ''), v_hash) then
    delete from private.pin_attempts where user_id = v_uid;
    return true;
  end if;

  insert into private.pin_attempts as a (user_id, failed) values (v_uid, 1)
  on conflict (user_id) do update set failed = a.failed + 1, locked_until = null
  returning * into v_row;

  if v_row.failed >= 5 then
    update private.pin_attempts
       set failed = 0,
           lock_count = lock_count + 1,
           locked_until = now() + make_interval(secs => least(60 * power(2, lock_count), 3600))
     where user_id = v_uid;
  end if;
  return false;
end $$;

-- -----------------------------------------------------------------------------
-- 4. No caretaker bookings starting in the past
-- -----------------------------------------------------------------------------
-- 60 minutes of grace lets a caretaker record a walk-in a little late.
create or replace function public.tg_booking_insert_guard()
returns trigger
language plpgsql security definer set search_path = public, private
as $$
begin
  if not coalesce(public.is_admin() or private.is_trusted_backend(), false) then
    if new.check_in_time < now() - interval '60 minutes' then
      raise exception 'BOOKING_IN_PAST';
    end if;
    if new.status not in ('booked', 'checked_in') then
      raise exception 'New bookings must be booked or checked_in';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists bookings_insert_guard on public.bookings;
create trigger bookings_insert_guard before insert on public.bookings
  for each row execute function public.tg_booking_insert_guard();

-- -----------------------------------------------------------------------------
-- 5. International phone numbers: 8–15 digits (E.164), stored as '07…' or '+…'
-- -----------------------------------------------------------------------------
alter table public.bookings drop constraint if exists bookings_guest_phone_check;
alter table public.bookings add constraint bookings_guest_phone_check
  check (length(regexp_replace(guest_phone, '\D', '', 'g')) between 8 and 15);

-- -----------------------------------------------------------------------------
-- Grants for the new functions
-- -----------------------------------------------------------------------------
revoke execute on function
  public.in_trusted_rpc(),
  public.checkin_booking(uuid),
  public.extend_booking(uuid, timestamptz, numeric),
  public.move_booking(uuid, uuid),
  public.set_booking_notes(uuid, text),
  public.cancel_booking(uuid, text, numeric, public.payment_method)
  from public, anon;
grant execute on function
  public.in_trusted_rpc(),
  public.checkin_booking(uuid),
  public.extend_booking(uuid, timestamptz, numeric),
  public.move_booking(uuid, uuid),
  public.set_booking_notes(uuid, text),
  public.cancel_booking(uuid, text, numeric, public.payment_method)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Backups and restore include refunds
-- -----------------------------------------------------------------------------
create or replace function private.snapshot()
returns jsonb
language sql stable security definer set search_path = public, private
as $$
  select jsonb_build_object(
    'format',         'tranquil-rest-backup/1',
    'exported_at',    now(),
    'settings',       (select to_jsonb(s) from public.settings s where id = 1),
    'rooms',          coalesce((select jsonb_agg(to_jsonb(r) order by r.room_number) from public.rooms r), '[]'),
    'pricing_rules',  coalesce((select jsonb_agg(to_jsonb(p) order by p.category, p.booking_type) from public.pricing_rules p), '[]'),
    'addon_presets',  coalesce((select jsonb_agg(to_jsonb(a) order by a.sort_order) from public.addon_presets a), '[]'),
    'profiles',       coalesce((select jsonb_agg(jsonb_build_object('id', id, 'role', role, 'display_name', display_name, 'active', active, 'created_at', created_at)) from public.profiles), '[]'),
    'bookings',       coalesce((select jsonb_agg(to_jsonb(b) order by b.check_in_time) from public.bookings b), '[]'),
    'payments',       coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_at) from public.payments p), '[]'),
    'refunds',        coalesce((select jsonb_agg(to_jsonb(f) order by f.refunded_at) from public.refunds f), '[]'),
    'booking_addons', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.booking_addons a), '[]'),
    'expenses',       coalesce((select jsonb_agg(to_jsonb(e) order by e.expense_date) from public.expenses e), '[]'),
    'audit_logs',     coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.audit_logs l), '[]')
  )
$$;

create or replace function private.restore_table(p_table text, p_rows jsonb, p_mode text)
returns jsonb
language plpgsql security definer set search_path = public, private
as $$
declare
  v_cols text;
  v_ref text;
  v_overriding text := case when p_table = 'audit_logs' then 'overriding system value' else '' end;
  v_conflict text := case when p_mode = 'merge' then 'on conflict do nothing' else '' end;
  v_before bigint;
  v_after bigint;
  v_total int := coalesce(jsonb_array_length(p_rows), 0);
  v_row record;
begin
  if v_total = 0 then
    return jsonb_build_object('restored', 0, 'skipped', 0);
  end if;

  execute format('drop table if exists pg_temp.%I', 'r_' || p_table);
  execute format('create temp table %I (like public.%I) on commit drop', 'r_' || p_table, p_table);
  execute format('insert into %1$I select * from jsonb_populate_recordset(null::%1$I, $1)', 'r_' || p_table) using p_rows;

  for v_ref in
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = p_table
      and column_name in ('created_by', 'updated_by', 'cancelled_by')
  loop
    execute format('update %1$I set %2$I = null where %2$I is not null and not exists (select 1 from auth.users u where u.id = %1$I.%2$I)',
                   'r_' || p_table, v_ref);
  end loop;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table and is_generated = 'NEVER';

  execute format('select count(*) from public.%I', p_table) into v_before;

  if p_mode = 'merge' and p_table in ('bookings', 'payments', 'refunds', 'booking_addons', 'rooms') then
    for v_row in execute format('select id::text as id from %I', 'r_' || p_table) loop
      begin
        execute format('insert into public.%1$I (%2$s) select %2$s from %3$I where id::text = $1 on conflict (id) do nothing',
                       p_table, v_cols, 'r_' || p_table) using v_row.id;
      exception when exclusion_violation or unique_violation or foreign_key_violation or check_violation then
        null;
      end;
    end loop;
  else
    execute format('insert into public.%1$I (%2$s) %4$s select %2$s from %3$I %5$s',
                   p_table, v_cols, 'r_' || p_table, v_overriding, v_conflict);
  end if;

  execute format('select count(*) from public.%I', p_table) into v_after;
  return jsonb_build_object('restored', v_after - v_before, 'skipped', v_total - (v_after - v_before));
end $$;

create or replace function public.restore_backup(
  p_backup jsonb, p_mode text default 'merge', p_dry_run boolean default true, p_confirm text default null
)
returns jsonb
language plpgsql security definer set search_path = public, private
as $$
declare
  v_tables text[] := array['rooms', 'pricing_rules', 'addon_presets', 'expenses', 'bookings', 'payments', 'refunds', 'booking_addons', 'audit_logs'];
  v_all text[] := array['rooms', 'pricing_rules', 'addon_presets', 'expenses', 'bookings', 'payments', 'refunds', 'booking_addons', 'audit_logs', 'settings'];
  v_t text;
  v_report jsonb := '{}'::jsonb;
  v_result jsonb;
  v_missing_users jsonb;
  v_actor uuid := auth.uid();
  v_actor_name text;
begin
  if not coalesce(public.is_admin() or private.is_trusted_backend(), false) then
    raise exception 'Only admins can restore backups';
  end if;
  if p_mode not in ('merge', 'replace') then
    raise exception 'Mode must be merge or replace';
  end if;
  if coalesce(p_backup ->> 'format', '') <> 'tranquil-rest-backup/1' then
    raise exception 'This is not a Tranquil Rest backup file';
  end if;
  if p_mode = 'replace' and not p_dry_run and coalesce(p_confirm, '') <> 'REPLACE ALL DATA' then
    raise exception 'Replace needs the confirmation text REPLACE ALL DATA';
  end if;
  select display_name into v_actor_name from public.profiles where id = v_actor;

  begin
    foreach v_t in array v_all loop
      execute format('alter table public.%I disable trigger user', v_t);
    end loop;

    if p_mode = 'replace' then
      delete from public.booking_addons;
      delete from public.refunds;
      delete from public.payments;
      delete from public.bookings;
      delete from public.expenses;
      delete from public.audit_logs;
      delete from public.pricing_rules;
      delete from public.addon_presets;
      delete from public.rooms;
    end if;

    foreach v_t in array v_tables loop
      -- Older backups have no 'refunds' key: restore_table treats that as empty.
      v_report := v_report || jsonb_build_object(v_t, private.restore_table(v_t, p_backup -> v_t, p_mode));
    end loop;

    if p_mode = 'replace' and p_backup ? 'settings' and jsonb_typeof(p_backup -> 'settings') = 'object' then
      update public.settings s set
        property_name           = coalesce(p_backup -> 'settings' ->> 'property_name', s.property_name),
        property_phone          = p_backup -> 'settings' ->> 'property_phone',
        cleaning_buffer_minutes = coalesce((p_backup -> 'settings' ->> 'cleaning_buffer_minutes')::int, s.cleaning_buffer_minutes)
      where id = 1;
      v_report := v_report || jsonb_build_object('settings', jsonb_build_object('restored', 1, 'skipped', 0));
    end if;

    if p_mode = 'replace' then
      update public.profiles p set role = (b ->> 'role')::public.app_role, display_name = b ->> 'display_name', active = (b ->> 'active')::boolean
      from jsonb_array_elements(coalesce(p_backup -> 'profiles', '[]')) b
      where p.id = (b ->> 'id')::uuid and p.id is distinct from v_actor;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', b ->> 'id', 'display_name', b ->> 'display_name', 'role', b ->> 'role')), '[]')
      into v_missing_users
    from jsonb_array_elements(coalesce(p_backup -> 'profiles', '[]')) b
    where not exists (select 1 from auth.users u where u.id = (b ->> 'id')::uuid);

    perform setval(pg_get_serial_sequence('public.audit_logs', 'id'), greatest((select max(id) from public.audit_logs), 1));

    foreach v_t in array v_all loop
      execute format('alter table public.%I enable trigger user', v_t);
    end loop;

    v_result := jsonb_build_object(
      'mode', p_mode,
      'dry_run', p_dry_run,
      'backup_exported_at', p_backup ->> 'exported_at',
      'tables', v_report,
      'missing_users', v_missing_users
    );

    insert into public.audit_logs (table_name, action, actor_id, actor_name, new_data)
    values ('backup', 'restore_' || p_mode, v_actor, coalesce(v_actor_name, current_user), v_result);

    if p_dry_run then
      raise exception using errcode = 'P0D01', message = v_result::text;
    end if;
  exception when sqlstate 'P0D01' then
    return sqlerrm::jsonb;
  end;

  return v_result;
end $$;
