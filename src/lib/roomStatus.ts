import type { Booking, Room } from '../types';
import { dateKey } from './time';

export type RoomState = 'available' | 'occupied' | 'booked_today' | 'cleaning';

export type RoomView = {
  room: Room;
  state: RoomState;
  /** The booking that explains the state (current guest or next arrival today). */
  booking: Booking | null;
  /** Next future booking (any day), for the card's sub-line. */
  next: Booking | null;
  overdueCheckout: boolean;
};

/** Priority: Occupied > Cleaning > Booked today > Available. */
export const roomView = (room: Room, bookings: readonly Booking[], now: Date): RoomView => {
  const mine = bookings
    .filter((b) => b.room_id === room.id)
    .sort((a, b) => a.check_in_time.localeCompare(b.check_in_time));
  const current = mine.find((b) => b.status === 'checked_in') ?? null;
  const today = dateKey(now);
  const upcoming = mine.filter((b) => b.status === 'booked' && new Date(b.check_out_time) > now);
  const todayArrival = upcoming.find((b) => dateKey(new Date(b.check_in_time)) <= today) ?? null;
  const next = upcoming[0] ?? null;

  if (current) {
    return { room, state: 'occupied', booking: current, next, overdueCheckout: new Date(current.check_out_time) < now };
  }
  if (room.housekeeping === 'cleaning') return { room, state: 'cleaning', booking: todayArrival, next, overdueCheckout: false };
  if (todayArrival) return { room, state: 'booked_today', booking: todayArrival, next, overdueCheckout: false };
  return { room, state: 'available', booking: null, next, overdueCheckout: false };
};
