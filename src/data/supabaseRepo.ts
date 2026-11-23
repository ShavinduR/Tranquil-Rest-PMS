import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AddonPreset, AuditLog, Booking, BookingAddon, Expense, Payment, PricingRule, Profile, Refund, Room, Settings, SlotIssue,
} from '../types';
import {
  BookingInPastError, DbUpgradeNeededError, NetworkError, PinLockedError, SlotTakenError,
  type BackupFile, type Repo, type RestoreReport, type Session,
} from './repo';

const BOOKING_SELECT = '*, payments(*), addons:booking_addons(*), refunds(*)';
/** For databases that predate migration 0007 (no refunds table). */
const LEGACY_BOOKING_SELECT = '*, payments(*), addons:booking_addons(*)';

/** PostgREST: function or table/relationship not in the schema (older database). */
const isMissingInSchema = (error: PostgrestError | null | undefined): boolean =>
  Boolean(error) &&
  (['PGRST202', 'PGRST200', 'PGRST205', '42P01', '42883'].includes(error!.code) ||
    /could not find (the function|a relationship|the table)|does not exist/i.test(error!.message));

const isNetworkFailure = (error: { message?: string } | null | undefined): boolean =>
  !navigator.onLine || /fetch|network|load failed/i.test(error?.message ?? '');

/** Wraps PostgREST errors into the domain errors the UI understands. */
const fail = (error: PostgrestError | Error): never => {
  if ('code' in error && error.code === '23P01') throw new SlotTakenError();
  if (/BOOKING_IN_PAST/.test(error.message)) throw new BookingInPastError();
  if (isNetworkFailure(error)) throw new NetworkError(error);
  throw error;
};

const must = <T,>(res: { data: T | null; error: PostgrestError | null }): T => {
  if (res.error) fail(res.error);
  return res.data as T;
};

const num = (v: unknown): number => Number(v ?? 0);

type MoneyRow<T> = Omit<T, 'amount'> & { amount: unknown };
type BookingRow = Omit<Booking, 'payments' | 'addons' | 'refunds' | 'room_charge'> & {
  refunds?: MoneyRow<Refund>[] | null;
  room_charge: unknown;
  payments: (Omit<Payment, 'amount'> & { amount: unknown })[] | null;
  addons: (Omit<BookingAddon, 'amount' | 'unit_price'> & { amount: unknown; unit_price: unknown })[] | null;
};

const toPayment = (p: Omit<Payment, 'amount'> & { amount: unknown }): Payment => ({ ...p, amount: num(p.amount) });

const toRefund = (r: MoneyRow<Refund>): Refund => ({ ...r, amount: num(r.amount) });

const toBooking = (row: BookingRow): Booking => ({
  ...row,
  refunds: (row.refunds ?? []).map(toRefund).sort((a, b) => a.refunded_at.localeCompare(b.refunded_at)),
  room_charge: num(row.room_charge),
  payments: (row.payments ?? []).map(toPayment).sort((a, b) => a.paid_at.localeCompare(b.paid_at)),
  addons: (row.addons ?? [])
    .map((a) => ({ ...a, amount: num(a.amount), unit_price: num(a.unit_price) }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at)),
});

export const createSupabaseRepo = (url: string, anonKey: string): Repo => {
  const db: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tr-auth' },
  });

  /** Calls the staff-admin Edge Function and surfaces its error message. */
  const invokeStaffAdmin = async <T,>(body: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.functions.invoke('staff-admin', { body });
    if (error) {
      const ctx = (error as { context?: unknown }).context;
      if (ctx instanceof Response) {
        const payload = (await ctx.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Server error (${ctx.status})`);
      }
      if (isNetworkFailure(error)) throw new NetworkError(error);
      throw new Error(
        /not found|404/i.test(error.message)
          ? 'The staff-admin server function is not deployed yet (see README → Managing staff accounts).'
          : error.message,
      );
    }
    return data as T;
  };

  // Bookings are read with their refunds; on a database without the refunds table
  // (migration 0007 not run yet) fall back to the old shape instead of failing.
  let hasRefunds = true;
  const bookingQuery = async <T,>(run: (select: string) => PromiseLike<{ data: T | null; error: PostgrestError | null }>): Promise<T> => {
    if (hasRefunds) {
      const res = await run(BOOKING_SELECT);
      if (!res.error || !isMissingInSchema(res.error)) return must(res);
      hasRefunds = false;
    }
    return must(await run(LEGACY_BOOKING_SELECT));
  };

  /** Calls a migration-0007 function; if the database is older, uses the legacy path (or explains). */
  const rpcOr = async (fn: string, args: Record<string, unknown>, legacy?: () => Promise<void>) => {
    const res = await db.rpc(fn, args);
    if (res.error && isMissingInSchema(res.error)) {
      if (legacy) return legacy();
      throw new DbUpgradeNeededError(fn);
    }
    must(res);
  };

  const uid = async (): Promise<string> => {
    const { data } = await db.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error('Not signed in');
    return id;
  };

  const repo: Repo = {
    kind: 'supabase',

    async getSession() {
      const { data } = await db.auth.getSession();
      const u = data.session?.user;
      return u ? { userId: u.id, email: u.email ?? null } : null;
    },
    onSessionChange(cb) {
      const { data } = db.auth.onAuthStateChange((_e, s) => {
        cb(s ? ({ userId: s.user.id, email: s.user.email ?? null } satisfies Session) : null);
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) fail(error);
    },
    async signOut() {
      await db.auth.signOut();
    },
    async getProfile() {
      const id = await uid();
      const data = must(await db.from('profiles').select('id, role, display_name, active').eq('id', id).maybeSingle());
      return (data as Profile | null) ?? null;
    },
    async verifyPin(pin) {
      const res = await db.rpc('verify_pin', { p_pin: pin });
      if (res.error?.code === 'PT429' || /PIN_LOCKED/.test(res.error?.message ?? '')) {
        throw new PinLockedError(Math.max(1, Number(res.error?.details) || 60));
      }
      return Boolean(must(res));
    },

    async loadReference() {
      const [rooms, pricing, settings, presets] = await Promise.all([
        db.from('rooms').select('*').order('room_number'),
        db.from('pricing_rules').select('*'),
        db.from('settings').select('property_name, property_phone, cleaning_buffer_minutes').eq('id', 1).single(),
        db.from('addon_presets').select('*').order('sort_order'),
      ]);
      return {
        rooms: must(rooms) as Room[],
        pricing: (must(pricing) as PricingRule[]).map((r) => ({ ...r, price: num(r.price) })),
        settings: must(settings) as Settings,
        presets: (must(presets) as AddonPreset[]).map((p) => ({ ...p, price: num(p.price) })),
      };
    },
    async listBookings(from, to) {
      const rows = (await bookingQuery((sel) =>
        db.from('bookings').select(sel)
          .or(`and(check_in_time.lt.${to.toISOString()},check_out_time.gt.${from.toISOString()}),status.eq.checked_in`)
          .order('check_in_time'),
      )) as unknown as BookingRow[];
      return rows.map(toBooking);
    },
    async getBooking(id) {
      const row = (await bookingQuery((sel) => db.from('bookings').select(sel).eq('id', id).maybeSingle())) as unknown as BookingRow | null;
      return row ? toBooking(row) : null;
    },
    async listBookingsByIds(ids) {
      const out: Booking[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const rows = (await bookingQuery((sel) => db.from('bookings').select(sel).in('id', chunk))) as unknown as BookingRow[];
        out.push(...rows.map(toBooking));
      }
      return out;
    },
    async listRefunds(from, to) {
      const res = await db.from('refunds').select('*').gte('refunded_at', from.toISOString()).lt('refunded_at', to.toISOString());
      if (res.error && isMissingInSchema(res.error)) return [];
      return (must(res) as MoneyRow<Refund>[]).map(toRefund);
    },
    async listPayments(from, to) {
      const rows = must(
        await db.from('payments').select('*').gte('paid_at', from.toISOString()).lt('paid_at', to.toISOString()),
      ) as (Omit<Payment, 'amount'> & { amount: unknown })[];
      return rows.map(toPayment);
    },
    async checkSlot(roomId, start, end, excludeId) {
      return must(
        await db.rpc('check_booking_slot', {
          p_room_id: roomId,
          p_start: start.toISOString(),
          p_end: end.toISOString(),
          p_exclude: excludeId ?? null,
        }),
      ) as SlotIssue[];
    },
    async findGuestName(phone) {
      const rows = must(
        await db.from('bookings').select('guest_name').eq('guest_phone', phone).not('guest_name', 'is', null)
          .order('created_at', { ascending: false }).limit(1),
      ) as { guest_name: string | null }[];
      return rows[0]?.guest_name ?? null;
    },

    async createBooking(input) {
      const { advance, addons, ...booking } = input;
      const id = must(await db.rpc('create_booking', { p_booking: booking, p_advance: advance, p_addons: addons })) as string;
      const created = await repo.getBooking(id);
      if (!created) throw new Error('Booking vanished after save');
      return created;
    },
    async setStatus(id, change) {
      if (change.status === 'checked_out') {
        must(await db.rpc('checkout_booking', { p_booking_id: id }));
        return;
      }
      // Caretaker changes go through audited database functions (migration 0007).
      // The legacy direct updates only run against an older database.
      const legacyUpdate = (patch: Record<string, unknown>) => async () => {
        must(await db.from('bookings').update(patch).eq('id', id));
      };
      if (change.status === 'checked_in') {
        await rpcOr('checkin_booking', { p_booking_id: id },
          legacyUpdate({ status: 'checked_in', actual_check_in_at: new Date().toISOString() }));
        return;
      }
      if (change.status === 'cancelled') {
        const refund = change.refund && change.refund.amount > 0 ? change.refund : null;
        await rpcOr(
          'cancel_booking',
          { p_booking_id: id, p_reason: change.reason, p_refund_amount: refund?.amount ?? 0, p_refund_method: refund?.method ?? null },
          refund ? undefined : legacyUpdate({ status: 'cancelled', cancel_reason: change.reason }),
        );
        return;
      }
      // Admin restoring a cancelled booking.
      must(await db.from('bookings').update({ status: 'booked', cancelled_at: null, cancelled_by: null, cancel_reason: null }).eq('id', id));
    },
    async addPayment(bookingId, p) {
      must(await db.from('payments').insert({ booking_id: bookingId, ...p, created_by: await uid() }));
    },
    async addAddons(bookingId, items) {
      if (items.length === 0) return;
      const created_by = await uid();
      must(await db.from('booking_addons').insert(items.map((i) => ({ booking_id: bookingId, created_by, ...i }))));
    },
    async setHousekeeping(roomId, state) {
      must(await db.rpc('set_room_housekeeping', { p_room_id: roomId, p_state: state }));
    },
    async extendBooking(id, newCheckOut, extraCharge) {
      await rpcOr('extend_booking', { p_booking_id: id, p_new_check_out: newCheckOut.toISOString(), p_extra_charge: extraCharge });
    },
    async moveBooking(id, roomId) {
      await rpcOr('move_booking', { p_booking_id: id, p_new_room_id: roomId });
    },
    async setNotes(id, notes) {
      await rpcOr('set_booking_notes', { p_booking_id: id, p_notes: notes });
    },

    async updateBooking(id, patch) {
      must(await db.from('bookings').update(patch).eq('id', id));
    },
    async deletePayment(id) {
      must(await db.from('payments').delete().eq('id', id));
    },
    async deleteAddon(id) {
      must(await db.from('booking_addons').delete().eq('id', id));
    },
    async deleteRefund(id) {
      must(await db.from('refunds').delete().eq('id', id));
    },
    async listBookingsByCheckIn(from, to) {
      const rows = (await bookingQuery((sel) =>
        db.from('bookings').select(sel)
          .gte('check_in_time', from.toISOString()).lt('check_in_time', to.toISOString()).order('check_in_time'),
      )) as unknown as BookingRow[];
      return rows.map(toBooking);
    },
    async listExpenses(fromDate, toDateExclusive) {
      const rows = must(
        await db.from('expenses').select('*').gte('expense_date', fromDate).lt('expense_date', toDateExclusive)
          .order('expense_date', { ascending: false }),
      ) as (Omit<Expense, 'amount'> & { amount: unknown })[];
      return rows.map((e) => ({ ...e, amount: num(e.amount) }));
    },
    async addExpense(e) {
      must(await db.from('expenses').insert(e));
    },
    async deleteExpense(id) {
      must(await db.from('expenses').delete().eq('id', id));
    },
    async updateRoom(id, patch) {
      must(await db.from('rooms').update(patch).eq('id', id));
    },
    async updatePricing(id, patch) {
      must(await db.from('pricing_rules').update(patch).eq('id', id));
    },
    async updateSettings(patch) {
      must(await db.from('settings').update(patch).eq('id', 1));
    },
    async upsertPreset(p) {
      must(await db.from('addon_presets').upsert(p));
    },
    async listAudit({ limit, before, table }) {
      let q = db.from('audit_logs').select('*').order('id', { ascending: false }).limit(limit);
      if (before) q = q.lt('id', before);
      if (table) q = q.eq('table_name', table);
      return must(await q) as AuditLog[];
    },
    async listStaff() {
      return must(await db.from('profiles').select('id, role, display_name, active').order('created_at')) as Profile[];
    },
    async updateStaff(id, patch) {
      must(await db.from('profiles').update(patch).eq('id', id));
    },
    async setStaffPin(id, pin) {
      must(await db.rpc('set_staff_pin', { p_user_id: id, p_pin: pin }));
    },

    async createStaff(input) {
      return await invokeStaffAdmin<{ user_id: string; email: string }>({ action: 'create', ...input });
    },
    async resetStaffPassword(id, password) {
      await invokeStaffAdmin({ action: 'reset_password', user_id: id, password });
    },
    async rotateBackupKey() {
      return must(await db.rpc('rotate_backup_key')) as string;
    },
    async backupKeyStatus() {
      const rows = must(await db.rpc('backup_key_status')) as { created_at: string; last_used: string | null }[];
      return rows[0] ?? null;
    },

    async exportAll() {
      return must(await db.rpc('export_backup_admin')) as BackupFile;
    },
    async restoreBackup(file, mode, dryRun, confirm) {
      return must(await db.rpc('restore_backup', { p_backup: file, p_mode: mode, p_dry_run: dryRun, p_confirm: confirm ?? null })) as RestoreReport;
    },

    subscribe(cb) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const debounced = () => {
        clearTimeout(timer);
        timer = setTimeout(cb, 300);
      };
      const channel = db
        .channel('pms-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_addons' }, debounced)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'refunds' }, debounced)
        .subscribe();
      return () => {
        clearTimeout(timer);
        void db.removeChannel(channel);
      };
    },
  };
  return repo;
};
