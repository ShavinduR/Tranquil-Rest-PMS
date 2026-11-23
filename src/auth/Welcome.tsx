import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Home, ShieldCheck, ArrowLeft, Languages } from 'lucide-react';
import { useAuth } from './AuthContext';
import { isDemo } from '../data';
import { resetDemo } from '../data/demoRepo';
import { BigButton, ErrorNote, cx } from '../components/ui';
import { useAuthText } from '../i18n/authText';

const LangToggle = ({ label, onClick, light }: { label: string; onClick: () => void; light?: boolean }) => (
  <button type="button" onClick={onClick}
    className={cx('si ml-auto flex min-h-11 items-center gap-2 rounded-xl px-3 text-base font-semibold',
      light ? 'bg-white/15 text-white active:bg-white/30' : 'bg-slate-100 text-slate-700 active:bg-slate-200')}>
    <Languages className="size-5" aria-hidden /> {label}
  </button>
);

/** First screen on a new device: the owner chooses what this device is for. */
export const Welcome = () => {
  const navigate = useNavigate();
  const { t, toggle } = useAuthText();
  return (
    <div className="si flex min-h-dvh flex-col justify-center gap-4 bg-gradient-to-b from-teal-700 to-teal-950 p-6">
      <LangToggle label={t.switchTo} onClick={toggle} light />
      <div className="mb-4 text-center text-white">
        <img src="/logo-white.svg" alt="" className="mx-auto h-32 w-auto" />
        <h1 className="mt-3 text-4xl font-extrabold">Tranquil Rest</h1>
        <p className="text-lg opacity-80">{t.subtitle}</p>
      </div>
      <BigButton size="xl" tone="neutral" icon={<Home className="size-8 text-teal-700" aria-hidden />} onClick={() => navigate('/login?as=caretaker')}>
        {t.caretakerDevice}
      </BigButton>
      <BigButton size="lg" tone="primary" className="border-2 border-white/40" icon={<ShieldCheck className="size-7" aria-hidden />} onClick={() => navigate('/login?as=admin')}>
        {t.ownerLogin}
      </BigButton>
      {isDemo && (
        <div className="mt-4 rounded-2xl bg-white/10 p-4 text-sm text-white/90">
          <p className="font-bold">{t.demoTitle}</p>
          <p>{t.demoBody}</p>
          <button type="button" className="mt-2 underline" onClick={resetDemo}>{t.demoReset}</button>
        </div>
      )}
    </div>
  );
};

export const LoginPage = () => {
  const [params] = useSearchParams();
  const as = params.get('as') === 'admin' ? 'admin' : 'caretaker';
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { t, toggle } = useAuthText();
  const [email, setEmail] = useState(isDemo ? (as === 'admin' ? 'admin@demo' : 'caretaker@demo') : '');
  const [password, setPassword] = useState(isDemo ? 'demo' : '');
  const [error, setError] = useState<'wrong' | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error && /invalid/i.test(err.message) ? 'wrong' : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="si flex min-h-dvh flex-col justify-center bg-slate-100 p-6">
      <form onSubmit={submit} className="mx-auto w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-lg">
        <div className="flex items-center">
          <button type="button" onClick={() => navigate('/')} className="flex min-h-11 items-center gap-1 text-slate-600">
            <ArrowLeft className="size-5" /> {t.back}
          </button>
          <LangToggle label={t.switchTo} onClick={toggle} />
        </div>
        <img src="/logo.svg" alt="Tranquil Rest" className="mx-auto h-20 w-auto" />
        <h1 className="text-2xl font-bold">{as === 'admin' ? t.titleOwner : t.titleCaretaker}</h1>
        {as === 'caretaker' && <p className="text-slate-600">{t.caretakerHelp}</p>}
        <label className="block">
          <span className="mb-1 block font-semibold">{t.email}</span>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            className="min-h-12 w-full rounded-xl border-2 border-slate-300 px-3 text-lg outline-none focus:border-teal-700" />
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold">{t.password}</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="min-h-12 w-full rounded-xl border-2 border-slate-300 px-3 text-lg outline-none focus:border-teal-700" />
        </label>
        <ErrorNote>{error ? t[error] : null}</ErrorNote>
        <BigButton type="submit" busy={busy}>{t.signIn}</BigButton>
      </form>
    </div>
  );
};
