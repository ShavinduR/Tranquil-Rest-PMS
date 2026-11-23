/**
 * Asia/Colombo is a fixed UTC+05:30 with no daylight saving, so we convert with
 * plain arithmetic instead of depending on the device's timezone (staff phones
 * are not always set correctly).
 */
export const COLOMBO_OFFSET_MIN = 330;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

export const colomboParts = (date: Date): LocalParts => {
  const shifted = new Date(date.getTime() + COLOMBO_OFFSET_MIN * MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
};

export const fromColombo = (year: number, month: number, day: number, hour = 0, minute = 0): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, minute) - COLOMBO_OFFSET_MIN * MINUTE);

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' in Colombo */
export const dateKey = (date: Date): string => {
  const p = colomboParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

export const parseDateKey = (key: string): { year: number; month: number; day: number } => {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
};

export const startOfDay = (key: string): Date => {
  const { year, month, day } = parseDateKey(key);
  return fromColombo(year, month, day);
};

export const addDaysKey = (key: string, days: number): string => dateKey(new Date(startOfDay(key).getTime() + days * DAY + 6 * 3600_000));

export const addMinutes = (date: Date, minutes: number): Date => new Date(date.getTime() + minutes * MINUTE);

/** 'HH:MM' or 'HH:MM:SS' → minutes after midnight */
export const parseClock = (clock: string): number => {
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + (m || 0);
};

export const atClock = (key: string, clock: string): Date => addMinutes(startOfDay(key), parseClock(clock));

/** 'YYYY-MM' month key in Colombo */
export const monthKey = (date: Date): string => dateKey(date).slice(0, 7);

export const monthRange = (key: string): { start: Date; end: Date } => {
  const [year, month] = key.split('-').map(Number);
  const start = fromColombo(year, month, 1);
  const end = month === 12 ? fromColombo(year + 1, 1, 1) : fromColombo(year, month + 1, 1);
  return { start, end };
};

export const shiftMonth = (key: string, delta: number): string => {
  const [year, month] = key.split('-').map(Number);
  const idx = year * 12 + (month - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
};

export const daysInMonth = (key: string): number => {
  const { start, end } = monthRange(key);
  return Math.round((end.getTime() - start.getTime()) / DAY);
};

/** Value for <input type="datetime-local"> in Colombo time */
export const toLocalInput = (date: Date): string => {
  const p = colomboParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
};

export const fromLocalInput = (value: string): Date => {
  const [d, t] = value.split('T');
  return atClock(d, t ?? '00:00');
};

export const clock24 = (date: Date): string => {
  const p = colomboParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
};

/** Round up to the next 5-minute mark — walk-ins start "now", but tidy. */
export const roundUp5 = (date: Date): Date => {
  const ms = 5 * MINUTE;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
};

export const minutesBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / MINUTE);
