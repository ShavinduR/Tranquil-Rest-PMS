import type {
  AddonPreset, AuditLog, Booking, BookingStatus, Expense, NewAddon, NewBooking, NewPayment,
  Payment, PricingRule, Profile, ReferenceData, Room, Settings, SlotIssue, Housekeeping,
} from '../types';

export type Session = { userId: string; email: string | null };

export type BookingPatch = Partial<
  Pick<Booking, 'guest_name' | 'guest_phone' | 'check_in_time' | 'check_out_time' | 'room_charge' | 'room_id' | 'notes' | 'booking_type'>
>;

export type StatusChange =
  | { status: Extract<BookingStatus, 'checked_in'> }
  | { status: Extract<BookingStatus, 'checked_out'> }
  | { status: Extract<BookingStatus, 'cancelled'>; reason: string | null }
  | { status: Extract<BookingStatus, 'booked'> };

/** Raised for double-booking so the UI can show a precise Sinhala message. */
export class SlotTakenError extends Error {
  constructor() {
    super('slot_taken');
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
  verifyPin(pin: string): Promise<boolean>;

  // shared reads
  loadReference(): Promise<ReferenceData>;
  /** Bookings overlapping [from, to) plus any still checked in, with payments & add-ons. */
  listBookings(from: Date, to: Date): Promise<Booking[]>;
  getBooking(id: string): Promise<Booking | null>;
  listPayments(from: Date, to: Date): Promise<Payment[]>;
  checkSlot(roomId: string, start: Date, end: Date, excludeId?: string): Promise<SlotIssue[]>;
  findGuestName(phone: string): Promise<string | null>;

  // caretaker writes
  createBooking(input: NewBooking): Promise<Booking>;
  setStatus(id: string, change: StatusChange): Promise<void>;
  addPayment(bookingId: string, p: NewPayment): Promise<void>;
  addAddons(bookingId: string, items: NewAddon[]): Promise<void>;
  setHousekeeping(roomId: string, state: Housekeeping): Promise<void>;

  // admin
  updateBooking(id: string, patch: BookingPatch): Promise<void>;
  deletePayment(id: string): Promise<void>;
  deleteAddon(id: string): Promise<void>;
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

  /** Subscribe to remote changes (other devices). Returns unsubscribe. */
  subscribe(cb: () => void): () => void;
};
