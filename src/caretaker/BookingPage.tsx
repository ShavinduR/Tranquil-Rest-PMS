import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LogIn, LogOut, Utensils, Banknote, XCircle, PhoneCall, Clock4, ArrowLeftRight, NotebookPen } from 'lucide-react';
import { useAppData } from '../data/AppData';
import { repo } from '../data';
import { BookingInPastError, DbUpgradeNeededError, NetworkError, SlotTakenError, type StatusChange } from '../data/repo';
import type { Booking, PaymentMethod, Room, SlotIssue } from '../types';
import { balanceDue, bookingTotal, paidTotal } from '../lib/booking';
import { hasOverlap } from '../lib/conflicts';
import { addMinutes } from '../lib/time';
import { rupeesSi } from '../lib/money';
import { formatPhone as formatLkPhone } from '../lib/phone';
import { dateTimeSi, si, timeSi } from '../i18n/si';
import { BigButton, Choice, Dialog, ErrorNote, Spinner, cx } from '../components/ui';
import { AddonPicker, AmountInput, MethodPicker, SummaryRow, type CartLine } from './parts';
import { WhatsAppButton } from './BookingSaved';

const statusTone: Record<Booking['status'], string> = {
  booked: 'bg-orange-500',
  checked_in: 'bg-red-600',
  checked_out: 'bg-slate-500',
  cancelled: 'bg-slate-800',
};

export const BookingPage = () => {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { reference, bookings, canWrite, refresh } = useAppData();
  const [fetched, setFetched] = useState<Booking | null>(null);
  const [dialog, setDialog] = useState<'none' | 'food' | 'pay' | 'cancel' | 'checkout' | 'extend' | 'move' | 'notes'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cached = bookings.find((b) => b.id === id) ?? null;
  const booking = fetched && (!cached || fetched.updated_at >= cached.updated_at) ? fetched : cached;

  useEffect(() => {
    void repo.getBooking(id).then(setFetched).catch(() => undefined);
  }, [id, bookings]);

  if (!reference) return <Spinner />;
  if (!booking) return <Spinner />;
  const room = reference.rooms.find((r) => r.id === booking.room_id);
  if (!room) return <Spinner />;

  const balance = balanceDue(booking);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      setFetched(await repo.getBooking(id));
      setDialog('none');
    } catch (e) {
      setError(
        e instanceof NetworkError ? si.networkError
          : e instanceof SlotTakenError ? si.conflictError
          : e instanceof BookingInPastError ? si.pastError
          : e instanceof DbUpgradeNeededError ? si.dbUpdate
          : si.error,
      );
    } finally {
      setBusy(false);
    }
  };
  const setStatus = (change: StatusChange) => run(() => repo.setStatus(id, change));

  return (
    <div className="space-y-3 p-3 pb-12">
      <header className="flex items-center gap-2">
        <button type="button" onClick={() => navigate(-1)} className="si flex min-h-14 items-center gap-1 rounded-2xl bg-white px-4 text-lg font-bold shadow-sm active:bg-slate-100">
          <ArrowLeft className="size-6" aria-hidden /> {si.actions.back}
        </button>
        <h1 className="si text-3xl font-extrabold">{room.name_si}</h1>
        <span className={cx('si ml-auto rounded-xl px-3 py-1 text-lg font-bold text-white', statusTone[booking.status])}>
          {si.bookingStatus[booking.status]}
        </span>
      </header>

      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <SummaryRow label={si.form.type} value={si.bookingType[booking.booking_type]} />
        <SummaryRow label={si.form.from} value={dateTimeSi(new Date(booking.check_in_time))} />
        <SummaryRow label={si.form.to} value={dateTimeSi(new Date(booking.check_out_time))} />
        {booking.guest_name && <SummaryRow label="නම" value={booking.guest_name} strong />}
        {booking.notes && <p className="si mt-2 rounded-2xl bg-amber-50 p-3 text-lg"><b>{si.noteLabel}:</b> {booking.notes}</p>}
        <a href={`tel:${booking.guest_phone}`} className="si mt-2 flex min-h-14 items-center justify-between rounded-2xl bg-slate-100 px-4 text-xl font-bold active:bg-slate-200">
          <span className="tabular">{formatLkPhone(booking.guest_phone)}</span>
          <span className="flex items-center gap-2 text-teal-800"><PhoneCall className="size-6" aria-hidden /> {si.actions.call}</span>
        </a>
      </div>

      <div className="rounded-3xl bg-white p-4 shadow-sm">
        <SummaryRow label={si.form.price} value={rupeesSi(booking.room_charge)} />
        {booking.addons.map((a) => (
          <SummaryRow key={a.id} label={`${a.label} × ${a.quantity}`} value={rupeesSi(a.amount)} />
        ))}
        <SummaryRow label={si.form.total} value={rupeesSi(bookingTotal(booking))} strong />
        <hr className="my-2" />
        {booking.payments.map((p) => (
          <SummaryRow key={p.id} label={`${p.kind === 'advance' ? si.form.advance : 'ගෙවීම'} · ${si.method[p.method]} · ${timeSi(new Date(p.paid_at))}`} value={rupeesSi(p.amount)} tone="green" />
        ))}
        {booking.refunds.map((r) => (
          <SummaryRow key={r.id} label={`${si.refunded} · ${si.method[r.method]} · ${timeSi(new Date(r.refunded_at))}`} value={`− ${rupeesSi(r.amount)}`} tone="red" />
        ))}
        <SummaryRow label={si.form.balance} value={rupeesSi(balance)} strong tone={balance > 0 ? 'red' : 'green'} />
      </div>

      <ErrorNote>{error}</ErrorNote>

      <div className="space-y-3">
        {booking.status === 'booked' && (
          <BigButton size="xl" tone="green" icon={<LogIn className="size-8" aria-hidden />} busy={busy} disabled={!canWrite}
            onClick={() => void setStatus({ status: 'checked_in' })}>
            {si.actions.checkIn}
          </BigButton>
        )}
        {booking.status === 'checked_in' && (
          <BigButton size="xl" tone="red" icon={<LogOut className="size-8" aria-hidden />} disabled={!canWrite} onClick={() => setDialog('checkout')}>
            {si.actions.checkOut}
          </BigButton>
        )}
        {booking.status !== 'cancelled' && (
          <>
            {booking.status !== 'checked_out' && (
              <BigButton tone="neutral" icon={<Utensils className="size-7 text-orange-600" aria-hidden />} disabled={!canWrite} onClick={() => setDialog('food')}>
                {si.actions.addFood}
              </BigButton>
            )}
            {balance > 0 && (
              <BigButton tone="neutral" icon={<Banknote className="size-7 text-green-700" aria-hidden />} disabled={!canWrite} onClick={() => setDialog('pay')}>
                {si.actions.addPayment}
              </BigButton>
            )}
            <WhatsAppButton booking={booking} room={room} settings={reference.settings} />
          </>
        )}
        {(booking.status === 'booked' || booking.status === 'checked_in') && (
          <div className="grid grid-cols-1 gap-3 pt-2">
            <BigButton tone="neutral" size="md" icon={<Clock4 className="size-6 text-teal-700" aria-hidden />} disabled={!canWrite} onClick={() => setDialog('extend')}>
              {si.actions.extend}
            </BigButton>
            <BigButton tone="neutral" size="md" icon={<ArrowLeftRight className="size-6 text-teal-700" aria-hidden />} disabled={!canWrite} onClick={() => setDialog('move')}>
              {si.actions.move}
            </BigButton>
          </div>
        )}
        {booking.status !== 'cancelled' && (
          <BigButton tone="neutral" size="md" icon={<NotebookPen className="size-6 text-amber-700" aria-hidden />} disabled={!canWrite} onClick={() => setDialog('notes')}>
            {si.actions.notes}
          </BigButton>
        )}
        {booking.status === 'booked' && (
          <BigButton tone="ghost" className="mt-6 border-2 border-red-300 text-red-700" icon={<XCircle className="size-7" aria-hidden />} disabled={!canWrite} onClick={() => setDialog('cancel')}>
            {si.actions.cancel}
          </BigButton>
        )}
        {booking.status === 'cancelled' && booking.cancel_reason && (
          <p className="si rounded-2xl bg-slate-200 p-3 text-lg">{si.cancelDialog.reason}: {booking.cancel_reason}</p>
        )}
      </div>

      <FoodDialog open={dialog === 'food'} presets={reference.presets} busy={busy} onClose={() => setDialog('none')}
        onSave={(lines) => run(() => repo.addAddons(id, lines.map(({ label, unit_price, quantity }) => ({ label, unit_price, quantity }))))} />
      <PayDialog open={dialog === 'pay'} due={balance} busy={busy} onClose={() => setDialog('none')}
        onSave={(amount, method) => run(() => repo.addPayment(id, { kind: 'balance', method, amount }))} />
      <CancelDialog open={dialog === 'cancel'} busy={busy} paid={paidTotal(booking)} onClose={() => setDialog('none')}
        onConfirm={(reason, refund) => setStatus({ status: 'cancelled', reason, refund })} />
      <ExtendDialog open={dialog === 'extend'} booking={booking} busy={busy} onClose={() => setDialog('none')}
        onSave={(end, extra) => run(() => repo.extendBooking(id, end, extra))} />
      <MoveDialog open={dialog === 'move'} booking={booking} rooms={reference.rooms} busy={busy} onClose={() => setDialog('none')}
        onSave={(roomId) => run(() => repo.moveBooking(id, roomId))} />
      <NotesDialog open={dialog === 'notes'} initial={booking.notes ?? ''} busy={busy} onClose={() => setDialog('none')}
        onSave={(text) => run(() => repo.setNotes(id, text))} />
      <CheckoutDialog open={dialog === 'checkout'} due={balance} busy={busy} onClose={() => setDialog('none')}
        onConfirm={(pay) =>
          run(async () => {
            if (pay) await repo.addPayment(id, { kind: 'balance', method: pay.method, amount: pay.amount });
            await repo.setStatus(id, { status: 'checked_out' });
          })
        } />
    </div>
  );
};

const FoodDialog = ({ open, presets, busy, onClose, onSave }: {
  open: boolean; presets: Parameters<typeof AddonPicker>[0]['presets']; busy: boolean; onClose: () => void; onSave: (l: CartLine[]) => void;
}) => {
  const [lines, setLines] = useState<CartLine[]>([]);
  useEffect(() => { if (open) setLines([]); }, [open]);
  const total = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  return (
    <Dialog open={open} onClose={onClose} labelledBy="food-title">
      <h2 id="food-title" className="si mb-3 text-2xl font-bold">{si.actions.addFood}</h2>
      <AddonPicker presets={presets} lines={lines} onChange={setLines} />
      <div className="mt-4 space-y-3">
        <BigButton tone="green" busy={busy} disabled={lines.length === 0} onClick={() => onSave(lines)}>
          {si.actions.save} {total > 0 ? `(${rupeesSi(total)})` : ''}
        </BigButton>
        <BigButton tone="neutral" onClick={onClose}>{si.actions.back}</BigButton>
      </div>
    </Dialog>
  );
};

const PayDialog = ({ open, due, busy, onClose, onSave }: {
  open: boolean; due: number; busy: boolean; onClose: () => void; onSave: (amount: number, method: PaymentMethod) => void;
}) => {
  const [amount, setAmount] = useState(due);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  useEffect(() => { if (open) { setAmount(due); setMethod('cash'); } }, [open, due]);
  return (
    <Dialog open={open} onClose={onClose} labelledBy="pay-title">
      <h2 id="pay-title" className="si mb-1 text-2xl font-bold">{si.actions.addPayment}</h2>
      <p className="si mb-3 text-lg">{si.form.balance}: <b className="tabular text-red-700">{rupeesSi(due)}</b></p>
      <AmountInput label={si.form.amount} value={amount} onChange={(v) => setAmount(Math.min(v, due))} />
      <div className="mt-3"><MethodPicker value={method} onChange={setMethod} /></div>
      <div className="mt-4 space-y-3">
        <BigButton tone="green" busy={busy} disabled={amount <= 0} onClick={() => onSave(amount, method)}>
          {si.actions.save} ({rupeesSi(amount)})
        </BigButton>
        <BigButton tone="neutral" onClick={onClose}>{si.actions.back}</BigButton>
      </div>
    </Dialog>
  );
};

/** Deliberately large and two-step: cancelling is the one destructive caretaker action. */
const CancelDialog = ({ open, busy, paid, onClose, onConfirm }: {
  open: boolean; busy: boolean; paid: number; onClose: () => void;
  onConfirm: (reason: string | null, refund: { amount: number; method: PaymentMethod } | null) => void;
}) => {
  const [reason, setReason] = useState('');
  const [refundMode, setRefundMode] = useState<'keep' | 'refund'>('keep');
  const [amount, setAmount] = useState(paid);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  useEffect(() => {
    if (open) { setReason(''); setRefundMode('keep'); setAmount(paid); setMethod('cash'); }
  }, [open, paid]);
  return (
    <Dialog open={open} onClose={onClose} labelledBy="cancel-title">
      <XCircle className="mx-auto size-20 text-red-600" aria-hidden />
      <h2 id="cancel-title" className="si mt-2 text-center text-3xl font-extrabold text-red-700">{si.cancelDialog.title}</h2>
      <p className="si mt-2 text-center text-lg">{si.cancelDialog.body}</p>
      {paid > 0 && (
        <div className="si mt-4 rounded-2xl bg-slate-50 p-3">
          <SummaryRow label={si.cancelDialog.paid} value={rupeesSi(paid)} strong />
          <div className="mt-2 grid grid-cols-1 gap-2">
            <Choice selected={refundMode === 'keep'} onClick={() => setRefundMode('keep')} className="text-lg">{si.cancelDialog.keep}</Choice>
            <Choice selected={refundMode === 'refund'} tone="orange" onClick={() => setRefundMode('refund')} className="text-lg">{si.cancelDialog.refund}</Choice>
          </div>
          {refundMode === 'refund' && (
            <div className="mt-3 space-y-3">
              <AmountInput label={si.cancelDialog.refundAmount} value={amount} onChange={(v) => setAmount(Math.min(v, paid))} />
              <p className="text-lg font-semibold">{si.cancelDialog.refundMethod}</p>
              <MethodPicker value={method} onChange={setMethod} />
            </div>
          )}
        </div>
      )}
      <label className="si mt-4 block">
        <span className="mb-1 block text-lg font-semibold">{si.cancelDialog.reason}</span>
        <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 120))}
          className="si min-h-14 w-full rounded-2xl border-[3px] border-slate-300 px-3 text-lg outline-none focus:border-red-600" />
      </label>
      <div className="mt-5 space-y-3">
        <BigButton tone="neutral" size="xl" onClick={onClose}>{si.actions.keep}</BigButton>
        <BigButton tone="red" busy={busy} disabled={refundMode === 'refund' && amount <= 0}
          onClick={() => onConfirm(reason.trim() || null, refundMode === 'refund' && amount > 0 ? { amount, method } : null)}>
          {si.actions.confirmCancel}
        </BigButton>
      </div>
    </Dialog>
  );
};

/** Later check-out. Overlaps are checked live and enforced by the database. */
const ExtendDialog = ({ open, booking, busy, onClose, onSave }: {
  open: boolean; booking: Booking; busy: boolean; onClose: () => void; onSave: (end: Date, extra: number) => void;
}) => {
  const [hours, setHours] = useState(1);
  const [extra, setExtra] = useState(0);
  const [issues, setIssues] = useState<SlotIssue[]>([]);
  const currentEnd = new Date(booking.check_out_time);
  const newEnd = addMinutes(currentEnd, hours * 60);
  useEffect(() => { if (open) { setHours(1); setExtra(0); } }, [open]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    repo.checkSlot(booking.room_id, currentEnd, newEnd, booking.id)
      .then((r) => !cancelled && setIssues(r.filter((i) => i.kind === 'overlap')))
      .catch(() => !cancelled && setIssues([]));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hours, booking.id]);
  const blocked = hasOverlap(issues);
  return (
    <Dialog open={open} onClose={onClose} labelledBy="extend-title">
      <h2 id="extend-title" className="si mb-3 text-2xl font-bold">{si.extendDialog.title}</h2>
      <SummaryRow label={si.extendDialog.now} value={dateTimeSi(currentEnd)} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[1, 2, 3, 24].map((h) => (
          <Choice key={h} selected={hours === h} onClick={() => setHours(h)} className="text-center text-lg">{si.extendDialog.hours(h)}</Choice>
        ))}
      </div>
      <div className={cx('si mt-3 rounded-2xl p-3 text-xl font-bold', blocked ? 'bg-red-50 text-red-800' : 'bg-teal-50 text-teal-900')}>
        {si.extendDialog.newEnd}: {dateTimeSi(newEnd)}
        {blocked && <span className="mt-1 block text-lg">{si.conflictError}</span>}
      </div>
      <div className="mt-3">
        <AmountInput label={si.extendDialog.extra} value={extra} onChange={setExtra} />
        <p className="si mt-1 text-base text-slate-500">{si.extendDialog.extraHint}</p>
      </div>
      <div className="mt-4 space-y-3">
        <BigButton tone="green" busy={busy} disabled={blocked} onClick={() => onSave(newEnd, extra)}>{si.actions.save}</BigButton>
        <BigButton tone="neutral" onClick={onClose}>{si.actions.back}</BigButton>
      </div>
    </Dialog>
  );
};

/** Same times, different room; rooms that are taken for those times are disabled. */
const MoveDialog = ({ open, booking, rooms, busy, onClose, onSave }: {
  open: boolean; booking: Booking; rooms: Room[]; busy: boolean; onClose: () => void; onSave: (roomId: string) => void;
}) => {
  const [target, setTarget] = useState<string | null>(null);
  const [taken, setTaken] = useState<Record<string, boolean>>({});
  const others = rooms.filter((r) => r.active && r.id !== booking.room_id);
  useEffect(() => {
    if (!open) return;
    setTarget(null);
    let cancelled = false;
    Promise.all(others.map(async (r) => [r.id, hasOverlap(await repo.checkSlot(r.id, new Date(booking.check_in_time), new Date(booking.check_out_time), booking.id))] as const))
      .then((entries) => !cancelled && setTaken(Object.fromEntries(entries)))
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking.id]);
  const current = rooms.find((r) => r.id === booking.room_id);
  return (
    <Dialog open={open} onClose={onClose} labelledBy="move-title">
      <h2 id="move-title" className="si mb-1 text-2xl font-bold">{si.moveDialog.title}</h2>
      <p className="si mb-3 text-lg text-slate-600">{si.moveDialog.current}: {current?.name_si}</p>
      <div className="grid grid-cols-2 gap-2">
        {others.map((r) => (
          <Choice key={r.id} selected={target === r.id} disabled={taken[r.id]} onClick={() => setTarget(r.id)}
            className={cx('text-center', taken[r.id] && 'bg-slate-200 line-through')}>
            <span className="block text-2xl font-extrabold">{r.name_si}</span>
            {taken[r.id] && <span className="block text-base font-bold text-red-700">{si.form.taken}</span>}
          </Choice>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <BigButton tone="green" busy={busy} disabled={!target} onClick={() => target && onSave(target)}>{si.actions.save}</BigButton>
        <BigButton tone="neutral" onClick={onClose}>{si.actions.back}</BigButton>
      </div>
    </Dialog>
  );
};

const NotesDialog = ({ open, initial, busy, onClose, onSave }: {
  open: boolean; initial: string; busy: boolean; onClose: () => void; onSave: (text: string) => void;
}) => {
  const [text, setText] = useState(initial);
  useEffect(() => { if (open) setText(initial); }, [open, initial]);
  return (
    <Dialog open={open} onClose={onClose} labelledBy="notes-title">
      <h2 id="notes-title" className="si mb-3 text-2xl font-bold">{si.notesDialog.title}</h2>
      <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} rows={4} placeholder={si.notesDialog.placeholder}
        className="si w-full rounded-2xl border-[3px] border-slate-300 p-3 text-lg outline-none focus:border-teal-700" />
      <div className="mt-4 space-y-3">
        <BigButton tone="green" busy={busy} onClick={() => onSave(text)}>{si.actions.save}</BigButton>
        <BigButton tone="neutral" onClick={onClose}>{si.actions.back}</BigButton>
      </div>
    </Dialog>
  );
};

const CheckoutDialog = ({ open, due, busy, onClose, onConfirm }: {
  open: boolean; due: number; busy: boolean; onClose: () => void; onConfirm: (pay: { amount: number; method: PaymentMethod } | null) => void;
}) => {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  return (
    <Dialog open={open} onClose={onClose} labelledBy="checkout-title">
      <h2 id="checkout-title" className="si mb-3 text-2xl font-bold">{si.checkoutDialog.title}</h2>
      {due > 0 ? (
        <>
          <div className="si mb-3 rounded-2xl border-4 border-red-500 bg-red-50 p-4 text-center">
            <p className="text-lg">{si.checkoutDialog.balanceDue}</p>
            <p className="tabular text-4xl font-extrabold text-red-700">{rupeesSi(due)}</p>
          </div>
          <MethodPicker value={method} onChange={setMethod} />
          <div className="mt-4 space-y-3">
            <BigButton tone="green" size="xl" busy={busy} onClick={() => onConfirm({ amount: due, method })}>
              {si.checkoutDialog.collect}
            </BigButton>
            <BigButton tone="neutral" disabled={busy} onClick={() => onConfirm(null)}>{si.checkoutDialog.skip}</BigButton>
            <BigButton tone="ghost" onClick={onClose}>{si.actions.back}</BigButton>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <p className="si rounded-2xl bg-green-50 p-3 text-center text-xl font-bold text-green-800">✓ {si.form.balance}: {rupeesSi(0)}</p>
          <BigButton tone="red" size="xl" busy={busy} onClick={() => onConfirm(null)}>{si.actions.checkOut}</BigButton>
          <BigButton tone="neutral" onClick={onClose}>{si.actions.back}</BigButton>
        </div>
      )}
    </Dialog>
  );
};

