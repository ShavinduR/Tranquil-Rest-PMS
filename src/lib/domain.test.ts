import { describe, expect, it } from 'vitest';
import type { Booking, PricingRule, Room } from '../types';
import { findSlotIssues, hasOverlap } from './conflicts';
import { defaultSlot, startsTooEarly } from './pricing';
import { roomDaySchedule } from './availability';
import { parsePhone, formatPhone } from './phone';
import { addDaysKey, dateKey, fromColombo, monthRange, shiftMonth, clock24 } from './time';
import { roomView } from './roomStatus';
import { balanceDue, cashInHand, paidTotal } from './booking';
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
  cancelled_at: null, cancel_reason: null, created_at: '', created_by: null, updated_at: '', payments: [], addons: [], refunds: [], ...p,
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
  const at = (h: number, m = 0, d = 1) => fromColombo(2026, 12, d, h, m);
  const fmt = (x: Date) => `${dateKey(x)} ${clock24(x)}`;
  it('Day future booking uses the 08:00–17:00 window', () => {
    const s = defaultSlot(DAY, { mode: 'future', date: '2026-12-02', now: at(10) });
    expect([fmt(s.start), fmt(s.end), s.available]).toEqual(['2026-12-02 08:00', '2026-12-02 17:00', true]);
  });
  it('Night rolls over to 08:00 next day', () => {
    const s = defaultSlot(NIGHT, { mode: 'future', date: '2026-12-02', now: at(10) });
    expect([fmt(s.start), fmt(s.end)]).toEqual(['2026-12-02 18:00', '2026-12-03 08:00']);
  });
  it('Short Time walk-in is now (rounded) + 3h', () => {
    const s = defaultSlot(SHORT, { mode: 'walk_in', now: at(13, 2) });
    expect([clock24(s.start), clock24(s.end), s.available]).toEqual(['13:05', '16:05', true]);
  });
  it('Night walk-in at 23:00 ends 08:00 tomorrow; at 02:00 ends 08:00 today', () => {
    expect(fmt(defaultSlot(NIGHT, { mode: 'walk_in', now: at(23) }).end)).toBe('2026-12-02 08:00');
    expect(fmt(defaultSlot(NIGHT, { mode: 'walk_in', now: at(2, 0, 2) }).end)).toBe('2026-12-02 08:00');
  });
  it('Full Day is 24 hours', () => {
    const s = defaultSlot(FULL, { mode: 'future', date: '2026-12-02', startClock: '14:00', now: at(10) });
    expect(s.end.getTime() - s.start.getTime()).toBe(24 * 3600_000);
  });

  // Late-day bug: a Day walk-in after the window has (almost) ended used to roll to tomorrow 17:00 (~25 h).
  it('late-afternoon Day walk-in is not offered and never rolls over to tomorrow', () => {
    for (const [h, m] of [[15, 30], [16, 30], [18, 0], [22, 0]] as const) {
      const s = defaultSlot(DAY, { mode: 'walk_in', now: at(h, m) });
      expect(s.available).toBe(false);
      expect(s.end.getTime() - s.start.getTime()).toBeLessThanOrEqual(2 * 3600_000);
      expect(dateKey(s.end)).toBe('2026-12-01');
    }
  });
  it('Day walk-in at 10:00 runs to 17:00 today; early arrival at 06:00 also ends 17:00', () => {
    expect(fmt(defaultSlot(DAY, { mode: 'walk_in', now: at(10) }).end)).toBe('2026-12-01 17:00');
    const early = defaultSlot(DAY, { mode: 'walk_in', now: at(6) });
    expect([fmt(early.end), early.available]).toEqual(['2026-12-01 17:00', true]);
  });
  it('Night is not offered at 10:00 (window opens in 8 h) but is from 16:00 (early arrival)', () => {
    expect(defaultSlot(NIGHT, { mode: 'walk_in', now: at(10) }).available).toBe(false);
    const s = defaultSlot(NIGHT, { mode: 'walk_in', now: at(16) });
    expect([fmt(s.end), s.available]).toEqual(['2026-12-02 08:00', true]);
  });
  it('a "future" booking for today never starts in the past', () => {
    const day = defaultSlot(DAY, { mode: 'future', date: '2026-12-01', now: at(11, 3) });
    expect(fmt(day.start)).toBe('2026-12-01 11:05');
    const short = defaultSlot(SHORT, { mode: 'future', date: '2026-12-01', now: at(11, 3) });
    expect(fmt(short.start)).toBe('2026-12-01 11:05');
    const lateDay = defaultSlot(DAY, { mode: 'future', date: '2026-12-01', now: at(16) });
    expect(lateDay.available).toBe(false);
  });
  it('startsTooEarly: 5 min grace for future bookings, 60 min for late walk-in entry', () => {
    const now = at(12);
    expect(startsTooEarly(at(11, 50), now, 'future')).toBe(true);
    expect(startsTooEarly(at(11, 58), now, 'future')).toBe(false);
    expect(startsTooEarly(at(11, 30), now, 'walk_in')).toBe(false);
    expect(startsTooEarly(at(10, 30), now, 'walk_in')).toBe(true);
  });
});

describe('availability by date', () => {
  const day = '2026-12-01';
  const before = fromColombo(2026, 11, 30, 9);
  it('an empty room is free all day', () => {
    const r = roomDaySchedule(room, [], day, before, 30);
    expect(r.freeness).toBe('all');
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]).toMatchObject({ kind: 'free' });
    expect(clock24(r.segments[0].start)).toBe('00:00');
  });
  it('shows bookings with exact times and free windows shrunk by the cleaning buffer', () => {
    const dayB = booking({ id: 'd' });
    const nightB = booking({ id: 'n', booking_type: 'night', status: 'checked_in',
      check_in_time: fromColombo(2026, 12, 1, 18).toISOString(), check_out_time: fromColombo(2026, 12, 2, 8).toISOString() });
    const r = roomDaySchedule(room, [dayB, nightB, booking({ id: 'x', status: 'cancelled' })], day, before, 30);
    const view = r.segments.map((s) => `${s.kind} ${clock24(s.start)}-${clock24(s.end)}`);
    expect(view).toEqual(['free 00:00-07:30', 'booked 08:00-17:00', 'occupied 18:00-08:00']);
    expect(r.freeness).toBe('some');
    const night = r.segments[2];
    expect(night.kind === 'occupied' && night.intoNextDay).toBe(true);
  });
  it('drops gaps shorter than an hour', () => {
    const a = booking({ id: 'a', check_in_time: fromColombo(2026, 12, 1, 0).toISOString(), check_out_time: fromColombo(2026, 12, 1, 12).toISOString() });
    const b = booking({ id: 'b', check_in_time: fromColombo(2026, 12, 1, 13).toISOString(), check_out_time: fromColombo(2026, 12, 2, 9).toISOString() });
    const r = roomDaySchedule(room, [a, b], day, before, 30);
    expect(r.freeness).toBe('none');
    expect(r.segments.every((s) => s.kind !== 'free')).toBe(true);
  });
  it('today: free time starts now, not at midnight', () => {
    const r = roomDaySchedule(room, [], day, fromColombo(2026, 12, 1, 14, 20), 30);
    expect(clock24(r.segments[0].start)).toBe('14:20');
    expect(r.firstFree && clock24(r.firstFree)).toBe('14:20');
  });
  it('a booking from the previous night is marked as continuing', () => {
    const prev = booking({ id: 'p', status: 'checked_in', check_in_time: fromColombo(2026, 11, 30, 18).toISOString(), check_out_time: fromColombo(2026, 12, 1, 8).toISOString() });
    const r = roomDaySchedule(room, [prev], day, before, 30);
    expect(r.segments[0]).toMatchObject({ kind: 'occupied', fromPreviousDay: true });
    expect(clock24(r.segments[1].start)).toBe('08:30');
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
  it('normalises Sri Lankan formats to 0XXXXXXXXX / wa.me 94…', () => {
    for (const p of ['0771234567', '077 123 4567', '+94 77 123 4567', '94771234567', '771234567', '0094771234567']) {
      expect(parsePhone(p)).toMatchObject({ kind: 'lk', stored: '0771234567', waDigits: '94771234567' });
    }
    expect(formatPhone('+94771234567')).toBe('077 123 4567');
  });
  it('accepts international numbers with + or 00 and keeps their country code', () => {
    expect(parsePhone('+44 7911 123456')).toEqual({ kind: 'intl', waDigits: '447911123456', stored: '+447911123456', display: '+447911123456' });
    expect(parsePhone('0049 1512 3456789')).toMatchObject({ kind: 'intl', stored: '+4915123456789' });
    expect(parsePhone('+86 138 1234 5678')).toMatchObject({ kind: 'intl', waDigits: '8613812345678' });
    expect(parsePhone('+1 (415) 555-0123')).toMatchObject({ kind: 'intl', waDigits: '14155550123' });
  });
  it('rejects junk, too-short/too-long numbers and foreign numbers without +', () => {
    for (const p of ['12345', '+1234567', '+1234567890123456', '+0123456789', '447911123456', '']) {
      expect(parsePhone(p)).toBeNull();
    }
  });
  it('builds a wa.me link with booking details (local and international)', () => {
    const b = booking({ guest_name: 'සමන්', payments: [{ id: 'p', booking_id: 'b', kind: 'advance', method: 'cash', amount: 1000, paid_at: '', created_by: null }] });
    const msg = confirmationMessage(b, room, 'Tranquil Rest');
    expect(msg).toContain('*Tranquil Rest*');
    expect(msg).toContain('2026-12-01 08:00');
    expect(msg).toContain('Advance Paid: Rs. 1,000');
    expect(msg).toContain('Balance Due: Rs. 1,000');
    expect(whatsappLink('0771234567', msg)).toMatch(/^https:\/\/wa\.me\/94771234567\?text=/);
    expect(whatsappLink('+447911123456', msg)).toMatch(/^https:\/\/wa\.me\/447911123456\?text=/);
    expect(whatsappLink('447911123456', msg)).toBeNull();
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

describe('refunds', () => {
  it('reduce what was paid, cash in hand and the month\'s collected money', () => {
    const pay = { id: 'p', booking_id: 'b', kind: 'advance' as const, method: 'cash' as const, amount: 1500, paid_at: fromColombo(2026, 12, 1, 9).toISOString(), created_by: null };
    const refund = { id: 'r', booking_id: 'b', method: 'cash' as const, amount: 1000, reason: 'cancellation', refunded_at: fromColombo(2026, 12, 1, 15).toISOString(), created_by: null };
    const b = booking({ status: 'cancelled', payments: [pay], refunds: [refund] });
    expect(paidTotal(b)).toBe(500);
    expect(cashInHand([pay], fromColombo(2026, 12, 1), fromColombo(2026, 12, 2), [refund])).toBe(500);
    const s = summarizeMonth('2026-12', [b], [pay], [], [room], [refund]);
    expect(s.collected).toEqual({ cash: 500, bank: 0, total: 500 });
    expect(s.refunded.total).toBe(1000);
    expect(s.netProfit).toBe(500);
    expect(s.daily[0].collected).toBe(500);
  });
  it('older bookings without a refunds list still work', () => {
    const { refunds: _r, ...old } = booking({ payments: [{ id: 'p', booking_id: 'b', kind: 'advance', method: 'cash', amount: 700, paid_at: '', created_by: null }] });
    expect(paidTotal(old)).toBe(700);
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

describe('password generator', () => {
  it('makes 3 groups of 4 unambiguous characters', async () => {
    const { generatePassword } = await import('./password');
    for (let i = 0; i < 50; i++) {
      const p = generatePassword();
      expect(p).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
    }
    expect(new Set(Array.from({ length: 50 }, () => generatePassword())).size).toBe(50);
  });
});

describe('offline PIN verifier', () => {
  it('uses a salted PBKDF2 hash that checks the right PIN only', async () => {
    const { createVerifier, checkVerifier } = await import('./pinVerifier');
    const v = await createVerifier('user-1', '4826', 1000);
    expect(v.hash).not.toContain('4826');
    expect(await checkVerifier(v, 'user-1', '4826')).toBe(true);
    expect(await checkVerifier(v, 'user-1', '0000')).toBe(false);
    expect(await checkVerifier(v, 'user-2', '4826')).toBe(false);
    const v2 = await createVerifier('user-1', '4826', 1000);
    expect(v2.salt).not.toBe(v.salt);
    expect(v2.hash).not.toBe(v.hash);
  });
});
