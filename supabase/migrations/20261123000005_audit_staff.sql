-- Audit staff account changes (added, renamed, role changed, (de)activated, PIN set).
-- The PIN hash itself is never copied into the audit log; a PIN change is recorded
-- as "pin_changed": true.

create or replace function public.tg_audit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_action text := lower(tg_op);
  v_old    jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) - 'pin_hash' end;
  v_new    jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) - 'pin_hash' end;
  v_raw    text;
  v_id     uuid;
  v_name   text;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'bookings' then
    if (v_new ->> 'status') is distinct from (v_old ->> 'status') then
      v_action := case v_new ->> 'status'
        when 'cancelled'   then 'cancel'
        when 'checked_in'  then 'check_in'
        when 'checked_out' then 'check_out'
        else 'update' end;
    end if;
  end if;

  if tg_table_name = 'profiles' and tg_op = 'UPDATE' then
    if (to_jsonb(new) ->> 'pin_hash') is distinct from (to_jsonb(old) ->> 'pin_hash') then
      v_new := v_new || '{"pin_changed": true}';
      v_old := v_old || '{"pin_changed": false}';
    end if;
    if v_new = v_old then
      return new; -- nothing visible changed
    end if;
  end if;

  v_raw := coalesce(v_new, v_old) ->> 'id';
  if v_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := v_raw::uuid;
  end if;
  select display_name into v_name from public.profiles where id = auth.uid();

  insert into public.audit_logs (table_name, record_id, action, actor_id, actor_name, old_data, new_data)
  values (tg_table_name, v_id, v_action, auth.uid(), coalesce(v_name, 'system'), v_old, v_new);
  return coalesce(new, old);
end $$;

drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.tg_audit();
