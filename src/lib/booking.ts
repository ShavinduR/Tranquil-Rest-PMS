import type { Booking, Payment } from '../types';
import { sum } from './money';

export const addonsTotal = (b: Pick<Booking, 'addons'>): number => sum(b.addons.map((a) => a.amount));
export const bookingTotal = (b: Pick<Booking, 'room_charge' | 'addons'>): number => b.room_charge + addonsTotal(b);
export const paidTotal = (b: Pick<Booking, 'payments'>): number => sum(b.payments.map((p) => p.amount));
export const balanceDue = (b: Pick<Booking, 'room_charge' | 'addons' | 'payments'>): number =>
  Math.max(0, bookingTotal(b) - paidTotal(b));

export const isActive = (b: Pick<Booking, 'status'>): boolean => b.status === 'booked' || b.status === 'checked_in';

/** Cash the caretaker should physically hold: today's cash payments (advance + balance), bank excluded. */
export const cashInHand = (payments: readonly Payment[], dayStart: Date, dayEnd: Date): number =>
  sum(
    payments
      .filter((p) => p.method === 'cash')
      .filter((p) => {
        const t = new Date(p.paid_at).getTime();
        return t >= dayStart.getTime() && t < dayEnd.getTime();
      })
      .map((p) => p.amount),
  );
