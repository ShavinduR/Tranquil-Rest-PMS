import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, BedDouble, Receipt, Settings, History, LogOut, Smartphone } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useAppData } from '../data/AppData';
import { OfflineBanner, cx } from '../components/ui';
import { isDemo } from '../data';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/bookings', label: 'Bookings', icon: BedDouble },
  { to: '/admin/expenses', label: 'Expenses', icon: Receipt },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/audit', label: 'Audit log', icon: History },
];

export const AdminLayout = () => {
  const { signOut, state } = useAuth();
  const { online, lastSync } = useAppData();
  const navigate = useNavigate();
  return (
    <div className="min-h-dvh bg-slate-50 md:flex">
      <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3 md:block">
          <div>
            <div className="text-lg font-bold text-teal-800">Tranquil Rest</div>
            <div className="text-xs text-slate-500">Admin · {state.status === 'signed_in' ? state.profile.display_name : ''}{isDemo ? ' · DEMO' : ''}</div>
          </div>
          <div className="flex gap-1 md:mt-3">
            <button type="button" onClick={() => navigate('/caretaker')} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" title="Caretaker view">
              <Smartphone className="size-5" />
            </button>
            <button type="button" onClick={() => void signOut().then(() => navigate('/'))} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" title="Sign out">
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => cx('flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium',
                isActive ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-100')}>
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1">
        {!online && <OfflineBanner lastSync={lastSync} />}
        <div className="mx-auto max-w-6xl p-4 md:p-6"><Outlet /></div>
      </main>
    </div>
  );
};
