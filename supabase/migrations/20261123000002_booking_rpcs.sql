-- Atomic booking operations. SECURITY INVOKER: RLS still applies to the caller.

-- Creates a booking with its advance payment and add-ons in one transaction.
create or replace function public.create_booking(p_booking jsonb, p_advance jsonb default null, p_addons jsonb default '[]'::jsonb)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_id uuid;
  v_status public.booking_status := coalesce((p_booking ->> 'status')::public.booking_status, 'booked');
begin
  if v_status not in ('booked', 'checked_in') then
    raise exception 'New bookings must be booked or checked_in';
  end if;

  insert into public.bookings (room_id, booking_type, guest_name, guest_phone, check_in_time, check_out_time,
                               room_charge, status, notes, actual_check_in_at)
  values (
    (p_booking ->> 'room_id')::uuid,
    (p_booking ->> 'booking_type')::public.booking_type,
    nullif(trim(p_booking ->> 'guest_name'), ''),
    p_booking ->> 'guest_phone',
    (p_booking ->> 'check_in_time')::timestamptz,
    (p_booking ->> 'check_out_time')::timestamptz,
    (p_booking ->> 'room_charge')::numeric,
    v_status,
    nullif(trim(p_booking ->> 'notes'), ''),
    case when v_status = 'checked_in' then now() end
  )
  returning id into v_id;

  if p_advance is not null and coalesce((p_advance ->> 'amount')::numeric, 0) > 0 then
    insert into public.payments (booking_id, kind, method, amount)
    values (v_id, coalesce((p_advance ->> 'kind')::public.payment_kind, 'advance'),
            (p_advance ->> 'method')::public.payment_method, (p_advance ->> 'amount')::numeric);
  end if;

  insert into public.booking_addons (booking_id, label, unit_price, quantity)
  select v_id, a ->> 'label', (a ->> 'unit_price')::numeric, coalesce((a ->> 'quantity')::int, 1)
  from jsonb_array_elements(coalesce(p_addons, '[]'::jsonb)) a;

  if v_status = 'checked_in' then
    perform public.set_room_housekeeping((p_booking ->> 'room_id')::uuid, 'ready');
  end if;

  return v_id;
end $$;

-- Checks a guest out: records the real time, frees the rest of the slot if they
-- leave early, and sends the room to cleaning.
create or replace function public.checkout_booking(p_booking_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_room uuid;
begin
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
end $$;

revoke execute on function public.create_booking(jsonb, jsonb, jsonb), public.checkout_booking(uuid) from public, anon;
grant execute on function public.create_booking(jsonb, jsonb, jsonb), public.checkout_booking(uuid) to authenticated;
