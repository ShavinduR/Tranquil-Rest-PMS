-- After applying the newest migration on top of upgrade_fixtures.sql.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'UPGRADE ASSERTION FAILED: %', msg; end if; end $$;

select pg_temp.assert((select b from public.__before) = (select count(*) from public.bookings), 'no bookings lost');
select pg_temp.assert((select p from public.__before) = (select count(*) from public.payments), 'no payments lost');
select pg_temp.assert((select money from public.__before) = (select sum(amount) from public.payments), 'payment totals unchanged');
select pg_temp.assert((select a from public.__before) = (select count(*) from public.booking_addons), 'no food items lost');
select pg_temp.assert((select e from public.__before) = (select count(*) from public.expenses), 'no expenses lost');
select pg_temp.assert((select l from public.__before) <= (select count(*) from public.audit_logs), 'audit history kept');
select pg_temp.assert((select pr from public.__before) = (select count(*) from public.profiles), 'staff kept');
select pg_temp.assert((select count(*) = 0 from public.refunds), 'refunds table created empty');

-- Existing data keeps working with the new rules
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-00000000000c', false);
select pg_temp.assert(public.verify_pin('1357'), 'existing PIN still works');
select public.checkout_booking((select id from public.bookings where guest_phone = '0773334444'));
select pg_temp.assert((select status = 'checked_out' from public.bookings where guest_phone = '0773334444'), 'checked-in guest can be checked out');
select public.cancel_booking((select id from public.bookings where guest_phone = '0771112222'), 'changed plans', 1000, 'cash');
select pg_temp.assert((select status = 'cancelled' from public.bookings where guest_phone = '0771112222'), 'old booking cancellable with refund');
select pg_temp.assert((select count(*) = 1 from public.refunds), 'refund recorded on old booking');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-00000000000a', false);
select pg_temp.assert(jsonb_array_length(public.export_backup_admin() -> 'refunds') = 1, 'backup includes refunds after upgrade');
reset role;
drop table public.__before;
