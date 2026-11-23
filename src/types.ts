export type AppRole = 'admin' | 'caretaker';
export type RoomCategory = 'non_ac' | 'ac';
export type BookingType = 'short_time' | 'day' | 'night' | 'full_day';
export type BookingStatus = 'booked' | 'checked_in' | 'checked_out' | 'cancelled';
export type Housekeeping = 'ready' | 'cleaning';
export type PaymentMethod = 'cash' | 'bank';
export type PaymentKind = 'advance' | 'balance';
export type ExpenseType = 'fixed' | 'variable';

export const BOOKING_TYPES: readonly BookingType[] = ['short_time', 'day', 'night', 'full_day'];

export type Profile = {
  id: string;
  role: AppRole;
  display_name: string;
  active: boolean;
};

export type Room = {
  id: string;
  room_number: number;
  name: string;
  name_si: string;
  category: RoomCategory;
  housekeeping: Housekeeping;
  active: boolean;
};

export type PricingRule = {
  id: string;
  category: RoomCategory;
  booking_type: BookingType;
  price: number;
  /** 'HH:MM' or 'HH:MM:SS' (Colombo local) for fixed-window types */
  default_start_time: string | null;
  default_end_time: string | null;
  duration_minutes: number | null;
};

export type Settings = {
  property_name: string;
  property_phone: string | null;
  cleaning_buffer_minutes: number;
};

export type AddonPreset = {
  id: string;
  label_si: string;
  label_en: string;
  price: number;
  sort_order: number;
  active: boolean;
};

export type Payment = {
  id: string;
  booking_id: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amount: number;
  paid_at: string;
  created_by: string | null;
};

/** Money given back to a guest (e.g. when a booking with an advance is cancelled). */
export type Refund = {
  id: string;
  booking_id: string;
  method: PaymentMethod;
  amount: number;
  reason: string | null;
  refunded_at: string;
  created_by: string | null;
};

export type BookingAddon = {
  id: string;
  booking_id: string;
  label: string;
  unit_price: number;
  quantity: number;
  amount: number;
  created_at: string;
};

export type Booking = {
  id: string;
  room_id: string;
  booking_type: BookingType;
  guest_name: string | null;
  guest_phone: string;
  check_in_time: string;
  check_out_time: string;
  room_charge: number;
  status: BookingStatus;
  notes: string | null;
  actual_check_in_at: string | null;
  actual_check_out_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  payments: Payment[];
  addons: BookingAddon[];
  /** Empty on databases that predate migration 0007. */
  refunds: Refund[];
};

export type Expense = {
  id: string;
  expense_type: ExpenseType;
  category: string;
  amount: number;
  expense_date: string;
  note: string | null;
  created_at: string;
};

export type AuditLog = {
  id: number;
  table_name: string;
  record_id: string | null;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
};

export type ReferenceData = {
  rooms: Room[];
  pricing: PricingRule[];
  settings: Settings;
  presets: AddonPreset[];
};

export type NewAddon = { label: string; unit_price: number; quantity: number };
export type NewPayment = { kind: PaymentKind; method: PaymentMethod; amount: number };

export type NewBooking = {
  room_id: string;
  booking_type: BookingType;
  guest_name: string | null;
  guest_phone: string;
  check_in_time: string;
  check_out_time: string;
  room_charge: number;
  status: Extract<BookingStatus, 'booked' | 'checked_in'>;
  notes: string | null;
  advance: NewPayment | null;
  addons: NewAddon[];
};

export type SlotIssue = {
  booking_id: string;
  kind: 'overlap' | 'buffer';
  check_in_time: string;
  check_out_time: string;
  guest_name: string | null;
};
