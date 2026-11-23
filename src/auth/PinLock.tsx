import { useEffect, useState } from 'react';
import { Delete } from 'lucide-react';
import { useAuth } from './AuthContext';
import { si } from '../i18n/si';
import { isDemo } from '../data';
import { BigButton, Dialog, cx } from '../components/ui';
import { useNavigate } from 'react-router-dom';

/** The server decides when to lock; this only remembers the lock across reloads. */
const BLOCKED_KEY = 'tr-pin-blocked-until';
/** The server locks on the 5th wrong PIN but can only report it on the next try, so show it straight away. */
const STREAK_KEY = 'tr-pin-wrong-streak';
const SERVER_MAX_WRONG = 5;
const FIRST_LOCK_SECONDS = 60;

/** Large 3×4 keypad; auto-submits on the 4th digit. */
export const PinLock = () => {
  const { unlock, state, signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmOut, setConfirmOut] = useState(false);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState(() => Number(localStorage.getItem(BLOCKED_KEY) ?? 0));
  const [checking, setChecking] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const blocked = tick < blockedUntil;
  const secondsLeft = Math.max(0, Math.ceil((blockedUntil - tick) / 1000));

  // Live countdown while locked.
  useEffect(() => {
    if (!blocked) {
      if (blockedUntil) { localStorage.removeItem(BLOCKED_KEY); setBlockedUntil(0); setMessage(null); }
      return;
    }
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [blocked, blockedUntil]);

  useEffect(() => {
    if (pin.length !== 4) return;
    setChecking(true);
    void unlock(pin).then((r) => {
      setChecking(false);
      if (r === 'ok') { localStorage.removeItem(STREAK_KEY); return; }
      setPin('');
      if (r === 'offline_unknown') { setMessage(si.pin.offlineFirst); return; }
      const lockFor = (seconds: number) => {
        const until = Date.now() + seconds * 1000;
        localStorage.setItem(BLOCKED_KEY, String(until));
        setTick(Date.now());
        setBlockedUntil(until);
        setMessage(null);
        localStorage.removeItem(STREAK_KEY);
      };
      if (typeof r === 'object') { lockFor(r.lockedFor); return; }
      if (r === 'wrong') {
        const streak = Number(localStorage.getItem(STREAK_KEY) ?? 0) + 1;
        if (streak >= SERVER_MAX_WRONG) { lockFor(FIRST_LOCK_SECONDS); return; }
        localStorage.setItem(STREAK_KEY, String(streak));
      }
      setMessage(si.pin.wrong);
    });
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  const press = (d: string) => {
    if (blocked || checking) return;
    setMessage(null);
    setPin((p) => (p.length < 4 ? p + d : p));
  };

  const name = state.status === 'signed_in' ? state.profile.display_name : '';

  return (
    <div className="si flex min-h-dvh flex-col items-center justify-center bg-teal-700 p-6 text-white">
      <img src="/logo-white.svg" alt="Tranquil Rest" className="h-24 w-auto" />
      <h1 className="mt-3 text-center text-2xl font-bold">{si.pin.title}</h1>
      {name && <p className="text-lg opacity-80">{name}</p>}
      {isDemo && <p className="mt-1 rounded-lg bg-white/15 px-3 text-base">{si.pin.demo}</p>}

      <div className="my-6 flex gap-4" aria-live="polite" aria-label={`${pin.length} / 4`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cx('size-6 rounded-full border-4 border-white', i < pin.length && 'bg-white')} />
        ))}
      </div>
      <p role="alert" className="mb-4 min-h-8 text-center text-xl font-bold text-yellow-300">
        {blocked ? si.pin.lockedFor(secondsLeft) : message}
      </p>

      <div className="grid w-full max-w-xs grid-cols-3 gap-4">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} onClick={() => press(d)} disabled={blocked}>{d}</Key>
        ))}
        <Key onClick={() => setPin('')} disabled={blocked} small>{si.pin.clear}</Key>
        <Key onClick={() => press('0')} disabled={blocked}>0</Key>
        <Key onClick={() => setPin((p) => p.slice(0, -1))} disabled={blocked} label="මකන්න"><Delete className="mx-auto size-9" /></Key>
      </div>

      {/* Deliberately small and two-step: signing out needs the owner to sign the phone in again. */}
      <button type="button" onClick={() => setConfirmOut(true)} className="mt-10 text-sm text-white/70 underline underline-offset-4">
        {si.pin.signOut}
      </button>
      <Dialog open={confirmOut} onClose={() => setConfirmOut(false)} labelledBy="signout-title">
        <div className="si text-slate-900">
          <h2 id="signout-title" className="text-2xl font-bold">{si.pin.signOutTitle}</h2>
          <p className="mt-2 text-lg">{si.pin.signOutBody}</p>
          <div className="mt-5 space-y-3">
            <BigButton tone="neutral" size="xl" onClick={() => setConfirmOut(false)}>{si.pin.signOutCancel}</BigButton>
            <BigButton tone="red" onClick={() => void signOut().then(() => navigate('/', { replace: true }))}>{si.pin.signOutConfirm}</BigButton>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

const Key = ({ children, onClick, disabled, small, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; small?: boolean; label?: string }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
    className={cx('aspect-square rounded-full bg-white/15 font-bold shadow-inner transition-transform active:scale-95 active:bg-white/30 disabled:opacity-40', small ? 'text-lg' : 'text-4xl')}>
    {children}
  </button>
);
