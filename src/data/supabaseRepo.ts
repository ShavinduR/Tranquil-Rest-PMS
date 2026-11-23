import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AddonPreset, AuditLog, Booking, BookingAddon, Expense, Payment, PricingRule, Profile, Room, Settings, SlotIssue,
} from '../types';
import { NetworkError, SlotTakenError, type Repo, type Session } from './repo';

const BOOKING_SELECT = '*, payments(*), addons:booking_addons(*)';

const isNetworkFailure = (error: { message?: string } | null | undefined): boolean =>
  !navigator.onLine || /fetch|network|load failed/i.test(error?.message ?? '');

/** Wraps PostgREST errors into the domain errors the UI understands. */
const fail = (error: PostgrestError | Error): never => {
  if ('code' in error && error.code === '23P01') throw new SlotTakenError();
  if (isNetworkFailure(error)) throw new NetworkError(error);
  throw error;
};

const must = <T,>(res: { data: T | null; error: PostgrestError | null }): T => {
  if (res.error) fail(res.error);
  return res.data as T;
};

const num = (v: unknown): number => Number(v ?? 0);

type BookingRow = Omit<Booking, 'payments' | 'addons' | 'room_charge'> & {
  room_charge: unknown;
  payments: (Omit<Payment, 'amount'> & { amount: unknown })[] | null;
  addons: (Omit<BookingAddon, 'amount' | 'unit_price'> & { amount: unknown; unit_price: unknown })[] | null;
};

const toPayment = (p: Omit<Payment, 'amount'> & { amount: unknown }): Payment => ({ ...p, amount: num(p.amount) });

const toBooking = (row: BookingRow): Booking => ({
  ...row,
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
      return Boolean(must(await db.rpc('verify_pin', { p_pin: pin })));
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
      const rows = must(
        await db
          .from('bookings')
          .select(BOOKING_SELECT)
          .or(`and(check_in_time.lt.${to.toISOString()},check_out_time.gt.${from.toISOString()}),status.eq.checked_in`)
          .order('check_in_time'),
      ) as BookingRow[];
      return rows.map(toBooking);
    },
    async getBooking(id) {
      const row = must(await db.from('bookings').select(BOOKING_SELECT).eq('id', id).maybeSingle()) as BookingRow | null;
      return row ? toBooking(row) : null;
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
      const patch: Record<string, unknown> = { status: change.status };
      if (change.status === 'checked_in') patch.actual_check_in_at = new Date().toISOString();
      if (change.status === 'cancelled') patch.cancel_reason = change.reason;
      if (change.status === 'booked') Object.assign(patch, { cancelled_at: null, cancelled_by: null, cancel_reason: null });
      must(await db.from('bookings').update(patch).eq('id', id));
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

    async updateBooking(id, patch) {
      must(await db.from('bookings').update(patch).eq('id', id));
    },
    async deletePayment(id) {
      must(await db.from('payments').delete().eq('id', id));
    },
    async deleteAddon(id) {
      must(await db.from('booking_addons').delete().eq('id', id));
    },
    async listBookingsByCheckIn(from, to) {
      const rows = must(
        await db.from('bookings').select(BOOKING_SELECT)
          .gte('check_in_time', from.toISOString()).lt('check_in_time', to.toISOString()).order('check_in_time'),
      ) as BookingRow[];
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
        .subscribe();
      return () => {
        clearTimeout(timer);
        void db.removeChannel(channel);
      };
    },
  };
  return repo;
};
