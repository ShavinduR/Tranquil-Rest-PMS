import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarCheck, ChevronRight, Snowflake, Sparkles } from 'lucide-react';
import { useAppData } from '../data/AppData';
import { repo } from '../data';
import type { Booking } from '../types';
import { roomDaySchedule, type ScheduleSegment } from '../lib/availability';
import { addDaysKey, clock24, dateKey, fromLocalInput, startOfDay } from '../lib/time';
import { formatPhone } from '../lib/phone';
import { useNow } from '../hooks/useNow';
import { fullDateSi, si } from '../i18n/si';
import { Choice, Spinner, cx } from '../components/ui';

/**
 * "Check availability by date" for caretakers: every room's bookings and free
 * windows on one Sri Lanka calendar day. Tapping a free window starts a future
 * booking for that room, date and time. Read-only, so it also works offline
 * for the cached days.
 */
export const Availability = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const now = useNow(60_000);
  const today = dateKey(now);
  const date = search.get('date') && search.get('date')! >= today ? search.get('date')! : today;
  const setDate = (d: string) => setSearch({ date: d }, { replace: true });

  const { reference, bookings: cached, online, canWrite } = useAppData();
  const [fetched, setFetched] = useState<{ date: string; bookings: Booking[] } | null>(null);
  const [failed, setFailed] = useState(false);

  // The app keeps yesterday … +7 days cached; other dates are fetched (online only).
  const inCache = date >= addDaysKey(today, -1) && date < addDaysKey(today, 8);
  useEffect(() => {
    setFailed(false);
    if (!online) return;
    let cancelled = false;
    repo.listBookings(startOfDay(date), startOfDay(addDaysKey(date, 1)))
      .then((list) => !cancelled && setFetched({ date, bookings: list }))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [date, online]);

  const bookings = fetched?.date === date ? fetched.bookings : inCache ? cached : null;

  const days = useMemo(() => {
    if (!reference || !bookings) return [];
    return reference.rooms
      .filter((r) => r.active)
      .map((r) => roomDaySchedule(r, bookings, date, now, reference.settings.cleaning_buffer_minutes));
  }, [reference, bookings, date, now]);

  if (!reference) return <Spinner />;

  const chips: [string, string][] = [
    [today, si.form.today],
    [addDaysKey(today, 1), si.form.tomorrow],
    [addDaysKey(today, 2), si.form.dayAfter],
  ];

  return (
    <div className="space-y-3 p-3 pb-12">
      <header className="flex items-center gap-2">
        <button type="button" onClick={() => navigate('/caretaker')} className="si flex min-h-14 items-center gap-1 rounded-2xl bg-white px-4 text-lg font-bold shadow-sm active:bg-slate-100">
          <ArrowLeft className="size-6" aria-hidden /> {si.actions.back}
        </button>
        <h1 className="si text-2xl font-extrabold text-slate-900">{si.availability.title}</h1>
      </header>

      <section className="rounded-3xl bg-white p-4 shadow-sm">
        <h2 className="si mb-3 text-xl font-bold text-slate-800">{si.availability.chooseDate}</h2>
        <div className="grid grid-cols-3 gap-2">
          {chips.map(([key, label]) => (
            <Choice key={key} selected={date === key} onClick={() => setDate(key)} className="text-center text-xl">
              {label}
            </Choice>
          ))}
        </div>
        <label className="si mt-3 block">
          <span className="mb-1 block text-lg font-semibold text-slate-700">{si.availability.otherDay}</span>
          <input
            type="date"
            min={today}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="min-h-16 w-full rounded-2xl border-[3px] border-slate-300 px-3 text-xl font-semibold outline-none focus:border-teal-700"
          />
        </label>
        <p className="si mt-2 flex items-center gap-2 text-lg font-bold text-teal-800">
          <CalendarCheck className="size-6" aria-hidden /> {fullDateSi(fromLocalInput(`${date}T12:00`))}
        </p>
      </section>

      {!bookings ? (
        !online || failed ? (
          <p role="alert" className="si rounded-3xl bg-red-50 p-4 text-lg font-semibold text-red-800">{si.availability.offlineNoData}</p>
        ) : (
          <Spinner label={si.availability.loading} />
        )
      ) : (
        days.map(({ room, segments, freeness, firstFree }) => (
          <section key={room.id} className="overflow-hidden rounded-3xl bg-white shadow-sm">
            <div className={cx('si flex items-center justify-between gap-2 px-4 py-3 text-white',
              freeness === 'all' ? 'bg-green-600' : freeness === 'some' ? 'bg-amber-500' : 'bg-red-600')}>
              <span className="flex items-center gap-2 text-2xl font-extrabold">
                {room.name_si}
                {room.category === 'ac' && (
                  <span className="flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5 text-sm font-bold">
                    <Snowflake className="size-4" aria-hidden /> ඒසී
                  </span>
                )}
              </span>
              <span className="rounded-xl bg-white/25 px-3 py-1 text-lg font-bold">
                {freeness === 'all'
                  ? (date === today ? si.availability.restFree : si.availability.allFree)
                  : freeness === 'some' ? si.availability.someFree : si.availability.noneFree}
              </span>
            </div>
            {date === today && room.housekeeping === 'cleaning' && (
              <p className="si flex items-center gap-2 bg-blue-50 px-4 py-2 text-base font-semibold text-blue-800">
                <Sparkles className="size-5" aria-hidden /> {si.availability.cleaningNow}
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {segments.map((seg) => (
                <li key={`${seg.kind}-${seg.start.toISOString()}`}>
                  <SegmentRow
                    seg={seg}
                    dayEnd={startOfDay(addDaysKey(date, 1))}
                    canBook={canWrite}
                    onBook={() => navigate(`/caretaker/new/future?room=${room.id}&date=${date}&start=${clock24(seg.start)}`)}
                    onOpen={(id) => navigate(`/caretaker/booking/${id}`)}
                  />
                </li>
              ))}
            </ul>
            {firstFree === null && segments.length === 0 && (
              <p className="si px-4 py-3 text-lg text-slate-600">{si.availability.noneFree}</p>
            )}
          </section>
        ))
      )}
    </div>
  );
};

const range = (seg: ScheduleSegment, dayEnd: Date): string =>
  `${clock24(seg.start)} – ${seg.end.getTime() === dayEnd.getTime() ? '24:00' : clock24(seg.end)}`;

const SegmentRow = ({ seg, dayEnd, canBook, onBook, onOpen }: {
  seg: ScheduleSegment; dayEnd: Date; canBook: boolean; onBook: () => void; onOpen: (bookingId: string) => void;
}) => {
  if (seg.kind === 'free') {
    return (
      <button type="button" disabled={!canBook} onClick={onBook}
        className="si flex min-h-16 w-full items-center justify-between gap-2 bg-green-50 px-4 py-3 text-left active:bg-green-100 disabled:opacity-60">
        <span>
          <span className="tabular block text-xl font-extrabold text-green-800">{range(seg, dayEnd)}</span>
          <span className="block text-lg font-bold text-green-700">{si.availability.free}</span>
        </span>
        {canBook && (
          <span className="flex items-center gap-1 rounded-xl bg-green-600 px-3 py-2 text-base font-bold text-white">
            {si.availability.tapToBook} <ChevronRight className="size-5" aria-hidden />
          </span>
        )}
      </button>
    );
  }
  const occupied = seg.kind === 'occupied';
  const b = seg.booking;
  return (
    <button type="button" onClick={() => onOpen(b.id)}
      className={cx('si flex min-h-16 w-full items-center justify-between gap-2 px-4 py-3 text-left',
        occupied ? 'bg-red-50 active:bg-red-100' : 'bg-orange-50 active:bg-orange-100')}>
      <span>
        <span className={cx('tabular block text-xl font-extrabold', occupied ? 'text-red-800' : 'text-orange-900')}>
          {clock24(seg.start)} – {clock24(seg.end)}{' '}
          <span className="text-lg">{occupied ? si.availability.occupied : si.availability.booked}</span>
        </span>
        <span className="block text-base text-slate-700">
          {b.guest_name ?? formatPhone(b.guest_phone)}
          {seg.fromPreviousDay && ` · ${si.availability.fromPrev}`}
          {seg.intoNextDay && ` · ${si.availability.intoNext}`}
        </span>
      </span>
      <ChevronRight className="size-6 shrink-0 text-slate-400" aria-hidden />
    </button>
  );
};
