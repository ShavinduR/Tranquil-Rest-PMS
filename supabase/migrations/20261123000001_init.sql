-- =============================================================================
-- Tranquil Rest PMS — initial schema
-- Postgres 15+ / Supabase. All times are timestamptz; the business runs on
-- Asia/Colombo (UTC+05:30, no DST).
-- =============================================================================

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role        as enum ('admin', 'caretaker');
create type public.room_category   as enum ('non_ac', 'ac');
create type public.booking_type    as enum ('short_time', 'day', 'night', 'full_day');
create type public.booking_status  as enum ('booked', 'checked_in', 'checked_out', 'cancelled');
create type public.housekeeping    as enum ('ready', 'cleaning');
create type public.payment_method  as enum ('cash', 'bank');
create type public.payment_kind    as enum ('advance', 'balance');
create type public.expense_type    as enum ('fixed', 'variable');

-- -----------------------------------------------------------------------------
-- Profiles (one row per auth user)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  role          public.app_role not null default 'caretaker',
  display_name  text not null default 'Caretaker',
  -- bcrypt hash of the 4-digit device-unlock PIN (caretakers only)
  pin_hash      text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Helpers used by RLS. SECURITY DEFINER so they can read profiles regardless
-- of the caller's own policies; search_path pinned to avoid hijacking.
create or replace function public.current_role_name()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid() and active), false)
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

-- -----------------------------------------------------------------------------
-- Settings (single row)
-- -----------------------------------------------------------------------------
create table public.settings (
  id                       smallint primary key default 1 check (id = 1),
  property_name            text not null default 'Tranquil Rest',
  property_phone           text,
  cleaning_buffer_minutes  integer not null default 30 check (cleaning_buffer_minutes between 0 and 240),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users (id)
);
insert into public.settings (id) values (1);

-- -----------------------------------------------------------------------------
-- Rooms & pricing (no hard-coded prices anywhere in the app)
-- -----------------------------------------------------------------------------
create table public.rooms (
  id            uuid primary key default gen_random_uuid(),
  room_number   integer not null unique,
  name          text not null,              -- e.g. 'Room 1'
  name_si       text not null,              -- e.g. 'කාමර 1'
  category      public.room_category not null default 'non_ac',
  housekeeping  public.housekeeping not null default 'ready',
  active        boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id)
);

create table public.pricing_rules (
  id                  uuid primary key default gen_random_uuid(),
  category            public.room_category not null,
  booking_type        public.booking_type not null,
  price               numeric(10,2) not null check (price >= 0),
  -- Fixed-window types (day/night) use start/end; duration types use minutes.
  default_start_time  time,
  default_end_time    time,
  duration_minutes    integer check (duration_minutes > 0),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id),
  unique (category, booking_type),
  check (duration_minutes is not null or (default_start_time is not null and default_end_time is not null))
);

-- -----------------------------------------------------------------------------
-- Bookings
-- -----------------------------------------------------------------------------
create table public.bookings (
  id                   uuid primary key default gen_random_uuid(),
  room_id              uuid not null references public.rooms (id),
  booking_type         public.booking_type not null,
  guest_name           text,
  guest_phone          text not null check (length(regexp_replace(guest_phone, '\D', '', 'g')) between 9 and 12),
  check_in_time        timestamptz not null,
  check_out_time       timestamptz not null,
  room_charge          numeric(10,2) not null check (room_charge >= 0),
  status               public.booking_status not null default 'booked',
  notes                text,
  actual_check_in_at   timestamptz,
  actual_check_out_at  timestamptz,
  cancelled_at         timestamptz,
  cancelled_by         uuid references auth.users (id),
  cancel_reason        text,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) default auth.uid(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) default auth.uid(),
  check (check_out_time > check_in_time),
  -- Hard guarantee against double-booking: NewStart < ExistingEnd AND NewEnd > ExistingStart
  -- ('[)' range semantics) for every non-cancelled booking in the same room.
  constraint bookings_no_overlap exclude using gist (
    room_id with =,
    tstzrange(check_in_time, check_out_time, '[)') with &&
  ) where (status <> 'cancelled')
);
create index bookings_time_idx on public.bookings (check_in_time, check_out_time);
create index bookings_room_idx on public.bookings (room_id, check_in_time);

create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id),
  kind        public.payment_kind not null,
  method      public.payment_method not null,
  amount      numeric(10,2) not null check (amount > 0),
  paid_at     timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) default auth.uid()
);
create index payments_paid_at_idx on public.payments (paid_at);
create index payments_booking_idx on public.payments (booking_id);

create table public.addon_presets (
  id          uuid primary key default gen_random_uuid(),
  label_si    text not null,
  label_en    text not null,
  price       numeric(10,2) not null check (price >= 0),
  sort_order  integer not null default 0,
  active      boolean not null default true
);

create table public.booking_addons (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id),
  label       text not null,
  unit_price  numeric(10,2) not null check (unit_price >= 0),
  quantity    integer not null default 1 check (quantity > 0),
  amount      numeric(10,2) generated always as (unit_price * quantity) stored,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) default auth.uid()
);
create index booking_addons_booking_idx on public.booking_addons (booking_id);

-- -----------------------------------------------------------------------------
-- Expenses (admin only)
-- -----------------------------------------------------------------------------
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  expense_type  public.expense_type not null,
  category      text not null,
  amount        numeric(10,2) not null check (amount > 0),
  expense_date  date not null,
  note          text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) default auth.uid()
);
create index expenses_date_idx on public.expenses (expense_date);

-- -----------------------------------------------------------------------------
-- Audit log
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   uuid,
  action      text not null,          -- insert | update | cancel | check_in | check_out | delete
  actor_id    uuid,
  actor_name  text,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_record_idx on public.audit_logs (record_id);

create or replace function public.tg_audit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_action text := lower(tg_op);
  v_id     uuid;
  v_name   text;
begin
  -- Nested IF: plpgsql resolves NEW.status eagerly, which fails on other tables.
  if tg_op = 'UPDATE' and tg_table_name = 'bookings' then
    if (to_jsonb(new) ->> 'status') is distinct from (to_jsonb(old) ->> 'status') then
      v_action := case to_jsonb(new) ->> 'status'
        when 'cancelled'   then 'cancel'
        when 'checked_in'  then 'check_in'
        when 'checked_out' then 'check_out'
        else 'update' end;
    end if;
  end if;

  v_id := case when tg_op = 'DELETE' then (to_jsonb(old) ->> 'id')::uuid
               else (to_jsonb(new) ->> 'id')::uuid end;
  select display_name into v_name from public.profiles where id = auth.uid();

  insert into public.audit_logs (table_name, record_id, action, actor_id, actor_name, old_data, new_data)
  values (
    tg_table_name, v_id, v_action, auth.uid(), coalesce(v_name, 'system'),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create or replace function public.tg_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

-- Caretakers must never re-open a cancelled booking or reprice after the fact
-- beyond what the UI allows; this guard keeps state transitions sane for everyone.
create or replace function public.tg_booking_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'cancelled' and new.status <> 'cancelled' and not public.is_admin() then
    raise exception 'Cancelled bookings can only be restored by an admin';
  end if;
  if old.status = 'checked_out' and new.status in ('booked','checked_in') and not public.is_admin() then
    raise exception 'Checked-out bookings can only be reopened by an admin';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_by := coalesce(new.cancelled_by, auth.uid());
  end if;
  return new;
end $$;

create trigger bookings_touch  before update on public.bookings      for each row execute function public.tg_touch();
create trigger bookings_guard  before update on public.bookings      for each row execute function public.tg_booking_guard();
create trigger rooms_touch     before update on public.rooms         for each row execute function public.tg_touch();
create trigger pricing_touch   before update on public.pricing_rules for each row execute function public.tg_touch();
create trigger settings_touch  before update on public.settings      for each row execute function public.tg_touch();

create trigger audit_bookings       after insert or update or delete on public.bookings       for each row execute function public.tg_audit();
create trigger audit_payments       after insert or update or delete on public.payments       for each row execute function public.tg_audit();
create trigger audit_booking_addons after insert or update or delete on public.booking_addons for each row execute function public.tg_audit();
create trigger audit_expenses       after insert or update or delete on public.expenses       for each row execute function public.tg_audit();
create trigger audit_rooms          after insert or update or delete on public.rooms          for each row execute function public.tg_audit();
create trigger audit_pricing        after insert or update or delete on public.pricing_rules  for each row execute function public.tg_audit();
create trigger audit_settings       after update on public.settings                           for each row execute function public.tg_audit();
create trigger audit_addon_presets  after insert or update or delete on public.addon_presets  for each row execute function public.tg_audit();

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

-- Returns hard conflicts (overlap) and soft warnings (inside the cleaning buffer)
-- for a proposed slot. The exclusion constraint is the real guard; this exists
-- so the UI can explain *why* a slot is not available before saving.
create or replace function public.check_booking_slot(
  p_room_id uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid default null
)
returns table (booking_id uuid, kind text, check_in_time timestamptz, check_out_time timestamptz, guest_name text)
language sql stable security invoker set search_path = public
as $$
  with buf as (
    select make_interval(mins => cleaning_buffer_minutes) as b from public.settings where id = 1
  )
  select b.id,
         case when p_start < b.check_out_time and p_end > b.check_in_time then 'overlap' else 'buffer' end,
         b.check_in_time, b.check_out_time, b.guest_name
  from public.bookings b, buf
  where b.room_id = p_room_id
    and b.status <> 'cancelled'
    and (p_exclude is null or b.id <> p_exclude)
    and p_start < b.check_out_time + buf.b
    and p_end   > b.check_in_time  - buf.b
  order by b.check_in_time
$$;

-- Caretakers may flip housekeeping state but not edit other room columns.
create or replace function public.set_room_housekeeping(p_room_id uuid, p_state public.housekeeping)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Not allowed';
  end if;
  update public.rooms set housekeeping = p_state where id = p_room_id;
end $$;

-- Verify the device-unlock PIN of the signed-in caretaker.
create or replace function public.verify_pin(p_pin text)
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(
    (select pin_hash is not null and pin_hash = crypt(p_pin, pin_hash)
       from public.profiles where id = auth.uid() and active),
    false)
$$;

-- Admin sets a staff member's PIN (stored as bcrypt).
create or replace function public.set_staff_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can set PINs';
  end if;
  if p_pin !~ '^\d{4}$' then
    raise exception 'PIN must be exactly 4 digits';
  end if;
  update public.profiles set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_user_id;
end $$;

-- Create a profile row automatically for every new auth user (caretaker by default).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.settings       enable row level security;
alter table public.rooms          enable row level security;
alter table public.pricing_rules  enable row level security;
alter table public.bookings       enable row level security;
alter table public.payments       enable row level security;
alter table public.addon_presets  enable row level security;
alter table public.booking_addons enable row level security;
alter table public.expenses       enable row level security;
alter table public.audit_logs     enable row level security;

-- profiles: see yourself; admins see/manage everyone. pin_hash is never selectable
-- by clients (column privilege below).
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- settings / rooms / pricing / presets: all staff read; admin writes.
create policy settings_select on public.settings for select to authenticated using (public.is_staff());
create policy settings_update on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy rooms_select on public.rooms for select to authenticated using (public.is_staff());
create policy rooms_admin_all on public.rooms for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy pricing_select on public.pricing_rules for select to authenticated using (public.is_staff());
create policy pricing_admin_all on public.pricing_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy presets_select on public.addon_presets for select to authenticated using (public.is_staff());
create policy presets_admin_all on public.addon_presets for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- bookings: caretakers see the operational window only (active bookings plus the
-- last 2 days), so they cannot reconstruct monthly sales. No DELETE policy for
-- anyone: bookings are soft-deleted via status = 'cancelled'.
create policy bookings_select on public.bookings for select to authenticated
  using (
    public.is_admin()
    or (public.is_staff() and (status in ('booked','checked_in') or check_out_time >= now() - interval '2 days'
                               or updated_at >= now() - interval '2 days'))
  );
create policy bookings_insert on public.bookings for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());
create policy bookings_update on public.bookings for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- payments & add-ons: staff read (scoped through visible bookings) and add;
-- only admins correct or remove them.
create policy payments_select on public.payments for select to authenticated
  using (public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id));
create policy payments_insert on public.payments for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());
create policy payments_admin_update on public.payments for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy payments_admin_delete on public.payments for delete to authenticated using (public.is_admin());

create policy addons_select on public.booking_addons for select to authenticated
  using (public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id));
create policy addons_insert on public.booking_addons for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());
create policy addons_admin_update on public.booking_addons for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy addons_admin_delete on public.booking_addons for delete to authenticated using (public.is_admin());

-- expenses & audit: admin only. Audit rows are written by the SECURITY DEFINER
-- trigger, never directly by clients.
create policy expenses_admin_all on public.expenses for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy audit_admin_select on public.audit_logs for select to authenticated using (public.is_admin());

-- Column privileges
revoke all on public.profiles from anon, authenticated;
grant select (id, role, display_name, active, created_at) on public.profiles to authenticated;
grant update (role, display_name, active) on public.profiles to authenticated;

revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_admin(), public.is_staff(), public.current_role_name(),
  public.check_booking_slot(uuid, timestamptz, timestamptz, uuid),
  public.set_room_housekeeping(uuid, public.housekeeping),
  public.verify_pin(text), public.set_staff_pin(uuid, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: push changes to every open device
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bookings, public.rooms, public.payments, public.booking_addons;
  end if;
end $$;
