import { useMemo, useState } from 'react';
import { Pencil, Trash2, X, RotateCcw, Search } from 'lucide-react';
import { repo } from '../data';
import { useAppData } from '../data/AppData';
import { SlotTakenError } from '../data/repo';
import { BOOKING_TYPES, type Booking, type BookingStatus } from '../types';
import { balanceDue, bookingTotal, paidTotal } from '../lib/booking';
import { lkr } from '../lib/money';
import { formatLkPhone, normalizeLkPhone } from '../lib/phone';
import { fromLocalInput, monthKey, toLocalInput } from '../lib/time';
import { Dialog, Spinner, cx } from '../components/ui';
import { Btn, Card, MonthPicker, PageHeader, STATUS_EN, TYPE_EN, fmtDateTime, inputCls, useMonthData } from './common';

const statusCls: Record<BookingStatus, string> = {
  booked: 'bg-orange-100 text-orange-800',
  checked_in: 'bg-red-100 text-red-800',
  checked_out: 'bg-slate-100 text-slate-700',
  cancelled: 'bg-slate-800 text-white',
};

export const AdminBookings = () => {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const { data, error, reload } = useMonthData(month);
  const { reference, refresh } = useAppData();
  const [status, setStatus] = useState<BookingStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Booking | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.stays ?? [])
      .filter((b) => status === 'all' || b.status === status)
      .filter((b) => !q || (b.guest_name ?? '').toLowerCase().includes(q) || b.guest_phone.includes(q.replace(/\D/g, '') || '§'))
      .sort((a, b) => b.check_in_time.localeCompare(a.check_in_time));
  }, [data, status, query]);

  const roomName = (id: string) => reference?.rooms.find((r) => r.id === id)?.name ?? '–';

  return (
    <div>
      <PageHeader title="Bookings">
        <MonthPicker value={month} onChange={setMonth} />
      </PageHeader>
      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute top-3 left-3 size-4 text-slate-400" />
            <input className={cx(inputCls, 'pl-9')} placeholder="Search name or phone" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select className={cx(inputCls, 'w-auto')} value={status} onChange={(e) => setStatus(e.target.value as BookingStatus | 'all')}>
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_EN) as BookingStatus[]).map((s) => <option key={s} value={s}>{STATUS_EN[s]}</option>)}
          </select>
        </div>
        {!data ? <Spinner /> : rows.length === 0 ? <p className="py-6 text-center text-slate-500">No bookings.</p> : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Check-in</th><th className="py-2 font-medium">Room</th><th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Guest</th><th className="py-2 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Total</th><th className="py-2 text-right font-medium">Paid</th><th className="py-2 text-right font-medium">Balance</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className={cx('border-t border-slate-100', b.status === 'cancelled' && 'text-slate-400')}>
                    <td className="px-4 py-2 whitespace-nowrap">{fmtDateTime(b.check_in_time)}<div className="text-xs text-slate-400">→ {fmtDateTime(b.check_out_time)}</div></td>
                    <td className="py-2">{roomName(b.room_id)}</td>
                    <td className="py-2">{TYPE_EN[b.booking_type]}</td>
                    <td className="py-2">{b.guest_name ?? '–'}<div className="text-xs text-slate-400">{formatLkPhone(b.guest_phone)}</div></td>
                    <td className="py-2"><span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', statusCls[b.status])}>{STATUS_EN[b.status]}</span></td>
                    <td className="tabular py-2 text-right">{lkr(bookingTotal(b))}</td>
                    <td className="tabular py-2 text-right">{lkr(paidTotal(b))}</td>
                    <td className={cx('tabular py-2 text-right', b.status !== 'cancelled' && balanceDue(b) > 0 && 'font-semibold text-amber-700')}>
                      {b.status === 'cancelled' ? '–' : lkr(balanceDue(b))}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" aria-label="Edit" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={() => setEditing(b)}><Pencil className="size-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && reference && (
        <EditBooking booking={editing} rooms={reference.rooms} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); void refresh(); }} />
      )}
    </div>
  );
};

const EditBooking = ({ booking, rooms, onClose, onSaved }: {
  booking: Booking; rooms: { id: string; name: string }[]; onClose: () => void; onSaved: () => Promise<void>;
}) => {
  const [f, setF] = useState({
    guest_name: booking.guest_name ?? '',
    guest_phone: booking.guest_phone,
    room_id: booking.room_id,
    booking_type: booking.booking_type,
    check_in: toLocalInput(new Date(booking.check_in_time)),
    check_out: toLocalInput(new Date(booking.check_out_time)),
    room_charge: String(booking.room_charge),
    notes: booking.notes ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await onSaved();
    } catch (e) {
      setErr(e instanceof SlotTakenError ? 'That room is already booked for this time.' : e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const save = () => act(async () => {
    const phone = normalizeLkPhone(f.guest_phone);
    if (!phone) throw new Error('Invalid phone number');
    const start = fromLocalInput(f.check_in);
    const end = fromLocalInput(f.check_out);
    if (end <= start) throw new Error('Check-out must be after check-in');
    await repo.updateBooking(booking.id, {
      guest_name: f.guest_name.trim() || null,
      guest_phone: `0${phone.slice(2)}`,
      room_id: f.room_id,
      booking_type: f.booking_type,
      check_in_time: start.toISOString(),
      check_out_time: end.toISOString(),
      room_charge: Number(f.room_charge) || 0,
      notes: f.notes.trim() || null,
    });
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <Dialog open onClose={onClose} labelledBy="edit-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="edit-title" className="text-xl font-bold">Edit booking</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-slate-100"><X className="size-5" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="col-span-2">Guest name<input className={inputCls} value={f.guest_name} onChange={set('guest_name')} /></label>
        <label>Phone<input className={inputCls} value={f.guest_phone} onChange={set('guest_phone')} /></label>
        <label>Room
          <select className={inputCls} value={f.room_id} onChange={set('room_id')}>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        </label>
        <label>Type
          <select className={inputCls} value={f.booking_type} onChange={set('booking_type')}>{BOOKING_TYPES.map((t) => <option key={t} value={t}>{TYPE_EN[t]}</option>)}</select>
        </label>
        <label>Room charge (LKR)<input className={inputCls} type="number" min="0" value={f.room_charge} onChange={set('room_charge')} /></label>
        <label>Check-in<input className={inputCls} type="datetime-local" value={f.check_in} onChange={set('check_in')} /></label>
        <label>Check-out<input className={inputCls} type="datetime-local" value={f.check_out} onChange={set('check_out')} /></label>
        <label className="col-span-2">Notes<input className={inputCls} value={f.notes} onChange={set('notes')} /></label>
      </div>

      <h3 className="mt-4 mb-1 text-sm font-semibold text-slate-700">Payments</h3>
      {booking.payments.length === 0 && <p className="text-sm text-slate-500">None</p>}
      {booking.payments.map((p) => (
        <div key={p.id} className="flex items-center justify-between border-t border-slate-100 py-1 text-sm">
          <span>{fmtDateTime(p.paid_at)} · {p.kind} · {p.method}</span>
          <span className="flex items-center gap-1"><b className="tabular">{lkr(p.amount)}</b>
            <button type="button" aria-label="Delete payment" className="rounded p-1 text-slate-400 hover:text-red-600"
              onClick={() => confirm('Delete this payment? (audited)') && void act(() => repo.deletePayment(p.id))}><Trash2 className="size-4" /></button>
          </span>
        </div>
      ))}
      <h3 className="mt-3 mb-1 text-sm font-semibold text-slate-700">Food & beverage</h3>
      {booking.addons.length === 0 && <p className="text-sm text-slate-500">None</p>}
      {booking.addons.map((a) => (
        <div key={a.id} className="flex items-center justify-between border-t border-slate-100 py-1 text-sm">
          <span>{a.label} × {a.quantity}</span>
          <span className="flex items-center gap-1"><b className="tabular">{lkr(a.amount)}</b>
            <button type="button" aria-label="Delete item" className="rounded p-1 text-slate-400 hover:text-red-600"
              onClick={() => confirm('Delete this item? (audited)') && void act(() => repo.deleteAddon(a.id))}><Trash2 className="size-4" /></button>
          </span>
        </div>
      ))}

      {err && <p className="mt-3 rounded-xl bg-red-50 p-2 text-sm text-red-800">{err}</p>}
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          {booking.status === 'cancelled' ? (
            <Btn onClick={() => void act(() => repo.setStatus(booking.id, { status: 'booked' }))} disabled={busy}><RotateCcw className="size-4" /> Restore</Btn>
          ) : booking.status === 'booked' && (
            <Btn tone="danger" disabled={busy} onClick={() => confirm('Cancel this booking?') && void act(() => repo.setStatus(booking.id, { status: 'cancelled', reason: 'Cancelled by admin' }))}>Cancel booking</Btn>
          )}
        </div>
        <div className="flex gap-2">
          <Btn onClick={onClose}>Close</Btn>
          <Btn tone="primary" onClick={() => void save()} disabled={busy}>Save changes</Btn>
        </div>
      </div>
    </Dialog>
  );
};
