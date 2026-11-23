import type {
  AddonPreset, AuditLog, Booking, BookingStatus, Expense, NewAddon, NewBooking, NewPayment,
  Payment, PaymentMethod, PricingRule, Profile, ReferenceData, Refund, Room, Settings, SlotIssue, Housekeeping,
} from '../types';

export type Session = { userId: string; email: string | null };

export const BACKUP_FORMAT = 'tranquil-rest-backup/1';
export const BACKUP_TABLES = ['rooms', 'pricing_rules', 'addon_presets', 'expenses', 'bookings', 'payments', 'refunds', 'booking_addons', 'audit_logs'] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];
/** Tables that older backup files (before migration 0007) do not have. */
const OPTIONAL_BACKUP_TABLES: readonly BackupTable[] = ['refunds'];

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  exported_at: string;
  settings: Record<string, unknown> | null;
  profiles: { id: string; role: string; display_name: string; active: boolean }[];
} & Record<BackupTable, Record<string, unknown>[]>;

export type RestoreMode = 'merge' | 'replace';

export type NewStaff = {
  display_name: string;
  role: 'admin' | 'caretaker';
  /** Optional: a login email is generated from the name when empty. */
  email: string | null;
  password: string;
  pin: string | null;
};

export type RestoreReport = {
  mode: RestoreMode;
  dry_run: boolean;
  backup_exported_at: string;
  tables: Partial<Record<BackupTable | 'settings', { restored: number; skipped: number }>>;
  missing_users: { id: string; display_name: string; role: string }[];
};

/** Validates an uploaded file before it is sent anywhere. */
export const parseBackupFile = (text: string): BackupFile => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const d = data as Partial<BackupFile> | null;
  if (!d || d.format !== BACKUP_FORMAT) throw new Error('This is not a Tranquil Rest backup file.');
  for (const t of BACKUP_TABLES) {
    if (OPTIONAL_BACKUP_TABLES.includes(t) && d[t] === undefined) {
      (d as Record<string, unknown>)[t] = [];
      continue;
    }
    if (!Array.isArray(d[t])) throw new Error(`Backup file is incomplete (missing ${t}).`);
  }
  return d as BackupFile;
};

export type BookingPatch = Partial<
  Pick<Booking, 'guest_name' | 'guest_phone' | 'check_in_time' | 'check_out_time' | 'room_charge' | 'room_id' | 'notes' | 'booking_type'>
>;

export type StatusChange =
  | { status: Extract<BookingStatus, 'checked_in'> }
  | { status: Extract<BookingStatus, 'checked_out'> }
  | {
      status: Extract<BookingStatus, 'cancelled'>;
      reason: string | null;
      /** Money given back now. Null/0 = the advance is kept (forfeited). */
      refund?: { amount: number; method: PaymentMethod } | null;
    }
  | { status: Extract<BookingStatus, 'booked'> };

/** Raised for double-booking so the UI can show a precise Sinhala message. */
export class SlotTakenError extends Error {
  constructor() {
    super('slot_taken');
  }
}

/** The PIN is locked on the server after too many wrong tries. */
export class PinLockedError extends Error {
  constructor(public readonly seconds: number) {
    super('pin_locked');
  }
}

/** Caretakers cannot create bookings that start in the past. */
export class BookingInPastError extends Error {
  constructor() {
    super('booking_in_past');
  }
}

/** The database is missing a newer migration this action needs. */
export class DbUpgradeNeededError extends Error {
  constructor(what: string) {
    super(`Database update needed (${what}). Run the latest migration.`);
  }
}

/** Raised when the request never reached the server. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('network', { cause });
  }
}

export type Repo = {
  readonly kind: 'supabase' | 'demo';

  // auth
  getSession(): Promise<Session | null>;
  onSessionChange(cb: (s: Session | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  getProfile(): Promise<Profile | null>;
  /** True/false for right/wrong; throws PinLockedError when the server has locked the PIN. */
  verifyPin(pin: string): Promise<boolean>;

  // shared reads
  loadReference(): Promise<ReferenceData>;
  /** Bookings overlapping [from, to) plus any still checked in, with payments & add-ons. */
  listBookings(from: Date, to: Date): Promise<Booking[]>;
  getBooking(id: string): Promise<Booking | null>;
  listPayments(from: Date, to: Date): Promise<Payment[]>;
  listRefunds(from: Date, to: Date): Promise<Refund[]>;
  listBookingsByIds(ids: readonly string[]): Promise<Booking[]>;
  checkSlot(roomId: string, start: Date, end: Date, excludeId?: string): Promise<SlotIssue[]>;
  findGuestName(phone: string): Promise<string | null>;

  // caretaker writes
  createBooking(input: NewBooking): Promise<Booking>;
  setStatus(id: string, change: StatusChange): Promise<void>;
  addPayment(bookingId: string, p: NewPayment): Promise<void>;
  addAddons(bookingId: string, items: NewAddon[]): Promise<void>;
  setHousekeeping(roomId: string, state: Housekeeping): Promise<void>;
  /** Later check-out; extraCharge (≥ 0) is added to the room charge. */
  extendBooking(id: string, newCheckOut: Date, extraCharge: number): Promise<void>;
  moveBooking(id: string, roomId: string): Promise<void>;
  setNotes(id: string, notes: string): Promise<void>;

  // admin
  updateBooking(id: string, patch: BookingPatch): Promise<void>;
  deletePayment(id: string): Promise<void>;
  deleteAddon(id: string): Promise<void>;
  deleteRefund(id: string): Promise<void>;
  listBookingsByCheckIn(from: Date, to: Date): Promise<Booking[]>;
  listExpenses(fromDate: string, toDateExclusive: string): Promise<Expense[]>;
  addExpense(e: Omit<Expense, 'id' | 'created_at'>): Promise<void>;
  deleteExpense(id: string): Promise<void>;
  updateRoom(id: string, patch: Partial<Pick<Room, 'name' | 'name_si' | 'category' | 'active'>>): Promise<void>;
  updatePricing(id: string, patch: Partial<Pick<PricingRule, 'price' | 'default_start_time' | 'default_end_time' | 'duration_minutes'>>): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  upsertPreset(p: Omit<AddonPreset, 'id'> & { id?: string }): Promise<void>;
  listAudit(opts: { limit: number; before?: number; table?: string }): Promise<AuditLog[]>;
  listStaff(): Promise<Profile[]>;
  updateStaff(id: string, patch: Partial<Pick<Profile, 'role' | 'display_name' | 'active'>>): Promise<void>;
  setStaffPin(id: string, pin: string): Promise<void>;
  /** Creates a login + profile (+ PIN for caretakers). Returns the login email. */
  createStaff(input: NewStaff): Promise<{ user_id: string; email: string }>;
  resetStaffPassword(id: string, password: string): Promise<void>;
  /** Creates/rotates the read-only key used by the Google Sheets backup. Returned once. */
  rotateBackupKey(): Promise<string>;
  backupKeyStatus(): Promise<{ created_at: string; last_used: string | null } | null>;
  /** Full snapshot in the same format as the nightly backup file. */
  exportAll(): Promise<BackupFile>;
  restoreBackup(file: BackupFile, mode: RestoreMode, dryRun: boolean, confirm?: string): Promise<RestoreReport>;

  /** Subscribe to remote changes (other devices). Returns unsubscribe. */
  subscribe(cb: () => void): () => void;
};
