import type { Booking, Payment, ReferenceData, Refund } from '../types';

/**
 * Read-only offline snapshot: reference data + bookings from yesterday to 7 days
 * ahead + today's payments and refunds. Written after every successful online refresh.
 */
export type Snapshot = {
  savedAt: string;
  userId: string;
  reference: ReferenceData;
  bookings: Booking[];
  todayPayments: Payment[];
  /** Missing in snapshots saved by older versions. */
  todayRefunds?: Refund[];
};

const KEY = 'tr-offline-snapshot-v1';

export const saveSnapshot = (s: Snapshot): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked (private mode): offline view simply won't be available.
  }
};

export const loadSnapshot = (userId: string): Snapshot | null => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Snapshot;
    return s.userId === userId ? s : null;
  } catch {
    return null;
  }
};

export const clearSnapshot = (): void => localStorage.removeItem(KEY);
