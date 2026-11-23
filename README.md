# Tranquil Rest PMS

A lightweight property management PWA for **Tranquil Rest**, a 5-room guest house in Sri Lanka.

- **Caretaker mode:** 100% Sinhala, unlocked with a 4-digit PIN. Traffic-light room cards, today/tomorrow alerts, a walk-in or future booking in about 15 seconds, food add-ons, payments, a WhatsApp confirmation link and the day's cash handover total.
- **Admin mode:** English dashboard for the owner. Revenue (cash/bank/pending), fixed and variable expenses, net profit, occupancy, booking management, pricing/room/preset settings, staff PINs, a full audit log and monthly CSV exports that open in Excel.

Stack: React 18 · Vite · TypeScript · Tailwind CSS 4 · vite-plugin-pwa · Supabase (Postgres, Auth, RLS, Realtime) · Vercel.

## Try it now (demo mode)

```bash
npm install
npm run dev
```

With no Supabase keys the app runs in **demo mode**, with sample data stored in your browser.
Choose *Caretaker device* (PIN `1234`) or *Owner / Admin login*. Any email works; one starting with `admin` signs you in as the owner.

## Go live

1. **Create a Supabase project** (region: Singapore `ap-southeast-1` is closest to Sri Lanka).
2. **Run the SQL** in *SQL Editor*, in this order:
   - `supabase/migrations/20261123000001_init.sql`
   - `supabase/migrations/20261123000002_booking_rpcs.sql`
   - `supabase/migrations/20261123000003_backup_export.sql`
   - `supabase/migrations/20261123000004_restore_backup.sql`
   - `supabase/migrations/20261123000005_audit_staff.sql`
   - `supabase/seed.sql` (5 Non-AC rooms, default prices, food presets)

   Or with the Supabase CLI: `supabase link` then `supabase db push`.
3. **Create the owner account** in *Authentication → Users → Add user* (tick *Auto confirm*):
   - the owner (e.g. `owner@yourmail.com`), then in *SQL Editor*:
     `update profiles set role = 'admin', display_name = 'Owner' where id = (select id from auth.users where email = 'owner@yourmail.com');`
   - caretakers are added later from the app: *Admin → Settings → Staff & PINs → Add staff member*.
4. **Set environment variables** (`.env` locally, Vercel → Settings → Environment Variables):
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
5. **Deploy the `staff-admin` server function** (powers *Add staff member* / *Reset password*):
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase functions deploy staff-admin
   ```
   Or in the dashboard: *Edge Functions → Deploy a new function → Via editor*, name it `staff-admin`, and add both files from
   `supabase/functions/staff-admin/` (`index.ts`, `handler.ts`). Supabase supplies the keys it needs automatically.
6. **Deploy to Vercel**: import the repo. Framework is Vite, build command `npm run build`, output folder `dist`. `vercel.json` already handles SPA routing and service-worker caching.
7. **Set up the caretaker phone:** sign in as the owner → *Settings → Staff & PINs* → **Add staff member** (name + PIN) → note the sign-in details shown.
   On the caretaker's phone, open the site → *Caretaker device* → sign in **once** with the caretaker account → *Add to Home screen*.
   From then on the caretaker only uses the PIN. The app re-locks on every launch and after 10 idle minutes.

8. **Turn on nightly Google backups** (Sheet + Drive): see [`backup/README.md`](backup/README.md). Restoring is done from *Admin → Restore*, or with `npm run restore` (same README).

## Managing staff accounts

Everything is in *Admin → Settings → Staff & PINs*:

| Task | How |
|---|---|
| Add a caretaker or admin | **Add staff member** → name, role, 4-digit PIN (caretakers). A password is generated, and a login email is created from the name unless you tick *Use their own email*. The sign-in details are shown **once**: copy them or write them down. |
| Sign a new caretaker's phone in | On their phone: open the app → *Caretaker device* → enter the email and password once. From then on they only use the PIN. |
| Forgotten password | **Reset password** on that person → a new password is shown once. The PIN is unchanged. |
| Set or change a PIN | Type 4 digits → key button. Works immediately on every device. |
| Rename / change role | Edit the name, or switch Caretaker ↔ Admin. |
| Sign a phone out (at the phone) | Lock it → on the PIN screen tap *මෙම දුරකථනයෙන් ඉවත් වන්න · Sign out this device* → confirm. |
| Lock someone out remotely (lost phone, staff left) | Untick **Active**. Their phone signs out within ~2 minutes (or as soon as it reconnects), and the database refuses their requests immediately. Their history is kept. |
| Delete a login for good | Supabase → *Authentication → Users*. Deactivating is usually better because it keeps their name on past records. |
| Owner signing out | Admin sidebar → sign-out icon (top). |

Every staff change (added, renamed, role, active, PIN changed) appears in the **Audit log**. The PIN itself is never stored there.

**How Add staff member stays safe:** creating logins needs Supabase's service-role key, which must never be in the app.
So the `staff-admin` server function holds it, first checks that the caller is an active admin, and only then
creates the login. Name, role and PIN are written with the admin's own permissions (normal database rules apply), and a
half-created login is deleted if any step fails.

## How the business rules are enforced

| Rule | Where |
|---|---|
| No double-booking (`NewStart < ExistingEnd AND NewEnd > ExistingStart`) | Postgres `EXCLUDE USING gist` constraint on non-cancelled bookings. It cannot be bypassed, even by two phones at once |
| Cleaning buffer (default 30 min, configurable) | `check_booking_slot()` RPC and the form: rooms inside the buffer turn orange and ask for confirmation |
| Prices are never hard-coded | `pricing_rules` table per category (`non_ac` / `ac`) × booking type. AC prices are pre-seeded, so switching a room to AC is one dropdown |
| Caretaker can't hard-delete, see expenses/audit, or edit prices | Row Level Security. There is no DELETE policy on bookings for anyone; payments/add-ons can only be deleted by admins |
| Caretaker sees only operational data | Bookings are visible only while active or for 2 days after, so they can't rebuild monthly sales |
| Soft delete + audit trail | `status = 'cancelled'`; a trigger on every table writes who did what, before/after JSON, to `audit_logs` |
| Atomic saves | `create_booking()` saves the booking, advance and add-ons in one transaction; `checkout_booking()` checks the guest out and sends the room to Cleaning together |
| PIN security | bcrypt in `profiles.pin_hash` (not readable by clients), checked via `verify_pin()`. Offline unlock uses a salted SHA-256 saved after the last online unlock. 5 wrong tries = 30 s lockout |
| Offline safety | The app shell is precached by the service worker. Today ±1 day through +7 days of bookings are cached locally. When offline a red banner shows and every write button is disabled |
| Sri Lanka time | All times are `timestamptz`; the UI converts with a fixed UTC+05:30 offset, so a phone set to the wrong timezone still shows correct times |

**Money definitions** (Admin dashboard)
- *Collected* = payments received in the month (Cash / Bank).
- *Billed* = room charges + food for stays that **started** in the month (cancelled bookings excluded).
- *Pending balances* = billed − paid, for those stays.
- *Net profit* = Collected − (Fixed + Variable expenses), on a cash basis.
- Advances on cancelled bookings stay as collected income (treated as non-refundable).

## Development

```bash
npm test            # unit tests: domain logic (time, pricing, conflicts, finance, WhatsApp, CSV) + staff-admin function
npm run test:sql    # applies migrations to a throwaway local Postgres and tests RLS/constraints/triggers
npm run typecheck
npm run build
node scripts/make-icons.mjs   # regenerate PWA icons from public/favicon.svg
```

Project layout:

```
supabase/migrations   schema, RLS, triggers, RPCs
supabase/tests        Postgres behaviour tests (run_local.sh)
src/lib               pure domain logic (Colombo time, pricing, conflicts, finance…) + tests
src/data              Repo interface, Supabase + demo implementations, offline cache, live data provider
src/i18n/si.ts        every Sinhala string in one place
src/caretaker         caretaker screens
src/admin             admin screens
```
