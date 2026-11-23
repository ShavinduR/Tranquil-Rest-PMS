import type { Booking, SlotIssue } from '../types';

type Interval = { start: number; end: number };

const toInterval = (startIso: string, endIso: string): Interval => ({
  start: new Date(startIso).getTime(),
  end: new Date(endIso).getTime(),
});

/** NewStart < ExistingEnd AND NewEnd > ExistingStart */
export const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && a.end > b.start;

/**
 * Mirrors public.check_booking_slot(): hard overlaps block saving; slots that only
 * touch the cleaning buffer produce a warning the caretaker can accept.
 */
export const findSlotIssues = (
  bookings: readonly Booking[],
  roomId: string,
  start: Date,
  end: Date,
  bufferMinutes: number,
  excludeId?: string,
): SlotIssue[] => {
  const proposed = { start: start.getTime(), end: end.getTime() };
  const buffer = bufferMinutes * 60_000;
  return bookings
    .filter((b) => b.room_id === roomId && b.status !== 'cancelled' && b.id !== excludeId)
    .flatMap((b): SlotIssue[] => {
      const existing = toInterval(b.check_in_time, b.check_out_time);
      const padded = { start: existing.start - buffer, end: existing.end + buffer };
      if (!overlaps(proposed, padded)) return [];
      return [
        {
          booking_id: b.id,
          kind: overlaps(proposed, existing) ? 'overlap' : 'buffer',
          check_in_time: b.check_in_time,
          check_out_time: b.check_out_time,
          guest_name: b.guest_name,
        },
      ];
    })
    .sort((a, b) => a.check_in_time.localeCompare(b.check_in_time));
};

export const hasOverlap = (issues: readonly SlotIssue[]): boolean => issues.some((i) => i.kind === 'overlap');
