import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import { PinLock } from './auth/PinLock';
import { LoginPage, Welcome } from './auth/Welcome';
import { AppDataProvider } from './data/AppData';
import { Spinner } from './components/ui';
import { CaretakerLayout } from './caretaker/CaretakerLayout';
import { CaretakerHome } from './caretaker/Home';
import { BookingForm } from './caretaker/BookingForm';
import { BookingPage } from './caretaker/BookingPage';
import { RoomPage } from './caretaker/RoomPage';
import { Availability } from './caretaker/Availability';
import { AdminLayout } from './admin/AdminLayout';
import { Dashboard } from './admin/Dashboard';
import { AdminBookings } from './admin/Bookings';
import { Expenses } from './admin/Expenses';
import { SettingsPage } from './admin/Settings';
import { AuditPage } from './admin/Audit';
import { RestorePage } from './admin/Restore';

/** Signed-in gate. Caretakers must also pass the PIN lock; admin routes require the admin role. */
const Protected = ({ adminOnly, children }: { adminOnly?: boolean; children: ReactNode }) => {
  const { state, locked } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'signed_out') return <Navigate to="/" replace state={{ from: location.pathname }} />;
  if (adminOnly && state.profile.role !== 'admin') return <Navigate to="/caretaker" replace />;
  if (state.profile.role === 'caretaker' && locked) return <PinLock />;
  return <AppDataProvider userId={state.session.userId}>{children}</AppDataProvider>;
};

const Root = () => {
  const { state } = useAuth();
  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'signed_out') return <Welcome />;
  return <Navigate to={state.profile.role === 'admin' ? '/admin' : '/caretaker'} replace />;
};

export const App = () => (
  <Routes>
    <Route path="/" element={<Root />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/caretaker" element={<Protected><CaretakerLayout /></Protected>}>
      <Route index element={<CaretakerHome />} />
      <Route path="new/:mode" element={<BookingForm />} />
      <Route path="room/:id" element={<RoomPage />} />
      <Route path="availability" element={<Availability />} />
      <Route path="booking/:id" element={<BookingPage />} />
    </Route>
    <Route path="/admin" element={<Protected adminOnly><AdminLayout /></Protected>}>
      <Route index element={<Dashboard />} />
      <Route path="bookings" element={<AdminBookings />} />
      <Route path="expenses" element={<Expenses />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="audit" element={<AuditPage />} />
      <Route path="restore" element={<RestorePage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);
