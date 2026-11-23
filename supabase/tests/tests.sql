-- Behavioural tests for schema, RLS and triggers. Any failed assertion aborts.
\set ON_ERROR_STOP 1

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com', '{"display_name":"Owner"}'),
  ('00000000-0000-0000-0000-00000000000c', 'caretaker@example.com', '{"display_name":"Sunil"}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000a';

create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;

-- ---------- act as admin ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.set_staff_pin('00000000-0000-0000-0000-00000000000c', '4826');
select pg_temp.assert((select count(*) = 5 from public.rooms), 'admin sees 5 rooms');
insert into public.expenses (expense_type, category, amount, expense_date) values ('fixed', 'CEB Electricity', 8500, '2026-11-01');

-- ---------- act as caretaker ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.assert(public.verify_pin('4826'), 'correct PIN verifies');
select pg_temp.assert(not public.verify_pin('0000'), 'wrong PIN rejected');
select pg_temp.assert((select count(*) = 0 from public.expenses), 'caretaker cannot see expenses');
select pg_temp.assert((select count(*) = 0 from public.audit_logs), 'caretaker cannot see audit logs');

-- pin_hash is not selectable by clients
do $$ begin
  perform pin_hash from public.profiles;
  raise exception 'ASSERTION FAILED: pin_hash readable';
exception when insufficient_privilege then null; end $$;

-- Room 1: Day booking 08:00-17:00 Colombo
insert into public.bookings (id, room_id, booking_type, guest_name, guest_phone, check_in_time, check_out_time, room_charge)
select '11111111-1111-1111-1111-111111111111', id, 'day', 'Saman', '0771234567',
       '2026-12-01 08:00+05:30', '2026-12-01 17:00+05:30', 2000 from public.rooms where room_number = 1;

-- Overlapping Short Time must be rejected by the exclusion constraint
do $$ begin
  insert into public.bookings (room_id, booking_type, guest_phone, check_in_time, check_out_time, room_charge)
  select id, 'short_time', '0711111111', '2026-12-01 16:00+05:30', '2026-12-01 19:00+05:30', 1500
  from public.rooms where room_number = 1;
  raise exception 'ASSERTION FAILED: overlap allowed';
exception when exclusion_violation then null; end $$;

-- Back-to-back Night booking (18:00) is allowed, but inside 30-min buffer? 17:00→18:00 is 60 min, so no warning.
insert into public.bookings (room_id, booking_type, guest_phone, check_in_time, check_out_time, room_charge)
select id, 'night', '0712222222', '2026-12-01 18:00+05:30', '2026-12-02 08:00+05:30', 2500
from public.rooms where room_number = 1;

select pg_temp.assert(
  (select count(*) = 0 from public.check_booking_slot(
     (select id from public.rooms where room_number = 1), '2026-12-02 09:00+05:30', '2026-12-02 12:00+05:30')),
  'slot 09:00 next day is free and outside buffer');
select pg_temp.assert(
  (select kind = 'buffer' from public.check_booking_slot(
     (select id from public.rooms where room_number = 1), '2026-12-01 17:10+05:30', '2026-12-01 17:50+05:30') limit 1),
  'slot 17:10 inside cleaning buffer is flagged');
select pg_temp.assert(
  (select bool_or(kind = 'overlap') from public.check_booking_slot(
     (select id from public.rooms where room_number = 1), '2026-12-01 12:00+05:30', '2026-12-01 13:00+05:30')),
  'overlap detected by RPC');

-- Payments & add-ons
insert into public.payments (booking_id, kind, method, amount) values ('11111111-1111-1111-1111-111111111111', 'advance', 'cash', 1000);
insert into public.booking_addons (booking_id, label, unit_price, quantity) values ('11111111-1111-1111-1111-111111111111', 'තේ', 100, 2);
select pg_temp.assert((select amount = 200 from public.booking_addons limit 1), 'addon amount generated');

-- Caretaker cannot hard-delete bookings or payments (RLS: zero rows affected)
delete from public.bookings where id = '11111111-1111-1111-1111-111111111111';
delete from public.payments;
reset role;
select pg_temp.assert((select count(*) = 2 from public.bookings), 'booking not hard-deleted');
select pg_temp.assert((select count(*) = 1 from public.payments), 'payment not deleted by caretaker');
set role authenticated;

-- Caretaker cannot change prices (zero rows updated)
update public.pricing_rules set price = 1 where booking_type = 'day';
reset role;
select pg_temp.assert((select price = 2000 from public.pricing_rules where category='non_ac' and booking_type='day'), 'caretaker cannot edit price');
set role authenticated;

-- Caretaker can set housekeeping via RPC only
update public.rooms set name = 'Hacked' where room_number = 2;
select public.set_room_housekeeping((select id from public.rooms where room_number = 2), 'cleaning');
reset role;
select pg_temp.assert((select name = 'Room 2' and housekeeping = 'cleaning' from public.rooms where room_number = 2), 'housekeeping via RPC only');
set role authenticated;

-- Soft cancel frees the slot; cancelled can't be re-opened by caretaker
update public.bookings set status = 'cancelled', cancel_reason = 'guest no-show' where id = '11111111-1111-1111-1111-111111111111';
insert into public.bookings (room_id, booking_type, guest_phone, check_in_time, check_out_time, room_charge)
select id, 'short_time', '0711111111', '2026-12-01 09:00+05:30', '2026-12-01 12:00+05:30', 1500
from public.rooms where room_number = 1;
do $$ begin
  update public.bookings set status = 'booked' where id = '11111111-1111-1111-1111-111111111111';
  raise exception 'ASSERTION FAILED: caretaker re-opened cancelled booking';
exception when raise_exception then
  if sqlerrm like 'ASSERTION%' then raise; end if;
end $$;

-- ---------- back to admin: audit trail ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.assert((select count(*) >= 1 from public.audit_logs where action = 'cancel' and actor_name = 'Sunil'), 'cancel audited with actor');
select pg_temp.assert((select cancelled_by = '00000000-0000-0000-0000-00000000000c' from public.bookings where id = '11111111-1111-1111-1111-111111111111'), 'cancelled_by stamped');
select pg_temp.assert((select count(*) >= 4 from public.audit_logs where table_name = 'bookings'), 'booking inserts audited');
select pg_temp.assert((select count(*) = 1 from public.expenses), 'admin sees expenses');
-- Admin may correct payments
delete from public.payments;
reset role;
select pg_temp.assert((select count(*) = 0 from public.payments), 'admin can delete payment');
select pg_temp.assert((select count(*) = 1 from public.audit_logs where table_name='payments' and action='delete'), 'payment delete audited');

-- ---------- atomic RPCs (as caretaker) ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select public.create_booking(
  jsonb_build_object('room_id', (select id from public.rooms where room_number = 3), 'booking_type', 'short_time',
    'guest_phone', '0770000000', 'guest_name', '  ', 'check_in_time', now() - interval '1 hour',
    'check_out_time', now() + interval '2 hours', 'room_charge', 1500, 'status', 'checked_in'),
  '{"amount": 500, "method": "cash"}', '[{"label":"තේ","unit_price":100,"quantity":3}]') as new_id \gset
select pg_temp.assert((select guest_name is null and actual_check_in_at is not null from public.bookings where id = :'new_id'), 'blank name stored as null, checked in stamped');
select pg_temp.assert((select sum(amount) = 500 from public.payments where booking_id = :'new_id'), 'advance saved atomically');
select pg_temp.assert((select sum(amount) = 300 from public.booking_addons where booking_id = :'new_id'), 'addons saved atomically');

-- overlapping create rolls back entirely (no orphan payment)
do $$ begin
  perform public.create_booking(
    jsonb_build_object('room_id', (select id from public.rooms where room_number = 3), 'booking_type', 'short_time',
      'guest_phone', '0771111111', 'check_in_time', now(), 'check_out_time', now() + interval '1 hour', 'room_charge', 1500),
    '{"amount": 999, "method": "cash"}');
  raise exception 'ASSERTION FAILED: overlap via rpc';
exception when exclusion_violation then null; end $$;
select pg_temp.assert((select count(*) = 0 from public.payments where amount = 999), 'no orphan payment');

select public.checkout_booking(:'new_id');
select pg_temp.assert((select status = 'checked_out' and check_out_time <= now() from public.bookings where id = :'new_id'), 'checkout shrinks slot');
select pg_temp.assert((select housekeeping = 'cleaning' from public.rooms where room_number = 3), 'room goes to cleaning');
reset role;
