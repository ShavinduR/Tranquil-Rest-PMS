import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, DoorOpen, CalendarPlus, Sparkles, Brush, ChevronRight } from 'lucide-react';
import { useAppData } from '../data/AppData';
import { repo } from '../data';
import { useNow } from '../hooks/useNow';
import { roomView } from '../lib/roomStatus';
import { dateTimeSi, si, timeSi } from '../i18n/si';
import { formatLkPhone } from '../lib/phone';
import { BigButton, ErrorNote, Spinner, cx } from '../components/ui';

const tone = { available: 'bg-green-600', occupied: 'bg-red-600', booked_today: 'bg-orange-500', cleaning: 'bg-blue-600' } as const;

export const RoomPage = () => {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const now = useNow();
  const { reference, bookings, canWrite, refresh } = useAppData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const room = reference?.rooms.find((r) => r.id === id);
  if (!reference || !room) return <Spinner />;
  const view = roomView(room, bookings, now);
  const upcoming = bookings
    .filter((b) => b.room_id === id && (b.status === 'booked' || b.status === 'checked_in'))
    .sort((a, b) => a.check_in_time.localeCompare(b.check_in_time));

  const setHousekeeping = async (state: 'ready' | 'cleaning') => {
    setBusy(true);
    setError(null);
    try {
      await repo.setHousekeeping(id, state);
      await refresh();
    } catch {
      setError(si.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 p-3 pb-12">
      <header className="flex items-center gap-2">
        <button type="button" onClick={() => navigate('/caretaker')} className="si flex min-h-14 items-center gap-1 rounded-2xl bg-white px-4 text-lg font-bold shadow-sm active:bg-slate-100">
          <ArrowLeft className="size-6" aria-hidden /> {si.actions.back}
        </button>
      </header>

      <div className={cx('si rounded-3xl p-5 text-white shadow-lg', tone[view.state])}>
        <h1 className="text-4xl font-extrabold">{room.name_si}</h1>
        <p className="mt-1 text-2xl font-bold">{si.status[view.state]}</p>
        {room.category === 'ac' && <p className="text-lg">AC</p>}
      </div>

      <ErrorNote>{error}</ErrorNote>

      {view.state === 'cleaning' && (
        <BigButton size="xl" tone="green" icon={<Sparkles className="size-8" aria-hidden />} busy={busy} disabled={!canWrite} onClick={() => void setHousekeeping('ready')}>
          {si.actions.markReady}
        </BigButton>
      )}
      {view.state === 'occupied' && view.booking && (
        <BigButton size="xl" tone="red" onClick={() => navigate(`/caretaker/booking/${view.booking!.id}`)}>
          {view.booking.guest_name ?? formatLkPhone(view.booking.guest_phone)} – {timeSi(new Date(view.booking.check_out_time))} {si.home.until}
        </BigButton>
      )}
      {(view.state === 'available' || view.state === 'booked_today') && (
        <>
          <BigButton size="xl" tone="primary" icon={<DoorOpen className="size-8" aria-hidden />} disabled={!canWrite} onClick={() => navigate(`/caretaker/new/walk-in?room=${id}`)}>
            {si.actions.walkIn}
          </BigButton>
          <BigButton tone="neutral" icon={<CalendarPlus className="size-7 text-teal-700" aria-hidden />} disabled={!canWrite} onClick={() => navigate(`/caretaker/new/future?room=${id}`)}>
            {si.actions.future}
          </BigButton>
          <BigButton tone="ghost" className="border-2 border-blue-300 text-blue-800" icon={<Brush className="size-6" aria-hidden />} busy={busy} disabled={!canWrite} onClick={() => void setHousekeeping('cleaning')}>
            {si.actions.markCleaning}
          </BigButton>
        </>
      )}

      {upcoming.length > 0 && (
        <section className="rounded-3xl bg-white p-4 shadow-sm">
          <h2 className="si mb-2 text-xl font-bold">වෙන්කිරීම්</h2>
          <ul className="space-y-2">
            {upcoming.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => navigate(`/caretaker/booking/${b.id}`)}
                  className="si flex w-full items-center justify-between rounded-2xl bg-slate-50 p-3 text-left text-lg active:bg-slate-100">
                  <span>
                    <span className="block font-bold">{dateTimeSi(new Date(b.check_in_time), now)} → {timeSi(new Date(b.check_out_time))}</span>
                    <span className="block text-slate-600">{si.bookingType[b.booking_type]} · {b.guest_name ?? formatLkPhone(b.guest_phone)} · {si.bookingStatus[b.status]}</span>
                  </span>
                  <ChevronRight className="size-7 shrink-0 text-slate-400" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
