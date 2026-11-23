-- Restore behaviour. Runs after tests.sql (same database).
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;
create temp table snap (j jsonb);
grant all on snap to authenticated;
create temp table rep (j jsonb);
grant all on rep to authenticated;

-- Admin takes a safety snapshot
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into snap select public.export_backup_admin();
reset role;
select count(*) as n_book from public.bookings \gset
select count(*) as n_pay from public.payments \gset
select count(*) as n_audit from public.audit_logs \gset

-- Caretaker can neither export nor restore
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin perform public.export_backup_admin(); raise exception 'ASSERTION FAILED: caretaker exported';
exception when raise_exception then if sqlerrm like 'ASSERTION%' then raise; end if; end $$;
do $$ begin perform public.restore_backup((select j from snap), 'merge', false); raise exception 'ASSERTION FAILED: caretaker restored';
exception when raise_exception then if sqlerrm like 'ASSERTION%' then raise; end if; end $$;
reset role;

-- Simulate an accident: lose a booking with its payments/add-ons, plus an expense
delete from public.booking_addons where booking_id = (select id from public.bookings where guest_phone = '0770000000');
delete from public.payments where booking_id = (select id from public.bookings where guest_phone = '0770000000');
delete from public.bookings where guest_phone = '0770000000';
delete from public.expenses;
select pg_temp.assert((select count(*) = :n_book - 1 from public.bookings), 'booking lost');

-- Dry-run merge reports but changes nothing
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into rep select public.restore_backup((select j from snap), 'merge', true);
reset role;
select pg_temp.assert((select (j -> 'tables' -> 'bookings' ->> 'restored')::int = 1 from rep), 'dry run counts 1 booking');
select pg_temp.assert((select (j ->> 'dry_run')::boolean from rep), 'dry run flagged');
select pg_temp.assert((select count(*) = :n_book - 1 from public.bookings), 'dry run changed nothing');
select pg_temp.assert((select count(*) = 0 from public.audit_logs where action like 'restore%'), 'dry run left no audit row');
select pg_temp.assert((select count(*) = 0 from pg_trigger where tgrelid = 'public.bookings'::regclass and not tgisinternal and tgenabled = 'D'), 'triggers enabled after dry run');

-- Real merge puts back exactly the missing rows
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
delete from rep;
insert into rep select public.restore_backup((select j from snap), 'merge', false);
reset role;
select pg_temp.assert((select count(*) = :n_book from public.bookings), 'booking restored');
select pg_temp.assert((select count(*) = :n_pay from public.payments), 'payment restored');
select pg_temp.assert((select count(*) = 1 from public.expenses), 'expense restored');
select pg_temp.assert((select (j -> 'tables' -> 'bookings' ->> 'skipped')::int = :n_book - 1 from rep), 'existing bookings skipped');
select pg_temp.assert((select created_by = '00000000-0000-0000-0000-00000000000c' from public.bookings where guest_phone = '0770000000'), 'original author kept');
select pg_temp.assert((select count(*) = 1 from public.audit_logs where action = 'restore_merge' and actor_name = 'Owner'), 'merge audited once');
select pg_temp.assert((select count(*) = 0 from pg_trigger where tgrelid = 'public.bookings'::regclass and not tgisinternal and tgenabled = 'D'), 'triggers re-enabled');

-- Merge skips a backed-up booking whose slot is now taken by a newer booking
delete from public.booking_addons where booking_id = '11111111-1111-1111-1111-111111111111';
delete from public.bookings where id = '11111111-1111-1111-1111-111111111111';
delete from public.bookings where guest_phone = '0711111111';
insert into public.bookings (room_id, booking_type, guest_phone, check_in_time, check_out_time, room_charge)
select id, 'short_time', '0719999999', '2026-12-01 13:00+05:30', '2026-12-01 14:00+05:30', 1500 from public.rooms where room_number = 1;
create temp table snap2 as select jsonb_set(j, '{bookings}', (
  select jsonb_agg(case when b ->> 'id' = '11111111-1111-1111-1111-111111111111' then jsonb_set(b, '{status}', '"booked"') else b end)
  from jsonb_array_elements(j -> 'bookings') b)) as j from snap;
grant all on snap2 to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
delete from rep;
insert into rep select public.restore_backup((select j from snap2), 'merge', false);
reset role;
select pg_temp.assert(not exists (select 1 from public.bookings where id = '11111111-1111-1111-1111-111111111111'), 'clashing booking skipped');
select pg_temp.assert(exists (select 1 from public.bookings where guest_phone = '0711111111'), 'non-clashing booking restored');
select pg_temp.assert(exists (select 1 from public.bookings where guest_phone = '0719999999'), 'newer booking untouched');

-- Replace needs the confirmation phrase
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin perform public.restore_backup((select j from snap), 'replace', false); raise exception 'ASSERTION FAILED: replace without confirm';
exception when raise_exception then if sqlerrm like 'ASSERTION%' then raise; end if; end $$;
-- Replace with confirmation gives exactly the snapshot back
update public.settings set cleaning_buffer_minutes = 45;
delete from rep;
insert into rep select public.restore_backup((select j from snap), 'replace', false, 'REPLACE ALL DATA');
reset role;
select pg_temp.assert((select count(*) = :n_book from public.bookings), 'replace: booking count matches snapshot');
select pg_temp.assert(not exists (select 1 from public.bookings where guest_phone = '0719999999'), 'replace removed post-backup booking');
select pg_temp.assert(exists (select 1 from public.bookings where id = '11111111-1111-1111-1111-111111111111' and status = 'cancelled'), 'replace restored cancelled booking');
select pg_temp.assert((select cleaning_buffer_minutes = 30 from public.settings), 'replace restored settings');
select pg_temp.assert((select count(*) = :n_audit + 1 from public.audit_logs), 'audit = snapshot history + 1 restore entry');
select pg_temp.assert((select sum(amount) = 500 from public.booking_addons where booking_id = (select id from public.bookings where guest_phone = '0770000000')) is null
                      or (select sum(amount) = 300 from public.booking_addons where booking_id = (select id from public.bookings where guest_phone = '0770000000')), 'generated amount recomputed');

-- Triggers work again after replace: an edit is audited and touched
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update public.bookings set notes = 'after restore' where guest_phone = '0712222222';
reset role;
select pg_temp.assert((select count(*) = 1 from public.audit_logs where new_data ->> 'notes' = 'after restore'), 'audit trigger live after replace');
select pg_temp.assert((select max(id) from public.audit_logs) > :n_audit, 'audit id sequence ahead of restored ids');

-- Moving to a project where a user does not exist: references nulled, user reported
create temp table snap3 as select jsonb_set(
  jsonb_set(j, '{profiles}', (j -> 'profiles') || '[{"id":"00000000-0000-0000-0000-0000000000ff","role":"caretaker","display_name":"Old Staff","active":true}]'),
  '{bookings}', (select jsonb_agg(jsonb_set(b, '{created_by}', '"00000000-0000-0000-0000-0000000000ff"')) from jsonb_array_elements(j -> 'bookings') b)) as j from snap;
delete from rep;
insert into rep select public.restore_backup((select j from snap3), 'replace', false, 'REPLACE ALL DATA');  -- as postgres (CLI path)
select pg_temp.assert((select count(*) = 0 from public.bookings where created_by is not null), 'unknown author nulled');
select pg_temp.assert((select j -> 'missing_users' -> 0 ->> 'display_name' = 'Old Staff' from rep), 'missing user reported');
select pg_temp.assert((select role = 'admin' from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 'admin kept admin');

-- Not a backup file
do $$ begin perform public.restore_backup('{"hello":1}', 'merge', true); raise exception 'ASSERTION FAILED: accepted junk';
exception when raise_exception then if sqlerrm like 'ASSERTION%' then raise; end if; end $$;
