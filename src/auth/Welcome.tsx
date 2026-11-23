import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Home, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useAuth } from './AuthContext';
import { isDemo } from '../data';
import { resetDemo } from '../data/demoRepo';
import { BigButton, ErrorNote } from '../components/ui';

/** First screen on a new device: the owner chooses what this device is for. */
export const Welcome = () => {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-dvh flex-col justify-center gap-4 bg-gradient-to-b from-teal-700 to-teal-950 p-6">
      <div className="mb-4 text-center text-white">
        <img src="/logo-white.svg" alt="" className="mx-auto h-32 w-auto" />
        <h1 className="mt-3 text-4xl font-extrabold">Tranquil Rest</h1>
        <p className="si text-lg opacity-80">අමුත්තන් නිවාසය · Guest House</p>
      </div>
      <BigButton size="xl" tone="neutral" icon={<Home className="size-8 text-teal-700" aria-hidden />} onClick={() => navigate('/login?as=caretaker')}>
        සේවක උපාංගය · Caretaker device
      </BigButton>
      <BigButton size="lg" tone="primary" className="border-2 border-white/40" icon={<ShieldCheck className="size-7" aria-hidden />} onClick={() => navigate('/login?as=admin')}>
        Owner / Admin login
      </BigButton>
      {isDemo && (
        <div className="mt-4 rounded-2xl bg-white/10 p-4 text-sm text-white/90">
          <p className="font-bold">Demo mode</p>
          <p>No Supabase project is configured, so data is stored only in this browser. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to go live.</p>
          <button type="button" className="mt-2 underline" onClick={resetDemo}>Reset demo data</button>
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
  const [email, setEmail] = useState(isDemo ? (as === 'admin' ? 'admin@demo' : 'caretaker@demo') : '');
  const [password, setPassword] = useState(isDemo ? 'demo' : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error && /invalid/i.test(err.message) ? 'Wrong email or password.' : 'Could not sign in. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-slate-100 p-6">
      <form onSubmit={submit} className="mx-auto w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-lg">
        <button type="button" onClick={() => navigate('/')} className="flex items-center gap-1 text-slate-600">
          <ArrowLeft className="size-5" /> Back
        </button>
        <img src="/logo.svg" alt="Tranquil Rest" className="mx-auto h-20 w-auto" />
        <h1 className="text-2xl font-bold">{as === 'admin' ? 'Owner / Admin login' : 'Set up caretaker device'}</h1>
        {as === 'caretaker' && (
          <p className="text-slate-600">
            The owner signs in once with the caretaker account. After that the caretaker only uses their 4-digit PIN on this device.
          </p>
        )}
        <label className="block">
          <span className="mb-1 block font-semibold">Email</span>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            className="min-h-12 w-full rounded-xl border-2 border-slate-300 px-3 text-lg outline-none focus:border-teal-700" />
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold">Password</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="min-h-12 w-full rounded-xl border-2 border-slate-300 px-3 text-lg outline-none focus:border-teal-700" />
        </label>
        <ErrorNote>{error}</ErrorNote>
        <BigButton type="submit" busy={busy}>Sign in</BigButton>
      </form>
    </div>
  );
};
