import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, CalendarPlus, CalendarSearch, DoorOpen, Wallet, AlertTriangle, Snowflake } from 'lucide-react';
import { useAppData } from '../data/AppData';
import { useNow } from '../hooks/useNow';
import { roomView, type RoomState, type RoomView } from '../lib/roomStatus';
import { addDaysKey, dateKey, startOfDay } from '../lib/time';
import { cashInHand } from '../lib/booking';
import { rupeesSi } from '../lib/money';
import { countSi, daySi, si, timeSi } from '../i18n/si';
import type { Booking, Room } from '../types';
import { BigButton, Spinner, cx } from '../components/ui';
import { formatLkPhone } from '../lib/phone';

const cardTone: Record<RoomState, string> = {
  available: 'bg-green-600 border-green-800',
  occupied: 'bg-red-600 border-red-800',
  booked_today: 'bg-orange-500 border-orange-700',
  cleaning: 'bg-blue-600 border-blue-800',
};

const guestLabel = (b: Booking) => b.guest_name ?? formatLkPhone(b.guest_phone);

export const CaretakerHome = () => {
  const { reference, bookings, todayPayments, todayRefunds, ready, canWrite } = useAppData();
  const navigate = useNavigate();
  const now = useNow();

  const views = useMemo(
    () => (reference?.rooms ?? []).filter((r) => r.active).map((r) => roomView(r, bookings, now)),
    [reference, bookings, now],
  );

  if (!ready || !reference) return <Spinner />;

  const today = dateKey(now);
  const cash = cashInHand(todayPayments, startOfDay(today), startOfDay(addDaysKey(today, 1)), todayRefunds);

  return (
    <div className="space-y-4 p-3 pb-10">
      <AlertBanner bookings={bookings} rooms={reference.rooms} now={now} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BigButton size="xl" tone="primary" icon={<DoorOpen className="size-9" aria-hidden />} disabled={!canWrite} onClick={() => navigate('/caretaker/new/walk-in')}>
          {si.actions.walkIn}
        </BigButton>
        <BigButton size="xl" tone="neutral" icon={<CalendarPlus className="size-9 text-teal-700" aria-hidden />} disabled={!canWrite} onClick={() => navigate('/caretaker/new/future')}>
          {si.actions.future}
        </BigButton>
      </div>

      {/* Read-only, so it stays available offline. */}
      <BigButton size="lg" tone="blue" icon={<CalendarSearch className="size-8" aria-hidden />} onClick={() => navigate('/caretaker/availability')}>
        {si.home.availability}
      </BigButton>

      <div className="grid grid-cols-2 gap-3">
        {views.map((v) => (
          <RoomCard key={v.room.id} view={v} now={now} onOpen={() => navigate(`/caretaker/room/${v.room.id}`)} />
        ))}
      </div>

      <section className="si rounded-3xl border-4 border-green-700 bg-green-50 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Wallet className="size-10 shrink-0 text-green-800" aria-hidden />
          <div>
            <h2 className="text-xl font-bold text-green-900">{si.home.cashTitle}</h2>
            <p className="tabular text-4xl font-extrabold text-green-800">{rupeesSi(cash)}</p>
            <p className="text-base text-green-900/80">{si.home.cashHint}</p>
          </div>
        </div>
      </section>
    </div>
  );
};

const RoomCard = ({ view, now, onOpen }: { view: RoomView; now: Date; onOpen: () => void }) => {
  const { room, state, booking, next, overdueCheckout } = view;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        'si relative flex min-h-40 flex-col items-start justify-between rounded-3xl border-b-[6px] p-4 text-left text-white shadow-lg transition-transform active:scale-[0.97]',
        cardTone[state],
      )}
    >
      <div className="flex w-full items-start justify-between">
        <span className="text-3xl font-extrabold">{room.name_si}</span>
        {room.category === 'ac' && (
          <span className="flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5 text-sm font-bold">
            <Snowflake className="size-4" aria-hidden /> ඒසී
          </span>
        )}
      </div>
      <span className="mt-1 rounded-xl bg-white/25 px-3 py-1 text-xl font-bold">{si.status[state]}</span>
      <div className="mt-2 min-h-12 text-base leading-snug font-semibold">
        {state === 'occupied' && booking && (
          <>
            <div className="truncate">{guestLabel(booking)}</div>
            {overdueCheckout ? (
              <div className="mt-1 flex items-center gap-1 rounded-lg bg-yellow-300 px-2 py-0.5 text-red-900 animate-pulse">
                <AlertTriangle className="size-4 shrink-0" aria-hidden /> {si.home.overdue}
              </div>
            ) : (
              <div>{timeSi(new Date(booking.check_out_time))} {si.home.until}</div>
            )}
          </>
        )}
        {(state === 'booked_today' || (state === 'cleaning' && booking)) && booking && (
          <>
            <div>{timeSi(new Date(booking.check_in_time))}</div>
            <div className="truncate">{guestLabel(booking)}</div>
          </>
        )}
        {state === 'available' && next && (
          <div className="opacity-95">
            {si.home.next}: {daySi(new Date(next.check_in_time), now)} {timeSi(new Date(next.check_in_time))}
          </div>
        )}
      </div>
    </button>
  );
};

/** Today's and tomorrow's arrivals plus anything needing attention right now. */
const AlertBanner = ({ bookings, rooms, now }: { bookings: Booking[]; rooms: Room[]; now: Date }) => {
  const navigate = useNavigate();
  const today = dateKey(now);
  const tomorrow = addDaysKey(today, 1);
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name_si ?? '';

  const arrivals = bookings.filter((b) => b.status === 'booked');
  const todays = arrivals.filter((b) => dateKey(new Date(b.check_in_time)) <= today && new Date(b.check_out_time) > now);
  const tomorrows = arrivals.filter((b) => dateKey(new Date(b.check_in_time)) === tomorrow);
  const overdue = bookings.filter((b) => b.status === 'checked_in' && new Date(b.check_out_time) < now);

  const line = (b: Booking) => `${roomName(b.room_id)} (${guestLabel(b)} - ${timeSi(new Date(b.check_in_time))})`;

  if (todays.length + tomorrows.length + overdue.length === 0) {
    return (
      <div className="si rounded-3xl bg-white p-4 text-lg font-semibold text-slate-600 shadow-sm">
        <BellRing className="mr-2 inline size-6 text-slate-400" aria-hidden />
        {si.home.noUpcoming}
      </div>
    );
  }

  return (
    <div className="space-y-2" role="status">
      {overdue.map((b) => (
        <button key={b.id} type="button" onClick={() => navigate(`/caretaker/booking/${b.id}`)}
          className="si flex w-full items-center gap-3 rounded-3xl border-4 border-red-600 bg-red-50 p-3 text-left text-lg font-bold text-red-900">
          <AlertTriangle className="size-8 shrink-0" aria-hidden />
          <span>{roomName(b.room_id)} – {si.home.overdue} ({timeSi(new Date(b.check_out_time))})</span>
        </button>
      ))}
      {todays.length > 0 && (
        <div className="si rounded-3xl border-4 border-orange-500 bg-orange-50 p-3 text-orange-950">
          <p className="flex items-center gap-2 text-xl font-extrabold">
            <BellRing className="size-7 shrink-0 animate-pulse" aria-hidden />
            අද {countSi(todays.length)} ඇත
          </p>
          <ul className="mt-1 space-y-1">
            {todays.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => navigate(`/caretaker/booking/${b.id}`)} className="w-full rounded-xl bg-white/70 px-3 py-2 text-left text-lg font-semibold active:bg-white">
                  {line(b)}
                  {new Date(b.check_in_time) < now && <span className="ml-2 rounded-lg bg-red-600 px-2 text-sm text-white">{si.home.notArrived}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tomorrows.length > 0 && (
        <div className="si rounded-3xl border-4 border-amber-300 bg-amber-50 p-3 text-amber-950">
          <p className="text-xl font-extrabold">හෙට {countSi(tomorrows.length)} ඇත</p>
          <ul className="mt-1 space-y-1">
            {tomorrows.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => navigate(`/caretaker/booking/${b.id}`)} className="w-full rounded-xl bg-white/70 px-3 py-2 text-left text-lg font-semibold active:bg-white">
                  {line(b)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
