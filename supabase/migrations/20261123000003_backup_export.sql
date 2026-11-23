-- Read-only export for the nightly Google Sheets / Drive backup.
-- The backup script authenticates with a random "backup key" (not the
-- service_role key), so a leaked key can only READ data, never change it.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.backup_keys (
  id          smallint primary key default 1 check (id = 1),
  key_hash    text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  last_used   timestamptz
);

-- Admin generates (or rotates) the key. The plain key is returned ONCE; only a hash is stored.
create or replace function public.rotate_backup_key()
returns text
language plpgsql security definer set search_path = public, private, extensions
as $$
declare
  v_key text := encode(gen_random_bytes(24), 'hex');
begin
  if not public.is_admin() then
    raise exception 'Only admins can create a backup key';
  end if;
  insert into private.backup_keys (id, key_hash, created_by)
  values (1, encode(digest(v_key, 'sha256'), 'hex'), auth.uid())
  on conflict (id) do update set key_hash = excluded.key_hash, created_at = now(), created_by = excluded.created_by, last_used = null;
  insert into public.audit_logs (table_name, action, actor_id, actor_name)
  values ('backup_keys', 'rotate', auth.uid(), (select display_name from public.profiles where id = auth.uid()));
  return v_key;
end $$;

create or replace function public.backup_key_status()
returns table (created_at timestamptz, last_used timestamptz)
language sql stable security definer set search_path = public, private
as $$
  select created_at, last_used from private.backup_keys where id = 1 and public.is_admin()
$$;

-- Full snapshot of every business table as one JSON document.
-- PIN hashes are deliberately excluded.
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
    perform pg_sleep(1); -- slow down guessing
    raise exception 'Invalid backup key' using errcode = '28000';
  end if;
  update private.backup_keys set last_used = now() where id = 1;

  return jsonb_build_object(
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
  );
end $$;

revoke execute on function public.rotate_backup_key(), public.backup_key_status(), public.export_backup(text) from public, anon, authenticated;
grant execute on function public.rotate_backup_key(), public.backup_key_status() to authenticated;
-- The backup script calls with the anon (public) API key + the backup key.
grant execute on function public.export_backup(text) to anon, authenticated;
