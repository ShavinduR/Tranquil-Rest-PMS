import type { Booking, Payment, Refund } from '../types';
import { sum } from './money';

export const addonsTotal = (b: Pick<Booking, 'addons'>): number => sum(b.addons.map((a) => a.amount));
export const bookingTotal = (b: Pick<Booking, 'room_charge' | 'addons'>): number => b.room_charge + addonsTotal(b);
export const refundedTotal = (b: { refunds?: Refund[] }): number => sum((b.refunds ?? []).map((r) => r.amount));
/** Money received minus money given back. */
export const paidTotal = (b: Pick<Booking, 'payments'> & { refunds?: Refund[] }): number =>
  sum(b.payments.map((p) => p.amount)) - refundedTotal(b);
export const balanceDue = (b: Pick<Booking, 'room_charge' | 'addons' | 'payments'> & { refunds?: Refund[] }): number =>
  Math.max(0, bookingTotal(b) - paidTotal(b));

export const isActive = (b: Pick<Booking, 'status'>): boolean => b.status === 'booked' || b.status === 'checked_in';

const within = (iso: string, start: Date, end: Date) => {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime();
};

/**
 * Cash the caretaker should physically hold: today's cash payments (advance + balance)
 * minus today's cash refunds. Bank transfers are excluded.
 */
export const cashInHand = (payments: readonly Payment[], dayStart: Date, dayEnd: Date, refunds: readonly Refund[] = []): number =>
  sum(payments.filter((p) => p.method === 'cash' && within(p.paid_at, dayStart, dayEnd)).map((p) => p.amount)) -
  sum(refunds.filter((r) => r.method === 'cash' && within(r.refunded_at, dayStart, dayEnd)).map((r) => r.amount));
