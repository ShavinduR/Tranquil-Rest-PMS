import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { repo } from '../data';
import type { Session } from '../data/repo';
import type { Profile } from '../types';
import { clearSnapshot } from '../data/cache';

type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; session: Session; profile: Profile };

type AuthValue = {
  state: AuthState;
  locked: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  unlock: (pin: string) => Promise<'ok' | 'wrong' | 'offline_unknown'>;
  lock: () => void;
};

const Ctx = createContext<AuthValue | null>(null);

const PROFILE_KEY = 'tr-profile';
const PIN_CHECK_KEY = 'tr-pin-check';
const UNLOCKED_KEY = 'tr-unlocked-at';
const IDLE_LOCK_MS = 10 * 60_000;

const sha256 = async (text: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
};

const readCachedProfile = (userId: string): Profile | null => {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Profile | null;
    return p && p.id === userId ? p : null;
  } catch {
    return null;
  }
};

/** Caretakers are re-locked on every cold start and after 10 idle minutes. */
const freshlyUnlocked = (): boolean => {
  const at = Number(sessionStorage.getItem(UNLOCKED_KEY) ?? 0);
  return Date.now() - at < IDLE_LOCK_MS;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [locked, setLocked] = useState(() => !freshlyUnlocked());
  const lastActivity = useRef(Date.now());

  const resolve = useCallback(async (session: Session | null) => {
    if (!session) {
      setState({ status: 'signed_out' });
      return;
    }
    try {
      const profile = await repo.getProfile();
      if (!profile || !profile.active) {
        await repo.signOut();
        setState({ status: 'signed_out' });
        return;
      }
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      setState({ status: 'signed_in', session, profile });
    } catch {
      // Offline at start-up: trust the cached profile for read-only use.
      const cached = readCachedProfile(session.userId);
      setState(cached ? { status: 'signed_in', session, profile: cached } : { status: 'signed_out' });
    }
  }, []);

  useEffect(() => {
    void repo.getSession().then(resolve);
    return repo.onSessionChange((s) => {
      void resolve(s);
    });
  }, [resolve]);

  // Remote sign-out: if the owner deactivates this account (Settings → Staff),
  // the device signs itself out at the next check. Offline checks are skipped.
  const signedInId = state.status === 'signed_in' ? state.session.userId : null;
  useEffect(() => {
    if (!signedInId) return;
    const check = async () => {
      if (!navigator.onLine) return;
      try {
        const profile = await repo.getProfile();
        if (!profile || !profile.active) {
          await repo.signOut();
          localStorage.removeItem(PROFILE_KEY);
          localStorage.removeItem(PIN_CHECK_KEY);
          sessionStorage.removeItem(UNLOCKED_KEY);
          clearSnapshot();
          setState({ status: 'signed_out' });
        }
      } catch {
        // Network trouble is not a reason to sign anyone out.
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && void check();
    const id = setInterval(() => void check(), 2 * 60_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [signedInId]);

  // Idle auto-lock for caretaker devices.
  useEffect(() => {
    const touch = () => {
      lastActivity.current = Date.now();
      if (!locked) sessionStorage.setItem(UNLOCKED_KEY, String(Date.now()));
    };
    const check = () => {
      if (Date.now() - lastActivity.current > IDLE_LOCK_MS) setLocked(true);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(check, 30_000);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(id);
    };
  }, [locked]);

  const value = useMemo<AuthValue>(
    () => ({
      state,
      locked,
      signIn: async (email, password) => {
        await repo.signIn(email, password);
        sessionStorage.setItem(UNLOCKED_KEY, String(Date.now()));
        setLocked(false);
      },
      signOut: async () => {
        await repo.signOut();
        localStorage.removeItem(PROFILE_KEY);
        localStorage.removeItem(PIN_CHECK_KEY);
        sessionStorage.removeItem(UNLOCKED_KEY);
        clearSnapshot();
        setState({ status: 'signed_out' });
      },
      unlock: async (pin) => {
        if (state.status !== 'signed_in') return 'wrong';
        const digest = await sha256(`${state.session.userId}:${pin}`);
        let ok: boolean;
        try {
          ok = await repo.verifyPin(pin);
          if (ok) localStorage.setItem(PIN_CHECK_KEY, digest);
        } catch {
          // Offline: fall back to the digest stored after the last online unlock.
          const stored = localStorage.getItem(PIN_CHECK_KEY);
          if (!stored) return 'offline_unknown';
          ok = stored === digest;
        }
        if (!ok) return 'wrong';
        lastActivity.current = Date.now();
        sessionStorage.setItem(UNLOCKED_KEY, String(Date.now()));
        setLocked(false);
        return 'ok';
      },
      lock: () => {
        sessionStorage.removeItem(UNLOCKED_KEY);
        setLocked(true);
      },
    }),
    [state, locked],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useAuth = (): AuthValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
};

export const useProfile = (): Profile => {
  const { state } = useAuth();
  if (state.status !== 'signed_in') throw new Error('useProfile requires a signed-in user');
  return state.profile;
};
