/**
 * Browser-only backend used when no Supabase project is configured. It enforces
 * the same rules as the database (overlap guard, soft delete, audit trail) so
 * the owner can try the full app before going live. Data lives in localStorage.
 */
import type {
  Refund,
  AddonPreset, AuditLog, Booking, Expense, Payment, PricingRule, Profile, Room, Settings,
} from '../types';
import { findSlotIssues, hasOverlap } from '../lib/conflicts';
import { addMinutes, atClock, addDaysKey, dateKey, colomboParts } from '../lib/time';
import { BACKUP_FORMAT, BACKUP_TABLES, PinLockedError, SlotTakenError, type BackupFile, type BackupTable, type Repo, type RestoreReport, type Session } from './repo';

type Db = {
  rooms: Room[];
  pricing: PricingRule[];
  settings: Settings;
  presets: AddonPreset[];
  bookings: Omit<Booking, 'payments' | 'addons' | 'refunds'>[];
  payments: Payment[];
  /** Missing in demo data saved before refunds existed. */
  refunds?: Refund[];
  addons: Booking['addons'];
  expenses: Expense[];
  audit: AuditLog[];
  staff: Profile[];
};

const KEY = 'tr-demo-db-v1';
const SESSION_KEY = 'tr-demo-session';
export const DEMO_PIN = '1234';

const ADMIN: Profile = { id: 'demo-admin', role: 'admin', display_name: 'Owner (demo)', active: true };
const CARETAKER: Profile = { id: 'demo-caretaker', role: 'caretaker', display_name: 'Caretaker (demo)', active: true };

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

const seed = (): Db => {
  const rooms: Room[] = [1, 2, 3, 4, 5].map((n) => ({
    id: `room-${n}`, room_number: n, name: `Room ${n}`, name_si: `කාමර ${n}`, category: 'non_ac', housekeeping: 'ready', active: true,
  }));
  const rule = (category: Room['category'], booking_type: PricingRule['booking_type'], price: number, s: string | null, e: string | null, d: number | null): PricingRule => ({
    id: `${category}-${booking_type}`, category, booking_type, price, default_start_time: s, default_end_time: e, duration_minutes: d,
  });
  const pricing = [
    rule('non_ac', 'short_time', 1500, null, null, 180),
    rule('non_ac', 'day', 2000, '08:00', '17:00', null),
    rule('non_ac', 'night', 2500, '18:00', '08:00', null),
    rule('non_ac', 'full_day', 3500, null, null, 1440),
    rule('ac', 'short_time', 2000, null, null, 180),
    rule('ac', 'day', 2800, '08:00', '17:00', null),
    rule('ac', 'night', 3500, '18:00', '08:00', null),
    rule('ac', 'full_day', 5000, null, null, 1440),
  ];
  const presets: AddonPreset[] = [
    ['තේ', 'Tea', 100], ['කෝපි', 'Coffee', 150], ['වතුර බෝතල්', 'Water bottle', 150], ['උදේ කෑම', 'Breakfast', 500],
    ['දවල් කෑම', 'Lunch', 700], ['රාත්‍රී කෑම', 'Dinner', 700], ['සිසිල් බීම', 'Soft drink', 200],
  ].map(([label_si, label_en, price], i) => ({ id: `preset-${i}`, label_si: String(label_si), label_en: String(label_en), price: Number(price), sort_order: i, active: true }));

  // A believable "today": one guest in, one arriving later, one room being cleaned,
  // a booking tomorrow, plus last month's history for the dashboard.
  const now = new Date();
  const today = dateKey(now);
  const base = (p: Partial<Omit<Booking, 'payments' | 'addons' | 'refunds'>>): Omit<Booking, 'payments' | 'addons' | 'refunds'> => ({
    id: uuid(), room_id: 'room-1', booking_type: 'short_time', guest_name: null, guest_phone: '0771234567',
    check_in_time: nowIso(), check_out_time: nowIso(), room_charge: 1500, status: 'booked', notes: null,
    actual_check_in_at: null, actual_check_out_at: null, cancelled_at: null, cancel_reason: null,
    created_at: nowIso(), created_by: CARETAKER.id, updated_at: nowIso(), ...p,
  });
  const inNow = base({
    room_id: 'room-1', booking_type: 'short_time', guest_name: 'නිමල්', guest_phone: '0712345678',
    check_in_time: addMinutes(now, -60).toISOString(), check_out_time: addMinutes(now, 120).toISOString(),
    status: 'checked_in', actual_check_in_at: addMinutes(now, -60).toISOString(),
  });
  const laterStart = addMinutes(now, 180);
  const later = base({
    room_id: 'room-2', booking_type: 'short_time', guest_name: 'සමන්', guest_phone: '0779876543',
    check_in_time: (dateKey(laterStart) === today ? laterStart : addMinutes(now, 30)).toISOString(),
    check_out_time: addMinutes(dateKey(laterStart) === today ? laterStart : addMinutes(now, 30), 180).toISOString(),
  });
  const tomorrow = addDaysKey(today, 1);
  const tmr = base({
    room_id: 'room-4', booking_type: 'day', guest_name: 'කමලා', guest_phone: '0765554444', room_charge: 2000,
    check_in_time: atClock(tomorrow, '08:00').toISOString(), check_out_time: atClock(tomorrow, '17:00').toISOString(),
  });

  const history: Omit<Booking, 'payments' | 'addons' | 'refunds'>[] = [];
  const payments: Payment[] = [
    { id: uuid(), booking_id: inNow.id, kind: 'advance', method: 'cash', amount: 1500, paid_at: addMinutes(now, -60).toISOString(), created_by: CARETAKER.id },
    { id: uuid(), booking_id: later.id, kind: 'advance', method: 'bank', amount: 500, paid_at: addMinutes(now, -300).toISOString(), created_by: CARETAKER.id },
    { id: uuid(), booking_id: tmr.id, kind: 'advance', method: 'cash', amount: 1000, paid_at: addMinutes(now, -30).toISOString(), created_by: CARETAKER.id },
  ];
  const types: [PricingRule['booking_type'], number, string, number][] = [
    ['day', 2000, '08:00', 540], ['night', 2500, '18:00', 840], ['short_time', 1500, '13:00', 180], ['full_day', 3500, '12:00', 1440],
  ];
  const { year, month } = colomboParts(now);
  for (let back = 1; back <= 40; back++) {
    const key = addDaysKey(today, -back);
    const [type, price, clock, mins] = types[back % types.length];
    for (const roomNo of [((back * 3) % 5) + 1, ((back * 7 + 2) % 5) + 1].filter((v, i, a) => a.indexOf(v) === i)) {
      const start = atClock(key, clock);
      const b = base({
        room_id: `room-${roomNo}`, booking_type: type, room_charge: price, guest_phone: `07${String(10000000 + back * 7919 + roomNo).slice(0, 8)}`,
        check_in_time: start.toISOString(), check_out_time: addMinutes(start, mins).toISOString(),
        status: back % 13 === 0 ? 'cancelled' : 'checked_out', created_at: start.toISOString(), updated_at: start.toISOString(),
      });
      history.push(b);
      if (b.status !== 'cancelled') {
        const method = back % 3 === 0 ? 'bank' : 'cash';
        payments.push({ id: uuid(), booking_id: b.id, kind: 'advance', method, amount: price - (back % 4 === 0 ? 500 : 0), paid_at: b.check_in_time, created_by: CARETAKER.id });
      }
    }
  }
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const expenses: Expense[] = [
    ['fixed', 'CEB Electricity', 9800, '05'], ['fixed', 'Water', 1800, '05'], ['fixed', 'Internet', 3500, '03'], ['fixed', 'Caretaker Salary', 35000, '01'],
    ['variable', 'Laundry', 2400, '07'], ['variable', 'Cleaning Supplies', 1650, '10'], ['variable', 'Food Ingredients', 4200, '12'],
  ].map(([t, c, a, d]) => ({
    id: uuid(), expense_type: t as Expense['expense_type'], category: String(c), amount: Number(a),
    expense_date: `${monthStr}-${d}` <= today ? `${monthStr}-${d}` : today, note: null, created_at: nowIso(),
  }));

  return {
    rooms: rooms.map((r) => (r.room_number === 3 ? { ...r, housekeeping: 'cleaning' } : r)),
    pricing, presets,
    settings: { property_name: 'Tranquil Rest', property_phone: null, cleaning_buffer_minutes: 30 },
    bookings: [inNow, later, tmr, ...history],
    payments,
    addons: [{ id: uuid(), booking_id: inNow.id, label: 'තේ', unit_price: 100, quantity: 2, amount: 200, created_at: nowIso() }],
    expenses, audit: [], staff: [ADMIN, CARETAKER],
  };
};

export const createDemoRepo = (): Repo => {
  let db: Db = (() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as Db;
    } catch { /* corrupted demo data: reseed */ }
    const fresh = seed();
    localStorage.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  })();

  const listeners = new Set<() => void>();
  const sessionListeners = new Set<(s: Session | null) => void>();
  const persist = () => {
    localStorage.setItem(KEY, JSON.stringify(db));
    listeners.forEach((l) => l());
  };
  const currentId = () => localStorage.getItem(SESSION_KEY);
  const actor = () => db.staff.find((s) => s.id === currentId());
  const isAdmin = () => actor()?.role === 'admin';
  const requireAdmin = () => {
    if (!isAdmin()) throw new Error('Admin only');
  };
  const audit = (table_name: string, record_id: string | null, action: string, old_data: unknown, new_data: unknown) => {
    db.audit.unshift({
      id: (db.audit[0]?.id ?? 0) + 1, table_name, record_id, action, actor_id: currentId(), actor_name: actor()?.display_name ?? 'system',
      old_data: (old_data ?? null) as AuditLog['old_data'], new_data: (new_data ?? null) as AuditLog['new_data'], created_at: nowIso(),
    });
  };
  const hydrate = (b: Omit<Booking, 'payments' | 'addons' | 'refunds'>): Booking => ({
    ...b,
    payments: db.payments.filter((p) => p.booking_id === b.id).sort((x, y) => x.paid_at.localeCompare(y.paid_at)),
    addons: db.addons.filter((a) => a.booking_id === b.id),
    refunds: (db.refunds ?? []).filter((r) => r.booking_id === b.id),
  });
  const PIN_STATE = 'tr-demo-pin-attempts';
  const requireActive = (id: string, statuses: Booking['status'][] = ['booked', 'checked_in']) => {
    const b = db.bookings.find((x) => x.id === id);
    if (!b || !statuses.includes(b.status)) throw new Error('BOOKING_NOT_ACTIVE');
    return b;
  };
  const guardOverlap = (b: Omit<Booking, 'payments' | 'addons' | 'refunds'>) => {
    const issues = findSlotIssues(db.bookings.map(hydrate), b.room_id, new Date(b.check_in_time), new Date(b.check_out_time), 0, b.id);
    if (hasOverlap(issues)) throw new SlotTakenError();
  };
  const patchBooking = (id: string, patch: Partial<Booking>, action = 'update') => {
    const i = db.bookings.findIndex((b) => b.id === id);
    if (i < 0) throw new Error('Not found');
    const old = db.bookings[i];
    const next = { ...old, ...patch, updated_at: nowIso() };
    if (next.status !== 'cancelled') guardOverlap(next);
    db.bookings[i] = next;
    audit('bookings', id, action, old, next);
  };
  const delay = () => new Promise((r) => setTimeout(r, 120));

  const repo: Repo = {
    kind: 'demo',

    async getSession() {
      const id = currentId();
      return id ? { userId: id, email: `${id}@demo` } : null;
    },
    onSessionChange(cb) {
      sessionListeners.add(cb);
      return () => sessionListeners.delete(cb);
    },
    async signIn(email) {
      await delay();
      const profile = email.trim().toLowerCase().startsWith('admin') ? ADMIN : CARETAKER;
      localStorage.setItem(SESSION_KEY, profile.id);
      const s = { userId: profile.id, email };
      sessionListeners.forEach((l) => l(s));
    },
    async signOut() {
      localStorage.removeItem(SESSION_KEY);
      sessionListeners.forEach((l) => l(null));
    },
    async getProfile() {
      return actor() ?? null;
    },
    async verifyPin(pin) {
      // Mirrors the server: 5 wrong tries lock for 60 s, doubling each time.
      await delay();
      const st = JSON.parse(localStorage.getItem(PIN_STATE) ?? '{"failed":0,"locks":0,"until":0}') as { failed: number; locks: number; until: number };
      if (st.until > Date.now()) throw new PinLockedError(Math.ceil((st.until - Date.now()) / 1000));
      if (pin === DEMO_PIN) {
        localStorage.removeItem(PIN_STATE);
        return true;
      }
      st.failed += 1;
      if (st.failed >= 5) {
        st.until = Date.now() + Math.min(60 * 2 ** st.locks, 3600) * 1000;
        st.locks += 1;
        st.failed = 0;
      }
      localStorage.setItem(PIN_STATE, JSON.stringify(st));
      return false;
    },

    async loadReference() {
      return { rooms: [...db.rooms].sort((a, b) => a.room_number - b.room_number), pricing: db.pricing, settings: db.settings, presets: [...db.presets].sort((a, b) => a.sort_order - b.sort_order) };
    },
    async listBookings(from, to) {
      return db.bookings
        .filter((b) => b.status === 'checked_in' || (new Date(b.check_in_time) < to && new Date(b.check_out_time) > from))
        .sort((a, b) => a.check_in_time.localeCompare(b.check_in_time))
        .map(hydrate);
    },
    async getBooking(id) {
      const b = db.bookings.find((x) => x.id === id);
      return b ? hydrate(b) : null;
    },
    async listRefunds(from, to) {
      return (db.refunds ?? []).filter((r) => new Date(r.refunded_at) >= from && new Date(r.refunded_at) < to);
    },
    async listBookingsByIds(ids) {
      const wanted = new Set(ids);
      return db.bookings.filter((b) => wanted.has(b.id)).map(hydrate);
    },
    async listPayments(from, to) {
      return db.payments.filter((p) => new Date(p.paid_at) >= from && new Date(p.paid_at) < to);
    },
    async checkSlot(roomId, start, end, excludeId) {
      return findSlotIssues(db.bookings.map(hydrate), roomId, start, end, db.settings.cleaning_buffer_minutes, excludeId);
    },
    async findGuestName(phone) {
      return db.bookings.filter((b) => b.guest_phone === phone && b.guest_name).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.guest_name ?? null;
    },

    async createBooking(input) {
      await delay();
      const { advance, addons, ...rest } = input;
      const b: Omit<Booking, 'payments' | 'addons' | 'refunds'> = {
        ...rest, id: uuid(), guest_name: rest.guest_name?.trim() || null,
        actual_check_in_at: rest.status === 'checked_in' ? nowIso() : null, actual_check_out_at: null,
        cancelled_at: null, cancel_reason: null, created_at: nowIso(), created_by: currentId(), updated_at: nowIso(),
      };
      guardOverlap(b);
      db.bookings.push(b);
      audit('bookings', b.id, 'insert', null, b);
      if (advance && advance.amount > 0) {
        const p: Payment = { id: uuid(), booking_id: b.id, ...advance, paid_at: nowIso(), created_by: currentId() };
        db.payments.push(p);
        audit('payments', p.id, 'insert', null, p);
      }
      for (const a of addons) {
        db.addons.push({ id: uuid(), booking_id: b.id, ...a, amount: a.unit_price * a.quantity, created_at: nowIso() });
      }
      if (b.status === 'checked_in') db.rooms = db.rooms.map((r) => (r.id === b.room_id ? { ...r, housekeeping: 'ready' } : r));
      persist();
      return hydrate(b);
    },
    async setStatus(id, change) {
      await delay();
      const b = db.bookings.find((x) => x.id === id);
      if (!b) throw new Error('Not found');
      if (b.status === 'cancelled' && change.status !== 'cancelled' && !isAdmin()) throw new Error('Only admins can restore');
      if (change.status === 'checked_in') patchBooking(id, { status: 'checked_in', actual_check_in_at: nowIso() }, 'check_in');
      if (change.status === 'checked_out') {
        const out = Math.max(new Date(b.check_in_time).getTime() + 60_000, Math.min(new Date(b.check_out_time).getTime(), Date.now()));
        patchBooking(id, { status: 'checked_out', actual_check_out_at: nowIso(), check_out_time: new Date(out).toISOString() }, 'check_out');
        db.rooms = db.rooms.map((r) => (r.id === b.room_id ? { ...r, housekeeping: 'cleaning' } : r));
      }
      if (change.status === 'checked_in' && b.status !== 'booked') throw new Error('BOOKING_NOT_WAITING');
      if (change.status === 'cancelled') {
        if (b.status !== 'booked' && !isAdmin()) throw new Error('BOOKING_NOT_CANCELLABLE');
        const netPaid = hydrate(b).payments.reduce((s2, p) => s2 + p.amount, 0) - hydrate(b).refunds.reduce((s2, r) => s2 + r.amount, 0);
        const refund = change.refund && change.refund.amount > 0 ? change.refund : null;
        if (refund && refund.amount > netPaid) throw new Error('REFUND_AMOUNT_INVALID');
        patchBooking(id, { status: 'cancelled', cancelled_at: nowIso(), cancel_reason: change.reason }, 'cancel');
        if (refund) {
          const row: Refund = { id: uuid(), booking_id: id, method: refund.method, amount: refund.amount, reason: 'cancellation', refunded_at: nowIso(), created_by: currentId() };
          db.refunds = [...(db.refunds ?? []), row];
          audit('refunds', row.id, 'insert', null, row);
        }
      }
      if (change.status === 'booked') patchBooking(id, { status: 'booked', cancelled_at: null, cancel_reason: null }, 'update');
      persist();
    },
    async addPayment(bookingId, p) {
      await delay();
      const row: Payment = { id: uuid(), booking_id: bookingId, ...p, paid_at: nowIso(), created_by: currentId() };
      db.payments.push(row);
      audit('payments', row.id, 'insert', null, row);
      persist();
    },
    async addAddons(bookingId, items) {
      await delay();
      for (const a of items) {
        const row = { id: uuid(), booking_id: bookingId, ...a, amount: a.unit_price * a.quantity, created_at: nowIso() };
        db.addons.push(row);
        audit('booking_addons', row.id, 'insert', null, row);
      }
      persist();
    },
    async extendBooking(id, newCheckOut, extraCharge) {
      await delay();
      const b = requireActive(id);
      if (newCheckOut <= new Date(b.check_out_time)) throw new Error('EXTEND_MUST_BE_LATER');
      if (extraCharge < 0) throw new Error('EXTRA_CHARGE_NEGATIVE');
      patchBooking(id, { check_out_time: newCheckOut.toISOString(), room_charge: b.room_charge + extraCharge });
      persist();
    },
    async moveBooking(id, roomId) {
      await delay();
      const b = requireActive(id);
      patchBooking(id, { room_id: roomId });
      if (b.status === 'checked_in') {
        db.rooms = db.rooms.map((r) => (r.id === b.room_id ? { ...r, housekeeping: 'cleaning' } : r.id === roomId ? { ...r, housekeeping: 'ready' } : r));
      }
      persist();
    },
    async setNotes(id, notes) {
      await delay();
      if (notes.length > 500) throw new Error('NOTES_TOO_LONG');
      patchBooking(id, { notes: notes.trim() || null });
      persist();
    },
    async setHousekeeping(roomId, state) {
      await delay();
      const old = db.rooms.find((r) => r.id === roomId);
      db.rooms = db.rooms.map((r) => (r.id === roomId ? { ...r, housekeeping: state } : r));
      audit('rooms', roomId, 'update', old, db.rooms.find((r) => r.id === roomId));
      persist();
    },

    async updateBooking(id, patch) {
      requireAdmin();
      patchBooking(id, patch);
      persist();
    },
    async deletePayment(id) {
      requireAdmin();
      const old = db.payments.find((p) => p.id === id);
      db.payments = db.payments.filter((p) => p.id !== id);
      audit('payments', id, 'delete', old, null);
      persist();
    },
    async deleteRefund(id) {
      requireAdmin();
      const old = (db.refunds ?? []).find((r) => r.id === id);
      db.refunds = (db.refunds ?? []).filter((r) => r.id !== id);
      audit('refunds', id, 'delete', old, null);
      persist();
    },
    async deleteAddon(id) {
      requireAdmin();
      const old = db.addons.find((p) => p.id === id);
      db.addons = db.addons.filter((p) => p.id !== id);
      audit('booking_addons', id, 'delete', old, null);
      persist();
    },
    async listBookingsByCheckIn(from, to) {
      return db.bookings
        .filter((b) => new Date(b.check_in_time) >= from && new Date(b.check_in_time) < to)
        .sort((a, b) => a.check_in_time.localeCompare(b.check_in_time))
        .map(hydrate);
    },
    async listExpenses(fromDate, toDateExclusive) {
      requireAdmin();
      return db.expenses.filter((e) => e.expense_date >= fromDate && e.expense_date < toDateExclusive).sort((a, b) => b.expense_date.localeCompare(a.expense_date));
    },
    async addExpense(e) {
      requireAdmin();
      const row = { ...e, id: uuid(), created_at: nowIso() };
      db.expenses.push(row);
      audit('expenses', row.id, 'insert', null, row);
      persist();
    },
    async deleteExpense(id) {
      requireAdmin();
      const old = db.expenses.find((e) => e.id === id);
      db.expenses = db.expenses.filter((e) => e.id !== id);
      audit('expenses', id, 'delete', old, null);
      persist();
    },
    async updateRoom(id, patch) {
      requireAdmin();
      const old = db.rooms.find((r) => r.id === id);
      db.rooms = db.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r));
      audit('rooms', id, 'update', old, db.rooms.find((r) => r.id === id));
      persist();
    },
    async updatePricing(id, patch) {
      requireAdmin();
      const old = db.pricing.find((r) => r.id === id);
      db.pricing = db.pricing.map((r) => (r.id === id ? { ...r, ...patch } : r));
      audit('pricing_rules', null, 'update', old, db.pricing.find((r) => r.id === id));
      persist();
    },
    async updateSettings(patch) {
      requireAdmin();
      const old = db.settings;
      db.settings = { ...db.settings, ...patch };
      audit('settings', null, 'update', old, db.settings);
      persist();
    },
    async upsertPreset(p) {
      requireAdmin();
      if (p.id) db.presets = db.presets.map((x) => (x.id === p.id ? { ...x, ...p, id: x.id } : x));
      else db.presets.push({ ...p, id: uuid() });
      audit('addon_presets', null, p.id ? 'update' : 'insert', null, p);
      persist();
    },
    async listAudit({ limit, before, table }) {
      requireAdmin();
      return db.audit.filter((a) => (!before || a.id < before) && (!table || a.table_name === table)).slice(0, limit);
    },
    async listStaff() {
      return db.staff;
    },
    async updateStaff(id, patch) {
      requireAdmin();
      db.staff = db.staff.map((s) => (s.id === id ? { ...s, ...patch } : s));
      persist();
    },
    async setStaffPin() {
      requireAdmin();
      throw new Error('Demo mode always uses PIN 1234');
    },

    async createStaff(input) {
      requireAdmin();
      await delay();
      const email = (input.email?.trim() || `${input.display_name.toLowerCase().replace(/[^a-z0-9]+/g, '.') || 'staff'}@demo`).toLowerCase();
      const profile: Profile = { id: uuid(), role: input.role, display_name: input.display_name.trim(), active: true };
      db.staff.push(profile);
      audit('profiles', profile.id, 'insert', null, profile);
      persist();
      return { user_id: profile.id, email };
    },
    async resetStaffPassword() {
      requireAdmin();
      await delay();
    },
    async rotateBackupKey() {
      requireAdmin();
      throw new Error('Backups need a live Supabase project (not available in demo mode)');
    },
    async backupKeyStatus() {
      return null;
    },

    async exportAll() {
      requireAdmin();
      return {
        format: BACKUP_FORMAT, exported_at: nowIso(), settings: { id: 1, ...db.settings },
        profiles: db.staff.map(({ id, role, display_name, active }) => ({ id, role, display_name, active })),
        rooms: db.rooms, pricing_rules: db.pricing, addon_presets: db.presets, expenses: db.expenses,
        bookings: db.bookings, payments: db.payments, refunds: db.refunds ?? [], booking_addons: db.addons, audit_logs: db.audit,
      } as unknown as BackupFile;
    },
    async restoreBackup(file, mode, dryRun, confirm) {
      requireAdmin();
      await delay();
      if (mode === 'replace' && !dryRun && confirm !== 'REPLACE ALL DATA') throw new Error('Replace needs the confirmation text REPLACE ALL DATA');
      const keys: Record<BackupTable, keyof Db> = {
        rooms: 'rooms', pricing_rules: 'pricing', addon_presets: 'presets', expenses: 'expenses',
        bookings: 'bookings', payments: 'payments', refunds: 'refunds', booking_addons: 'addons', audit_logs: 'audit',
      };
      const next: Db = structuredClone(db);
      const tables: RestoreReport['tables'] = {};
      for (const t of BACKUP_TABLES) {
        const rows = (file[t] ?? []) as { id: string | number }[];
        const current = (next[keys[t]] ?? []) as unknown as { id: string | number }[];
        if (mode === 'replace') {
          (next[keys[t]] as unknown) = rows;
          tables[t] = { restored: rows.length, skipped: 0 };
        } else {
          const have = new Set(current.map((r) => r.id));
          const add = rows.filter((r) => !have.has(r.id));
          (next[keys[t]] as unknown) = [...current, ...add];
          tables[t] = { restored: add.length, skipped: rows.length - add.length };
        }
      }
      const report: RestoreReport = { mode, dry_run: dryRun, backup_exported_at: file.exported_at, tables, missing_users: [] };
      if (!dryRun) {
        db = next;
        audit('backup', null, `restore_${mode}`, null, report);
        persist();
      }
      return report;
    },

    subscribe(cb) {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY && e.newValue) {
          db = JSON.parse(e.newValue) as Db;
          cb();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', onStorage);
      };
    },
  };
  return repo;
};

export const resetDemo = (): void => {
  localStorage.removeItem(KEY);
  location.reload();
};

