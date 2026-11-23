import { Outlet, useNavigate } from 'react-router-dom';
import { Lock, RefreshCw, LayoutDashboard } from 'lucide-react';
import { useAuth, useProfile } from '../auth/AuthContext';
import { useAppData } from '../data/AppData';
import { OfflineBanner } from '../components/ui';
import { si, fullDateSi } from '../i18n/si';
import { useNow } from '../hooks/useNow';

export const CaretakerLayout = () => {
  const { lock } = useAuth();
  const profile = useProfile();
  const { stale, online, lastSync, refresh, reference } = useAppData();
  const navigate = useNavigate();
  const now = useNow(60_000);

  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-slate-100">
      {(!online || stale) && <OfflineBanner lastSync={lastSync} />}
      <header className="si flex items-center gap-2 bg-teal-700 px-3 py-2 text-white">
        <button type="button" onClick={() => navigate('/caretaker')} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <img src="/logo-white.svg" alt="" className="h-11 w-auto shrink-0" />
          <span className="min-w-0">
          <div className="truncate text-xl font-extrabold">{reference?.settings.property_name ?? si.appName}</div>
          <div className="truncate text-sm opacity-85">{fullDateSi(now)}</div>
          </span>
        </button>
        {profile.role === 'admin' && (
          <button type="button" onClick={() => navigate('/admin')} aria-label="Admin" className="flex min-h-12 items-center gap-1 rounded-xl bg-white/15 px-3 font-semibold">
            <LayoutDashboard className="size-6" />
          </button>
        )}
        <button type="button" onClick={() => void refresh()} aria-label="යාවත්කාලීන කරන්න" className="flex size-12 items-center justify-center rounded-xl bg-white/15 active:bg-white/30">
          <RefreshCw className="size-6" />
        </button>
        {profile.role === 'caretaker' && (
          <button type="button" onClick={lock} className="flex min-h-12 items-center gap-1 rounded-xl bg-white/15 px-3 text-base font-semibold active:bg-white/30">
            <Lock className="size-5" aria-hidden /> {si.actions.lock}
          </button>
        )}
      </header>
      <Outlet />
    </div>
  );
};
