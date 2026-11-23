import type { BookingType, PricingRule, RoomCategory } from '../types';
import { addMinutes, atClock, dateKey, parseClock, roundUp5 } from './time';

export const findRule = (
  pricing: readonly PricingRule[],
  category: RoomCategory,
  type: BookingType,
): PricingRule | undefined => pricing.find((r) => r.category === category && r.booking_type === type);

export type Slot = { start: Date; end: Date };

/** Minimum time a fixed-window walk-in must still have left before we roll it to the next window. */
const MIN_REMAINING_MIN = 60;

/**
 * Computes the default check-in/check-out for a booking type.
 * - Duration types (Short Time, Full Day): start → start + duration.
 * - Window types (Day 08–17, Night 18–08): future bookings start at the window
 *   start on the chosen date; walk-ins start now and end at the next window end.
 */
export const defaultSlot = (
  rule: PricingRule,
  opts: { mode: 'walk_in'; now: Date } | { mode: 'future'; date: string; startClock?: string },
): Slot => {
  if (rule.duration_minutes && !(rule.default_start_time && rule.default_end_time)) {
    const start =
      opts.mode === 'walk_in' ? roundUp5(opts.now) : atClock(opts.date, opts.startClock ?? defaultFutureClock(rule));
    return { start, end: addMinutes(start, rule.duration_minutes) };
  }

  const startClock = rule.default_start_time ?? '08:00';
  const endClock = rule.default_end_time ?? '17:00';
  const overnight = parseClock(endClock) <= parseClock(startClock);

  if (opts.mode === 'future') {
    const start = atClock(opts.date, opts.startClock ?? startClock);
    const end = atClock(opts.date, endClock);
    return { start, end: overnight || end <= start ? addMinutes(end, 24 * 60) : end };
  }

  const start = roundUp5(opts.now);
  let end = atClock(dateKey(start), endClock);
  while (end.getTime() - start.getTime() < MIN_REMAINING_MIN * 60_000) end = addMinutes(end, 24 * 60);
  return { start, end };
};

const defaultFutureClock = (rule: PricingRule): string =>
  rule.booking_type === 'full_day' ? '12:00' : '10:00';
