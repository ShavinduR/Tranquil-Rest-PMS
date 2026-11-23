import type { Booking, BookingType, Expense, Payment, Refund, Room } from '../types';
import { BOOKING_TYPES } from '../types';
import { addonsTotal, balanceDue, bookingTotal } from './booking';
import { sum } from './money';
import { dateKey, daysInMonth, monthRange } from './time';

export type MonthSummary = {
  month: string;
  /** Net of refunds. */
  collected: { cash: number; bank: number; total: number };
  refunded: { cash: number; bank: number; total: number };
  /** Charges for stays that started this month (room + add-ons), cancelled excluded. */
  billed: { rooms: number; addons: number; total: number };
  pendingBalances: number;
  expenses: { fixed: number; variable: number; total: number; byCategory: Record<string, number> };
  /** Cash basis: money actually received minus money spent. */
  netProfit: number;
  bookingsCount: number;
  cancelledCount: number;
  occupancyPct: number;
  byType: Record<BookingType, { count: number; revenue: number }>;
  daily: { date: string; collected: number; expenses: number }[];
};

const inRange = (iso: string, start: Date, end: Date): boolean => {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime();
};

/**
 * @param bookings bookings whose check-in falls in the month (any status)
 * @param payments payments whose paid_at falls in the month (any booking)
 * @param expenses expenses dated in the month
 * @param refunds refunds made in the month (optional; older databases have none)
 */
export const summarizeMonth = (
  month: string,
  bookings: readonly Booking[],
  payments: readonly Payment[],
  expenses: readonly Expense[],
  rooms: readonly Room[],
  refunds: readonly Refund[] = [],
): MonthSummary => {
  const { start, end } = monthRange(month);
  const monthPayments = payments.filter((p) => inRange(p.paid_at, start, end));
  const monthRefunds = refunds.filter((r) => inRange(r.refunded_at, start, end));
  const refundCash = sum(monthRefunds.filter((r) => r.method === 'cash').map((r) => r.amount));
  const refundBank = sum(monthRefunds.filter((r) => r.method === 'bank').map((r) => r.amount));
  const cash = sum(monthPayments.filter((p) => p.method === 'cash').map((p) => p.amount)) - refundCash;
  const bank = sum(monthPayments.filter((p) => p.method === 'bank').map((p) => p.amount)) - refundBank;

  const stays = bookings.filter((b) => inRange(b.check_in_time, start, end));
  const live = stays.filter((b) => b.status !== 'cancelled');
  const roomsBilled = sum(live.map((b) => b.room_charge));
  const addonsBilled = sum(live.map(addonsTotal));

  const monthExpenses = expenses.filter((e) => e.expense_date.slice(0, 7) === month);
  const fixed = sum(monthExpenses.filter((e) => e.expense_type === 'fixed').map((e) => e.amount));
  const variable = sum(monthExpenses.filter((e) => e.expense_type === 'variable').map((e) => e.amount));
  const byCategory: Record<string, number> = {};
  for (const e of monthExpenses) byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;

  const byType = Object.fromEntries(BOOKING_TYPES.map((t) => [t, { count: 0, revenue: 0 }])) as MonthSummary['byType'];
  for (const b of live) {
    byType[b.booking_type].count += 1;
    byType[b.booking_type].revenue += bookingTotal(b);
  }

  // Occupancy = booked room-hours clipped to the month / available room-hours.
  const activeRooms = rooms.filter((r) => r.active).length || 1;
  const capacityMs = activeRooms * (end.getTime() - start.getTime());
  const bookedMs = sum(
    bookings
      .filter((b) => b.status !== 'cancelled')
      .map((b) => {
        const s = Math.max(new Date(b.check_in_time).getTime(), start.getTime());
        const e = Math.min(new Date(b.check_out_time).getTime(), end.getTime());
        return Math.max(0, e - s);
      }),
  );

  const days = daysInMonth(month);
  const daily = Array.from({ length: days }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    return {
      date,
      collected:
        sum(monthPayments.filter((p) => dateKey(new Date(p.paid_at)) === date).map((p) => p.amount)) -
        sum(monthRefunds.filter((r) => dateKey(new Date(r.refunded_at)) === date).map((r) => r.amount)),
      expenses: sum(monthExpenses.filter((e) => e.expense_date === date).map((e) => e.amount)),
    };
  });

  return {
    month,
    collected: { cash, bank, total: cash + bank },
    refunded: { cash: refundCash, bank: refundBank, total: refundCash + refundBank },
    billed: { rooms: roomsBilled, addons: addonsBilled, total: roomsBilled + addonsBilled },
    pendingBalances: sum(live.map(balanceDue)),
    expenses: { fixed, variable, total: fixed + variable, byCategory },
    netProfit: cash + bank - (fixed + variable),
    bookingsCount: live.length,
    cancelledCount: stays.length - live.length,
    occupancyPct: capacityMs > 0 ? Math.round((bookedMs / capacityMs) * 1000) / 10 : 0,
    byType,
    daily,
  };
};
