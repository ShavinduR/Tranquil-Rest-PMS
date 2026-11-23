import type { BookingType, PricingRule, RoomCategory } from '../types';
import { addDaysKey, addMinutes, atClock, dateKey, parseClock, roundUp5 } from './time';

export const findRule = (
  pricing: readonly PricingRule[],
  category: RoomCategory,
  type: BookingType,
): PricingRule | undefined => pricing.find((r) => r.category === category && r.booking_type === type);

export type Slot = {
  start: Date;
  end: Date;
  /**
   * False when this booking type no longer makes sense for the chosen day, e.g. a
   * "Day" (08:00–17:00) booking asked for at 16:30. The form then disables the
   * preset and points the caretaker to Short Time instead.
   */
  available: boolean;
};

/** A window type must still have at least this long left to be offered today. */
export const MIN_WINDOW_REMAINING_MIN = 120;
/** Guests arriving up to this long before a window opens may check in early. */
export const EARLY_ARRIVAL_MIN = 180;

const isWindowRule = (rule: PricingRule): boolean => Boolean(rule.default_start_time && rule.default_end_time);

/** Window instances [start, end) that start yesterday, today and tomorrow (Colombo). */
const windowInstances = (rule: PricingRule, now: Date): { ws: Date; we: Date }[] => {
  const today = dateKey(now);
  const startClock = rule.default_start_time ?? '08:00';
  const endClock = rule.default_end_time ?? '17:00';
  const overnight = parseClock(endClock) <= parseClock(startClock);
  return [-1, 0, 1].map((d) => {
    const key = addDaysKey(today, d);
    const ws = atClock(key, startClock);
    const we = overnight ? addMinutes(atClock(key, endClock), 24 * 60) : atClock(key, endClock);
    return { ws, we };
  });
};

/** A window-type booking that starts now (walk-in, or a booking for later today that is already due). */
const windowFromNow = (rule: PricingRule, now: Date): Slot => {
  const start = roundUp5(now);
  const instances = windowInstances(rule, now);
  const current = instances.find((i) => i.ws <= now && now < i.we);
  if (current) {
    const remaining = (current.we.getTime() - start.getTime()) / 60_000;
    return { start, end: current.we, available: remaining >= MIN_WINDOW_REMAINING_MIN };
  }
  const next = instances.find((i) => i.ws > now);
  if (next && (next.ws.getTime() - now.getTime()) / 60_000 <= EARLY_ARRIVAL_MIN) {
    return { start, end: next.we, available: true }; // early arrival: stay until that window ends
  }
  // Outside the window and not about to open: never roll over to tomorrow's window.
  return { start, end: addMinutes(start, 60), available: false };
};

const defaultFutureClock = (rule: PricingRule): string => (rule.booking_type === 'full_day' ? '12:00' : '10:00');

/**
 * Default check-in/check-out for a booking type.
 * - Duration types (Short Time, Full Day): start → start + duration.
 * - Window types (Day 08–17, Night 18–08): on a future date the window itself;
 *   "now" (walk-in, or today) starts now and ends at the current window's end.
 * Never returns a start in the past.
 */
export const defaultSlot = (
  rule: PricingRule,
  opts: { mode: 'walk_in'; now: Date } | { mode: 'future'; date: string; now: Date; startClock?: string },
): Slot => {
  const nowStart = roundUp5(opts.now);
  const today = dateKey(opts.now);

  if (!isWindowRule(rule)) {
    const minutes = rule.duration_minutes ?? 180;
    let start = nowStart;
    if (opts.mode === 'future') {
      const wanted = atClock(opts.date, opts.startClock ?? defaultFutureClock(rule));
      start = wanted > nowStart ? wanted : nowStart;
    }
    return { start, end: addMinutes(start, minutes), available: opts.mode === 'walk_in' || opts.date >= today };
  }

  if (opts.mode === 'walk_in' || opts.date <= today) {
    const slot = windowFromNow(rule, opts.now);
    return opts.mode === 'future' && opts.date < today ? { ...slot, available: false } : slot;
  }

  const startClock = rule.default_start_time ?? '08:00';
  const endClock = rule.default_end_time ?? '17:00';
  const start = atClock(opts.date, opts.startClock ?? startClock);
  const end = atClock(opts.date, endClock);
  return { start, end: end <= start ? addMinutes(end, 24 * 60) : end, available: true };
};

/** How far back a new booking may start: a few minutes for future bookings, an hour to record a walk-in late. */
export const MAX_PAST_START_MIN = { walk_in: 60, future: 5 } as const;

export const startsTooEarly = (start: Date, now: Date, mode: 'walk_in' | 'future'): boolean =>
  start.getTime() < now.getTime() - MAX_PAST_START_MIN[mode] * 60_000;
