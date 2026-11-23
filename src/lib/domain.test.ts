import { describe, expect, it } from 'vitest';
import type { Booking, PricingRule, Room } from '../types';
import { findSlotIssues, hasOverlap } from './conflicts';
import { defaultSlot } from './pricing';
import { normalizeLkPhone, formatLkPhone } from './phone';
import { addDaysKey, dateKey, fromColombo, monthRange, shiftMonth, clock24 } from './time';
import { roomView } from './roomStatus';
import { balanceDue, cashInHand } from './booking';
import { confirmationMessage, whatsappLink } from './whatsapp';
import { summarizeMonth } from './finance';
import { timeSi } from '../i18n/si';
import { toCsv } from './csv';

const rule = (p: Partial<PricingRule> & Pick<PricingRule, 'booking_type'>): PricingRule => ({
  id: p.booking_type, category: 'non_ac', price: 0, default_start_time: null, default_end_time: null, duration_minutes: null, ...p,
});
const SHORT = rule({ booking_type: 'short_time', price: 1500, duration_minutes: 180 });
const DAY = rule({ booking_type: 'day', price: 2000, default_start_time: '08:00:00', default_end_time: '17:00:00' });
const NIGHT = rule({ booking_type: 'night', price: 2500, default_start_time: '18:00', default_end_time: '08:00' });
const FULL = rule({ booking_type: 'full_day', price: 3500, duration_minutes: 1440 });

const room: Room = { id: 'r1', room_number: 1, name: 'Room 1', name_si: 'කාමර 1', category: 'non_ac', housekeeping: 'ready', active: true };

const booking = (p: Partial<Booking>): Booking => ({
  id: 'b', room_id: 'r1', booking_type: 'day', guest_name: null, guest_phone: '0771234567',
  check_in_time: fromColombo(2026, 12, 1, 8).toISOString(), check_out_time: fromColombo(2026, 12, 1, 17).toISOString(),
  room_charge: 2000, status: 'booked', notes: null, actual_check_in_at: null, actual_check_out_at: null,
  cancelled_at: null, cancel_reason: null, created_at: '', created_by: null, updated_at: '', payments: [], addons: [], ...p,
});

describe('Colombo time', () => {
  it('converts independently of device timezone', () => {
    const d = fromColombo(2026, 12, 1, 0, 30); // 00:30 LK = 19:00 UTC previous day
    expect(d.toISOString()).toBe('2026-11-30T19:00:00.000Z');
    expect(dateKey(d)).toBe('2026-12-01');
    expect(clock24(d)).toBe('00:30');
  });
  it('handles day and month arithmetic', () => {
    expect(addDaysKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthRange('2026-12').end.toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });
  it('formats Sinhala time of day', () => {
    expect(timeSi(fromColombo(2026, 1, 1, 10, 0))).toBe('උදේ 10:00');
    expect(timeSi(fromColombo(2026, 1, 1, 17, 0))).toBe('හවස 5:00');
    expect(timeSi(fromColombo(2026, 1, 1, 21, 30))).toBe('රෑ 9:30');
  });
});

describe('default slots', () => {
  it('Day future booking uses the 08:00–17:00 window', () => {
    const s = defaultSlot(DAY, { mode: 'future', date: '2026-12-01' });
    expect([clock24(s.start), clock24(s.end), dateKey(s.end)]).toEqual(['08:00', '17:00', '2026-12-01']);
  });
  it('Night rolls over to 08:00 next day', () => {
    const s = defaultSlot(NIGHT, { mode: 'future', date: '2026-12-01' });
    expect([clock24(s.start), clock24(s.end), dateKey(s.end)]).toEqual(['18:00', '08:00', '2026-12-02']);
  });
  it('Short Time walk-in is now (rounded) + 3h', () => {
    const s = defaultSlot(SHORT, { mode: 'walk_in', now: fromColombo(2026, 12, 1, 13, 2) });
    expect([clock24(s.start), clock24(s.end)]).toEqual(['13:05', '16:05']);
  });
  it('Night walk-in at 23:00 ends 08:00 tomorrow; at 02:00 ends 08:00 today', () => {
    const late = defaultSlot(NIGHT, { mode: 'walk_in', now: fromColombo(2026, 12, 1, 23, 0) });
    expect(dateKey(late.end) + ' ' + clock24(late.end)).toBe('2026-12-02 08:00');
    const early = defaultSlot(NIGHT, { mode: 'walk_in', now: fromColombo(2026, 12, 2, 2, 0) });
    expect(dateKey(early.end) + ' ' + clock24(early.end)).toBe('2026-12-02 08:00');
  });
  it('Full Day is 24 hours', () => {
    const s = defaultSlot(FULL, { mode: 'future', date: '2026-12-01', startClock: '14:00' });
    expect(s.end.getTime() - s.start.getTime()).toBe(24 * 3600_000);
  });
});

describe('conflict detection', () => {
  const existing = [booking({ id: 'day' })];
  it('flags overlap: NewStart < ExistingEnd AND NewEnd > ExistingStart', () => {
    const issues = findSlotIssues(existing, 'r1', fromColombo(2026, 12, 1, 16), fromColombo(2026, 12, 1, 19), 30);
    expect(hasOverlap(issues)).toBe(true);
  });
  it('back-to-back outside buffer is clean', () => {
    expect(findSlotIssues(existing, 'r1', fromColombo(2026, 12, 1, 18), fromColombo(2026, 12, 2, 8), 30)).toEqual([]);
  });
  it('touching the 30-min buffer is a warning, not a block', () => {
    const issues = findSlotIssues(existing, 'r1', fromColombo(2026, 12, 1, 17, 15), fromColombo(2026, 12, 1, 20), 30);
    expect(issues.map((i) => i.kind)).toEqual(['buffer']);
  });
  it('ignores cancelled bookings, other rooms and the booking being edited', () => {
    const s = fromColombo(2026, 12, 1, 9), e = fromColombo(2026, 12, 1, 10);
    expect(findSlotIssues([booking({ status: 'cancelled' })], 'r1', s, e, 30)).toEqual([]);
    expect(findSlotIssues(existing, 'r2', s, e, 30)).toEqual([]);
    expect(findSlotIssues(existing, 'r1', s, e, 30, 'day')).toEqual([]);
  });
});

describe('phones & WhatsApp', () => {
  it('normalises LK formats', () => {
    for (const p of ['0771234567', '077 123 4567', '+94 77 123 4567', '94771234567', '771234567']) {
      expect(normalizeLkPhone(p)).toBe('94771234567');
    }
    expect(normalizeLkPhone('12345')).toBeNull();
    expect(formatLkPhone('+94771234567')).toBe('077 123 4567');
  });
  it('builds a wa.me link with booking details', () => {
    const b = booking({ guest_name: 'සමන්', payments: [{ id: 'p', booking_id: 'b', kind: 'advance', method: 'cash', amount: 1000, paid_at: '', created_by: null }] });
    const msg = confirmationMessage(b, room, 'Tranquil Rest');
    expect(msg).toContain('*Tranquil Rest*');
    expect(msg).toContain('2026-12-01 08:00');
    expect(msg).toContain('Advance Paid: Rs. 1,000');
    expect(msg).toContain('Balance Due: Rs. 1,000');
    expect(whatsappLink('0771234567', msg)).toMatch(/^https:\/\/wa\.me\/94771234567\?text=/);
  });
});

describe('money', () => {
  it('balance includes add-ons and never goes negative', () => {
    const b = booking({
      addons: [{ id: 'a', booking_id: 'b', label: 'තේ', unit_price: 100, quantity: 2, amount: 200, created_at: '' }],
      payments: [{ id: 'p', booking_id: 'b', kind: 'advance', method: 'bank', amount: 500, paid_at: '', created_by: null }],
    });
    expect(balanceDue(b)).toBe(1700);
    expect(balanceDue({ ...b, payments: [{ ...b.payments[0], amount: 9999 }] })).toBe(0);
  });
  it('cash in hand counts only today\'s cash', () => {
    const start = fromColombo(2026, 12, 1), end = fromColombo(2026, 12, 2);
    const p = (method: 'cash' | 'bank', amount: number, at: Date) => ({ id: String(amount), booking_id: 'b', kind: 'advance' as const, method, amount, paid_at: at.toISOString(), created_by: null });
    expect(cashInHand([
      p('cash', 1000, fromColombo(2026, 12, 1, 9)),
      p('cash', 500, fromColombo(2026, 12, 1, 23, 50)),
      p('bank', 2000, fromColombo(2026, 12, 1, 10)),
      p('cash', 700, fromColombo(2026, 11, 30, 23, 59)),
    ], start, end)).toBe(1500);
  });
});

describe('room status', () => {
  const now = fromColombo(2026, 12, 1, 12);
  it('priority Occupied > Cleaning > Booked today > Available', () => {
    expect(roomView(room, [], now).state).toBe('available');
    expect(roomView(room, [booking({})], now).state).toBe('booked_today');
    expect(roomView({ ...room, housekeeping: 'cleaning' }, [booking({})], now).state).toBe('cleaning');
    const occ = roomView({ ...room, housekeeping: 'cleaning' }, [booking({ status: 'checked_in' })], now);
    expect(occ.state).toBe('occupied');
  });
  it('detects overdue checkout', () => {
    const v = roomView(room, [booking({ status: 'checked_in' })], fromColombo(2026, 12, 1, 18));
    expect(v.overdueCheckout).toBe(true);
  });
  it('tomorrow\'s booking does not make the room orange today', () => {
    const tmr = booking({ check_in_time: fromColombo(2026, 12, 2, 8).toISOString(), check_out_time: fromColombo(2026, 12, 2, 17).toISOString() });
    const v = roomView(room, [tmr], now);
    expect(v.state).toBe('available');
    expect(v.next?.id).toBe('b');
  });
});

describe('finance', () => {
  it('computes revenue, expenses and net profit for a month', () => {
    const pay = (id: string, method: 'cash' | 'bank', amount: number, at: Date) => ({ id, booking_id: 'b', kind: 'advance' as const, method, amount, paid_at: at.toISOString(), created_by: null });
    const b1 = booking({ id: 'b1', payments: [pay('p1', 'cash', 2000, fromColombo(2026, 12, 1, 9))] });
    const b2 = booking({ id: 'b2', booking_type: 'night', room_charge: 2500, check_in_time: fromColombo(2026, 12, 1, 18).toISOString(), check_out_time: fromColombo(2026, 12, 2, 8).toISOString(), payments: [pay('p2', 'bank', 1000, fromColombo(2026, 12, 1, 18))] });
    const b3 = booking({ id: 'b3', status: 'cancelled', room_charge: 3500 });
    const s = summarizeMonth('2026-12', [b1, b2, b3], [...b1.payments, ...b2.payments], [
      { id: 'e1', expense_type: 'fixed', category: 'CEB Electricity', amount: 800, expense_date: '2026-12-05', note: null, created_at: '' },
      { id: 'e2', expense_type: 'variable', category: 'Laundry', amount: 200, expense_date: '2026-12-01', note: null, created_at: '' },
      { id: 'e3', expense_type: 'variable', category: 'Laundry', amount: 999, expense_date: '2026-11-30', note: null, created_at: '' },
    ], [room]);
    expect(s.collected).toEqual({ cash: 2000, bank: 1000, total: 3000 });
    expect(s.billed.total).toBe(4500);
    expect(s.pendingBalances).toBe(1500);
    expect(s.expenses).toMatchObject({ fixed: 800, variable: 200, total: 1000 });
    expect(s.netProfit).toBe(2000);
    expect(s.bookingsCount).toBe(2);
    expect(s.cancelledCount).toBe(1);
    expect(s.byType.night).toEqual({ count: 1, revenue: 2500 });
    expect(s.daily[0]).toEqual({ date: '2026-12-01', collected: 3000, expenses: 200 });
  });
});

describe('csv', () => {
  it('escapes commas, quotes and newlines', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'he said "hi"'], [null, 3]])).toBe('a,b\r\n"x,y","he said ""hi"""\r\n,3');
  });
});
