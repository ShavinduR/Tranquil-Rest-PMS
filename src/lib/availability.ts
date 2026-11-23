import type { Booking, Room } from '../types';
import { addDaysKey, addMinutes, startOfDay } from './time';

export type ScheduleSegment =
  | { kind: 'occupied' | 'booked'; start: Date; end: Date; booking: Booking; fromPreviousDay: boolean; intoNextDay: boolean }
  | { kind: 'free'; start: Date; end: Date };

export type RoomDay = {
  room: Room;
  segments: ScheduleSegment[];
  /** 'all' = free all (remaining) day, 'some' = partly free, 'none' = no usable free time. */
  freeness: 'all' | 'some' | 'none';
  firstFree: Date | null;
};

/** Free gaps shorter than this are not offered. */
export const MIN_FREE_MINUTES = 60;

/**
 * What a room looks like on one Sri Lanka calendar day.
 * - Busy segments are the bookings overlapping that day (cancelled and checked-out ignored).
 * - Free segments are the gaps, shrunk by the cleaning buffer around each booking and,
 *   for today, starting no earlier than now.
 */
export const roomDaySchedule = (
  room: Room,
  bookings: readonly Booking[],
  day: string,
  now: Date,
  bufferMinutes: number,
): RoomDay => {
  const dayStart = startOfDay(day);
  const dayEnd = startOfDay(addDaysKey(day, 1));
  const freeFrom = now > dayStart ? now : dayStart;

  const busy = bookings
    .filter((b) => b.room_id === room.id && (b.status === 'booked' || b.status === 'checked_in'))
    .filter((b) => new Date(b.check_in_time) < dayEnd && new Date(b.check_out_time) > dayStart)
    .sort((a, b) => a.check_in_time.localeCompare(b.check_in_time));

  const busySegments: ScheduleSegment[] = busy.map((b) => {
    const start = new Date(b.check_in_time);
    const end = new Date(b.check_out_time);
    return {
      kind: b.status === 'checked_in' ? 'occupied' : 'booked',
      start,
      end,
      booking: b,
      fromPreviousDay: start < dayStart,
      intoNextDay: end > dayEnd,
    };
  });

  const free: ScheduleSegment[] = [];
  let cursor = freeFrom;
  for (const b of busy) {
    const blockedFrom = addMinutes(new Date(b.check_in_time), -bufferMinutes);
    const blockedTo = addMinutes(new Date(b.check_out_time), bufferMinutes);
    if (blockedFrom > cursor) pushFree(free, cursor, blockedFrom < dayEnd ? blockedFrom : dayEnd);
    if (blockedTo > cursor) cursor = blockedTo;
  }
  if (cursor < dayEnd) pushFree(free, cursor, dayEnd);

  const segments = [...busySegments, ...free].sort((a, b) => a.start.getTime() - b.start.getTime());
  const usable = free.filter((f) => f.end.getTime() - f.start.getTime() >= MIN_FREE_MINUTES * 60_000);
  const wholeRemaining = busy.length === 0 && freeFrom < dayEnd;
  return {
    room,
    segments: segments.filter((s) => s.kind !== 'free' || usable.includes(s)),
    freeness: wholeRemaining ? 'all' : usable.length > 0 ? 'some' : 'none',
    firstFree: usable[0]?.start ?? null,
  };
};

const pushFree = (out: ScheduleSegment[], start: Date, end: Date) => {
  if (end > start) out.push({ kind: 'free', start, end });
};
