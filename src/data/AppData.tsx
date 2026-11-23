import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Booking, Payment, ReferenceData } from '../types';
import { addDaysKey, dateKey, startOfDay } from '../lib/time';
import { useOnline } from '../hooks/useOnline';
import { repo } from '.';
import { loadSnapshot, saveSnapshot } from './cache';

type AppData = {
  ready: boolean;
  reference: ReferenceData | null;
  bookings: Booking[];
  todayPayments: Payment[];
  /** True when showing the offline snapshot instead of live data. */
  stale: boolean;
  lastSync: string | null;
  online: boolean;
  /** Writes are only allowed with a live connection. */
  canWrite: boolean;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AppData | null>(null);

/** Operational window: yesterday → 8 days ahead (covers "today + next 7 days"). */
const windowBounds = () => {
  const today = dateKey(new Date());
  return {
    from: startOfDay(addDaysKey(today, -1)),
    to: startOfDay(addDaysKey(today, 8)),
    dayStart: startOfDay(today),
    dayEnd: startOfDay(addDaysKey(today, 1)),
  };
};

export const AppDataProvider = ({ userId, children }: { userId: string; children: ReactNode }) => {
  const online = useOnline();
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [todayPayments, setTodayPayments] = useState<Payment[]>([]);
  const [stale, setStale] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const inflight = useRef<Promise<void> | null>(null);

  const applySnapshot = useCallback(() => {
    const snap = loadSnapshot(userId);
    if (snap) {
      setReference(snap.reference);
      setBookings(snap.bookings);
      setTodayPayments(snap.todayPayments);
      setLastSync(snap.savedAt);
    }
    setStale(true);
    setReady(true);
  }, [userId]);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      if (!navigator.onLine) {
        applySnapshot();
        return;
      }
      try {
        const { from, to, dayStart, dayEnd } = windowBounds();
        const [ref, list, pays] = await Promise.all([
          repo.loadReference(),
          repo.listBookings(from, to),
          repo.listPayments(dayStart, dayEnd),
        ]);
        const savedAt = new Date().toISOString();
        setReference(ref);
        setBookings(list);
        setTodayPayments(pays);
        setLastSync(savedAt);
        setStale(false);
        setReady(true);
        saveSnapshot({ savedAt, userId, reference: ref, bookings: list, todayPayments: pays });
      } catch {
        applySnapshot();
      }
    })();
    inflight.current = run;
    try {
      await run;
    } finally {
      inflight.current = null;
    }
  }, [applySnapshot, userId]);

  useEffect(() => {
    void refresh();
    const unsub = repo.subscribe(() => void refresh());
    const id = setInterval(() => void refresh(), 60_000);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    if (online) void refresh();
    else setStale(true);
  }, [online, refresh]);

  const value = useMemo<AppData>(
    () => ({ ready, reference, bookings, todayPayments, stale, lastSync, online, canWrite: online && !stale, refresh }),
    [ready, reference, bookings, todayPayments, stale, lastSync, online, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useAppData = (): AppData => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppData outside AppDataProvider');
  return v;
};
