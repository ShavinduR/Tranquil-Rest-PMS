-- Simulates a live database that already ran migrations 0001–0006 and has real data,
-- BEFORE the newest migration is applied. Used by run_local.sh's upgrade check.
\set ON_ERROR_STOP 1
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-00000000000a', 'owner@live.example', '{"display_name":"Owner"}'),
  ('10000000-0000-0000-0000-00000000000c', 'sunil@live.example', '{"display_name":"Sunil"}');
update public.profiles set role = 'admin', active = true where id = '10000000-0000-0000-0000-00000000000a';
update public.profiles set active = true where id = '10000000-0000-0000-0000-00000000000c';

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-00000000000a', false);
select public.set_staff_pin('10000000-0000-0000-0000-00000000000c', '1357');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-00000000000c', false);
-- a future booking with an advance and food, a guest in the room now, a checked-out stay
select public.create_booking(
  jsonb_build_object('room_id', (select id from public.rooms where room_number = 1), 'booking_type', 'day',
    'guest_phone', '0771112222', 'guest_name', 'සමන්', 'check_in_time', now() + interval '2 days', 'check_out_time', now() + interval '2 days 9 hours', 'room_charge', 2000),
  '{"amount": 1000, "method": "cash"}', '[{"label":"තේ","unit_price":100,"quantity":2}]');
select public.create_booking(
  jsonb_build_object('room_id', (select id from public.rooms where room_number = 2), 'booking_type', 'short_time',
    'guest_phone', '0773334444', 'check_in_time', now() - interval '20 minutes', 'check_out_time', now() + interval '2 hours', 'room_charge', 1500, 'status', 'checked_in'),
  '{"amount": 1500, "method": "bank"}');
select public.create_booking(
  jsonb_build_object('room_id', (select id from public.rooms where room_number = 3), 'booking_type', 'short_time',
    'guest_phone', '0775556666', 'check_in_time', now() - interval '10 minutes', 'check_out_time', now() + interval '3 hours', 'room_charge', 1500, 'status', 'checked_in'));
select public.checkout_booking((select id from public.bookings where guest_phone = '0775556666'));
-- caretaker-era direct cancel (allowed before 0007)
select public.create_booking(
  jsonb_build_object('room_id', (select id from public.rooms where room_number = 4), 'booking_type', 'night',
    'guest_phone', '0777778888', 'check_in_time', now() + interval '1 day', 'check_out_time', now() + interval '1 day 14 hours', 'room_charge', 2500),
  '{"amount": 500, "method": "cash"}');
update public.bookings set status = 'cancelled', cancel_reason = 'no-show' where guest_phone = '0777778888';

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-00000000000a', false);
insert into public.expenses (expense_type, category, amount, expense_date) values ('fixed', 'Water', 1800, current_date);
reset role;

create table public.__before as
select (select count(*) from public.bookings) b, (select count(*) from public.payments) p,
       (select count(*) from public.booking_addons) a, (select count(*) from public.expenses) e,
       (select count(*) from public.audit_logs) l, (select count(*) from public.profiles) pr,
       (select sum(amount) from public.payments) money;
