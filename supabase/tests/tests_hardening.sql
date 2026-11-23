-- Migration 0007 (production hardening). Runs after tests.sql and tests_restore.sql.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;

-- Reusable "this must fail with SQLSTATE x" helper.
create or replace function pg_temp.expect_error(p_sql text, p_state text, msg text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ASSERTION FAILED: % (no error)', msg;
exception when others then
  if sqlerrm like 'ASSERTION FAILED%' then raise; end if;
  if sqlstate <> p_state then raise exception 'ASSERTION FAILED: % (got % %)', msg, sqlstate, sqlerrm; end if;
end $$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.assert(boolean, text) to authenticated;

-- Fresh fixtures in rooms 4 and 5, far enough ahead not to clash with earlier tests.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update public.rooms set active = true;
insert into public.bookings (id, room_id, booking_type, guest_phone, check_in_time, check_out_time, room_charge, status, created_by)
select 'aaaaaaaa-0000-0000-0000-000000000001', id, 'day', '0771234567', '2027-02-01 08:00+05:30', '2027-02-01 17:00+05:30', 2000, 'booked',
       '00000000-0000-0000-0000-00000000000c' from public.rooms where room_number = 4;
insert into public.bookings (id, room_id, booking_type, guest_phone, check_in_time, check_out_time, room_charge, status, created_by)
select 'aaaaaaaa-0000-0000-0000-000000000002', id, 'night', '0771234568', '2027-02-01 18:00+05:30', '2027-02-02 08:00+05:30', 2500, 'booked',
       '00000000-0000-0000-0000-00000000000c' from public.rooms where room_number = 5;
insert into public.payments (booking_id, kind, method, amount, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'advance', 'cash', 1500, '00000000-0000-0000-0000-00000000000c');

-- ================= caretaker =================
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);

-- Direct edits are refused (42501 = row-level security)
select pg_temp.expect_error($$update public.bookings set room_charge = 1 where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, '42501', 'caretaker cannot change price');
select pg_temp.expect_error($$update public.bookings set check_out_time = check_out_time + interval '5 hours' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, '42501', 'caretaker cannot change times directly');
select pg_temp.expect_error($$update public.bookings set room_id = (select id from public.rooms where room_number = 1) where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, '42501', 'caretaker cannot move room directly');
select pg_temp.expect_error($$update public.bookings set status = 'checked_in' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, '42501', 'caretaker cannot change status directly');
select pg_temp.expect_error($$update public.bookings set notes = 'x' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, '42501', 'caretaker cannot edit notes directly');

-- The marker never outlives the function call, even inside one transaction
begin;
select public.set_booking_notes('aaaaaaaa-0000-0000-0000-000000000001', 'Late arrival ~ 9am');
select pg_temp.expect_error($$update public.bookings set room_charge = 1 where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, '42501', 'marker reset after function');
commit;

-- Notes
select pg_temp.assert((select notes = 'Late arrival ~ 9am' from public.bookings where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'notes saved via function');
select pg_temp.expect_error($$select public.set_booking_notes('aaaaaaaa-0000-0000-0000-000000000001', repeat('x', 501))$$, 'P0001', 'notes length limited');

-- Extend: later + extra charge; never earlier; never negative; overlap rejected
select public.extend_booking('aaaaaaaa-0000-0000-0000-000000000001', '2027-02-01 17:30+05:30', 300);
select pg_temp.assert((select check_out_time = '2027-02-01 17:30+05:30' and room_charge = 2300 from public.bookings where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'extended with extra charge');
select pg_temp.expect_error($$select public.extend_booking('aaaaaaaa-0000-0000-0000-000000000001', '2027-02-01 16:00+05:30')$$, 'P0001', 'cannot shorten via extend');
select pg_temp.expect_error($$select public.extend_booking('aaaaaaaa-0000-0000-0000-000000000001', '2027-02-01 18:30+05:30', -5)$$, 'P0001', 'negative extra rejected');

-- Move room: into the room with the night booking at overlapping time is rejected; to a free room works
select public.extend_booking('aaaaaaaa-0000-0000-0000-000000000001', '2027-02-01 19:00+05:30');
select pg_temp.expect_error($$select public.move_booking('aaaaaaaa-0000-0000-0000-000000000001', (select id from public.rooms where room_number = 5))$$, '23P01', 'move into overlapping room rejected');
select public.move_booking('aaaaaaaa-0000-0000-0000-000000000001', (select id from public.rooms where room_number = 2));
select pg_temp.assert((select r.room_number = 2 from public.bookings b join public.rooms r on r.id = b.room_id where b.id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'moved to room 2');

-- Check-in via function; only from booked
select public.checkin_booking('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.assert((select status = 'checked_in' and actual_check_in_at is not null from public.bookings where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'checked in via function');
select pg_temp.expect_error($$select public.checkin_booking('aaaaaaaa-0000-0000-0000-000000000001')$$, 'P0001', 'cannot check in twice');

-- Caretaker cannot cancel a guest who is already in the room
select pg_temp.expect_error($$select public.cancel_booking('aaaaaaaa-0000-0000-0000-000000000001', 'x')$$, 'P0001', 'caretaker cannot cancel checked-in booking');

-- Refunds: never directly, only through cancel_booking, never more than was paid
select pg_temp.expect_error($$insert into public.refunds (booking_id, method, amount) values ('aaaaaaaa-0000-0000-0000-000000000001', 'cash', 100)$$, '42501', 'caretaker cannot insert refunds directly');
insert into public.payments (booking_id, kind, method, amount) values ('aaaaaaaa-0000-0000-0000-000000000002', 'advance', 'bank', 1000);
select pg_temp.expect_error($$select public.cancel_booking('aaaaaaaa-0000-0000-0000-000000000002', 'x', 1500, 'bank')$$, 'P0001', 'refund above paid rejected');
select pg_temp.expect_error($$select public.cancel_booking('aaaaaaaa-0000-0000-0000-000000000002', 'x', 500)$$, 'P0001', 'refund needs a method');
select public.cancel_booking('aaaaaaaa-0000-0000-0000-000000000002', 'plans changed', 600, 'bank');
select pg_temp.assert((select status = 'cancelled' and cancel_reason = 'plans changed' from public.bookings where id = 'aaaaaaaa-0000-0000-0000-000000000002'), 'cancelled via function');
select pg_temp.assert((select sum(amount) = 600 from public.refunds where booking_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 'refund recorded');

-- Bookings starting in the past are refused for caretakers (60 min grace for late walk-in entry)
select pg_temp.expect_error($$select public.create_booking(jsonb_build_object('room_id', (select id from public.rooms where room_number = 1), 'booking_type', 'short_time',
  'guest_phone', '0770000001', 'check_in_time', now() - interval '2 hours', 'check_out_time', now() + interval '1 hour', 'room_charge', 1500))$$, 'P0001', 'past start rejected');
select pg_temp.expect_error($$insert into public.bookings (room_id, booking_type, guest_phone, check_in_time, check_out_time, room_charge)
  select id, 'short_time', '0770000002', now() - interval '3 hours', now() - interval '1 hour', 1500 from public.rooms where room_number = 1$$, 'P0001', 'past start rejected on direct insert');

-- International numbers (8–15 digits) accepted; too short rejected
select public.create_booking(jsonb_build_object('room_id', (select id from public.rooms where room_number = 1), 'booking_type', 'full_day',
  'guest_phone', '+4915123456789', 'check_in_time', '2027-03-01 12:00+05:30', 'check_out_time', '2027-03-02 12:00+05:30', 'room_charge', 3500));
select pg_temp.assert((select count(*) = 1 from public.bookings where guest_phone = '+4915123456789'), 'international number stored');
select pg_temp.expect_error($$select public.create_booking(jsonb_build_object('room_id', (select id from public.rooms where room_number = 1), 'booking_type', 'full_day',
  'guest_phone', '+1234567', 'check_in_time', '2027-03-05 12:00+05:30', 'check_out_time', '2027-03-06 12:00+05:30', 'room_charge', 3500))$$, '23514', 'too-short number rejected');

-- ================= PIN rate limiting =================
select pg_temp.assert(public.verify_pin('4826'), 'correct PIN ok');
select pg_temp.assert(not public.verify_pin('0000'), 'wrong 1');
select pg_temp.assert(not public.verify_pin('0000'), 'wrong 2');
select pg_temp.assert(not public.verify_pin('0000'), 'wrong 3');
select pg_temp.assert(not public.verify_pin('0000'), 'wrong 4');
select pg_temp.assert(not public.verify_pin('0000'), 'wrong 5 (locks)');
select pg_temp.expect_error($$select public.verify_pin('4826')$$, 'PT429', 'locked even with the right PIN');
reset role;
select pg_temp.assert((select locked_until between now() + interval '55 seconds' and now() + interval '61 seconds' from private.pin_attempts
  where user_id = '00000000-0000-0000-0000-00000000000c'), 'first lock is 60 s');
-- Second lock doubles
update private.pin_attempts set locked_until = now() - interval '1 second' where user_id = '00000000-0000-0000-0000-00000000000c';
set role authenticated;
select public.verify_pin('1') from generate_series(1, 5);
reset role;
select pg_temp.assert((select locked_until > now() + interval '110 seconds' from private.pin_attempts
  where user_id = '00000000-0000-0000-0000-00000000000c'), 'second lock is 120 s');
-- After the lock ends, the right PIN works and clears the record
update private.pin_attempts set locked_until = now() - interval '1 second' where user_id = '00000000-0000-0000-0000-00000000000c';
set role authenticated;
select pg_temp.assert(public.verify_pin('4826'), 'right PIN after lock expires');
reset role;
select pg_temp.assert(not exists (select 1 from private.pin_attempts where user_id = '00000000-0000-0000-0000-00000000000c'), 'success clears attempts');
set role authenticated;
select pg_temp.expect_error($$select * from private.pin_attempts$$, '42501', 'attempt table not readable by clients');

-- ================= admin =================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update public.bookings set room_charge = 2222 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.assert((select room_charge = 2222 from public.bookings where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'admin keeps full edit rights');
select pg_temp.assert((select count(*) >= 1 from public.audit_logs where table_name = 'refunds' and action = 'insert'), 'refund audited');
select pg_temp.assert((select count(*) >= 1 from public.audit_logs where table_name = 'bookings' and action = 'cancel' and record_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 'cancel audited');
select pg_temp.assert(jsonb_array_length(public.export_backup_admin() -> 'refunds') >= 1, 'backup includes refunds');

-- Restore (merge) brings back a deleted refund
create temp table snap7 as select public.export_backup_admin() as j;
grant select on snap7 to authenticated;
delete from public.refunds;
select pg_temp.assert((public.restore_backup((select j from snap7), 'merge', false) -> 'tables' -> 'refunds' ->> 'restored')::int >= 1, 'refund restored by merge');
-- Older backups without a refunds key still restore
select pg_temp.assert((public.restore_backup((select j - 'refunds' from snap7), 'merge', true) -> 'tables' -> 'refunds' ->> 'restored')::int = 0, 'old backup without refunds ok');
reset role;
