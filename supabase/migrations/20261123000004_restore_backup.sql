-- Restore from a nightly backup file (format tranquil-rest-backup/1).
--
--   restore_backup(backup, 'merge',   dry_run)  → put back rows that are missing; never overwrites or deletes.
--   restore_backup(backup, 'replace', dry_run, 'REPLACE ALL DATA')
--                                               → wipe business data and load the backup exactly.
--
-- Everything runs in one transaction: it either fully succeeds or changes nothing.
-- With dry_run = true the work is done and then rolled back, returning the same report.
-- Callable by admins (app) or the service_role (CLI / SQL editor).

-- Shared snapshot builder (used by the keyed nightly export and the admin download).
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
    'booking_addons', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.booking_addons a), '[]'),
    'expenses',       coalesce((select jsonb_agg(to_jsonb(e) order by e.expense_date) from public.expenses e), '[]'),
    'audit_logs',     coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.audit_logs l), '[]')
  )
$$;

create or replace function public.export_backup(p_key text)
returns jsonb
language plpgsql volatile security definer set search_path = public, private, extensions
as $$
declare
  v_ok boolean;
begin
  select coalesce(key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex'), false)
    into v_ok from private.backup_keys where id = 1;
  if not coalesce(v_ok, false) then
    perform pg_sleep(1);
    raise exception 'Invalid backup key' using errcode = '28000';
  end if;
  update private.backup_keys set last_used = now() where id = 1;
  return private.snapshot();
end $$;

-- Admins can download the current data at any time (used as a safety copy before a restore).
create or replace function public.export_backup_admin()
returns jsonb
language plpgsql stable security definer set search_path = public, private
as $$
begin
  if not coalesce(public.is_admin() or private.is_trusted_backend(), false) then
    raise exception 'Only admins can export data';
  end if;
  return private.snapshot();
end $$;

-- Loads one table's rows from the backup. Returns {restored, skipped}.
-- User references (created_by etc.) pointing at accounts that don't exist in this
-- project are set to NULL rather than failing, so a backup can move to a new project.
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
  v_skipped int := 0;
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
      and column_name in ('created_by', 'updated_by', 'cancelled_by', 'actor_id')
  loop
    -- actor_id in audit_logs is informational (no FK) and kept as-is
    continue when v_ref = 'actor_id';
    execute format('update %1$I set %2$I = null where %2$I is not null and not exists (select 1 from auth.users u where u.id = %1$I.%2$I)',
                   'r_' || p_table, v_ref);
  end loop;

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table and is_generated = 'NEVER';

  execute format('select count(*) from public.%I', p_table) into v_before;

  if p_mode = 'merge' and p_table in ('bookings', 'payments', 'booking_addons', 'rooms') then
    -- Row by row so one clash (overlapping booking, duplicate room number, missing
    -- parent booking) skips that row instead of aborting the whole merge.
    for v_row in execute format('select id::text as id from %I', 'r_' || p_table) loop
      begin
        execute format('insert into public.%1$I (%2$s) select %2$s from %3$I where id::text = $1 on conflict (id) do nothing',
                       p_table, v_cols, 'r_' || p_table) using v_row.id;
      exception when exclusion_violation or unique_violation or foreign_key_violation or check_violation then
        v_skipped := v_skipped + 1;
      end;
    end loop;
  else
    execute format('insert into public.%1$I (%2$s) %4$s select %2$s from %3$I %5$s',
                   p_table, v_cols, 'r_' || p_table, v_overriding, v_conflict);
  end if;

  execute format('select count(*) from public.%I', p_table) into v_after;
  return jsonb_build_object('restored', v_after - v_before, 'skipped', v_total - (v_after - v_before));
end $$;

-- True for the Supabase service_role (CLI) or a direct database session such as the
-- SQL editor. NOTE: inside SECURITY DEFINER functions current_user is the owner, so
-- it must not be used for this check; we look at the caller's JWT / session instead.
create or replace function private.is_trusted_backend()
returns boolean
language sql stable set search_path = public
as $$
  select coalesce((
         coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
           nullif(current_setting('request.jwt.claim.role', true), '')
         ) = 'service_role'
      or (auth.uid() is null
          and session_user <> 'authenticator'
          and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                       nullif(current_setting('request.jwt.claim.role', true), ''), '') = '')
  ), false)
$$;

create or replace function public.restore_backup(
  p_backup jsonb, p_mode text default 'merge', p_dry_run boolean default true, p_confirm text default null
)
returns jsonb
language plpgsql security definer set search_path = public, private
as $$
declare
  v_tables text[] := array['rooms', 'pricing_rules', 'addon_presets', 'expenses', 'bookings', 'payments', 'booking_addons', 'audit_logs'];
  v_all text[] := array['rooms', 'pricing_rules', 'addon_presets', 'expenses', 'bookings', 'payments', 'booking_addons', 'audit_logs', 'settings'];
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
    -- Restored rows must keep their original timestamps/authors and must not
    -- spam the audit log, so user triggers are paused (transactionally).
    foreach v_t in array v_all loop
      execute format('alter table public.%I disable trigger user', v_t);
    end loop;

    if p_mode = 'replace' then
      delete from public.booking_addons;
      delete from public.payments;
      delete from public.bookings;
      delete from public.expenses;
      delete from public.audit_logs;
      delete from public.pricing_rules;
      delete from public.addon_presets;
      delete from public.rooms;
    end if;

    foreach v_t in array v_tables loop
      v_report := v_report || jsonb_build_object(v_t, private.restore_table(v_t, p_backup -> v_t, p_mode));
    end loop;

    -- Settings: single row. Replace overwrites it; merge leaves current settings alone.
    if p_mode = 'replace' and p_backup ? 'settings' and jsonb_typeof(p_backup -> 'settings') = 'object' then
      update public.settings s set
        property_name           = coalesce(p_backup -> 'settings' ->> 'property_name', s.property_name),
        property_phone          = p_backup -> 'settings' ->> 'property_phone',
        cleaning_buffer_minutes = coalesce((p_backup -> 'settings' ->> 'cleaning_buffer_minutes')::int, s.cleaning_buffer_minutes)
      where id = 1;
      v_report := v_report || jsonb_build_object('settings', jsonb_build_object('restored', 1, 'skipped', 0));
    end if;

    -- Staff roles/names: only for accounts that exist in this project.
    if p_mode = 'replace' then
      update public.profiles p set role = (b ->> 'role')::public.app_role, display_name = b ->> 'display_name', active = (b ->> 'active')::boolean
      from jsonb_array_elements(coalesce(p_backup -> 'profiles', '[]')) b
      where p.id = (b ->> 'id')::uuid and p.id is distinct from v_actor; -- never demote the person restoring
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id', b ->> 'id', 'display_name', b ->> 'display_name', 'role', b ->> 'role')), '[]')
      into v_missing_users
    from jsonb_array_elements(coalesce(p_backup -> 'profiles', '[]')) b
    where not exists (select 1 from auth.users u where u.id = (b ->> 'id')::uuid);

    -- Keep identity counters ahead of restored IDs.
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
    -- Dry run: everything above is rolled back, report returned.
    return sqlerrm::jsonb;
  end;

  return v_result;
end $$;

revoke execute on function private.snapshot(), private.restore_table(text, jsonb, text), private.is_trusted_backend() from public, anon, authenticated;
revoke execute on function public.restore_backup(jsonb, text, boolean, text), public.export_backup_admin() from public, anon;
grant execute on function public.restore_backup(jsonb, text, boolean, text), public.export_backup_admin() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.restore_backup(jsonb, text, boolean, text), public.export_backup_admin() to service_role;
  end if;
end $$;

-- Fix: settings.id is a smallint, not a uuid, so the audit trigger failed on every
-- settings update. Only treat the id as a record_id when it is a uuid.
create or replace function public.tg_audit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_action text := lower(tg_op);
  v_raw    text;
  v_id     uuid;
  v_name   text;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'bookings' then
    if (to_jsonb(new) ->> 'status') is distinct from (to_jsonb(old) ->> 'status') then
      v_action := case to_jsonb(new) ->> 'status'
        when 'cancelled'   then 'cancel'
        when 'checked_in'  then 'check_in'
        when 'checked_out' then 'check_out'
        else 'update' end;
    end if;
  end if;

  v_raw := case when tg_op = 'DELETE' then to_jsonb(old) ->> 'id' else to_jsonb(new) ->> 'id' end;
  if v_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := v_raw::uuid;
  end if;
  select display_name into v_name from public.profiles where id = auth.uid();

  insert into public.audit_logs (table_name, record_id, action, actor_id, actor_name, old_data, new_data)
  values (
    tg_table_name, v_id, v_action, auth.uid(), coalesce(v_name, 'system'),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;
