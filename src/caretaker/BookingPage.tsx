import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LogIn, LogOut, Utensils, Banknote, XCircle, PhoneCall } from 'lucide-react';
import { useAppData } from '../data/AppData';
import { repo } from '../data';
import { NetworkError, type StatusChange } from '../data/repo';
import type { Booking, PaymentMethod } from '../types';
import { balanceDue, bookingTotal } from '../lib/booking';
import { rupeesSi } from '../lib/money';
import { formatLkPhone } from '../lib/phone';
import { dateTimeSi, si, timeSi } from '../i18n/si';
import { BigButton, Dialog, ErrorNote, Spinner, cx } from '../components/ui';
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
  const [dialog, setDialog] = useState<'none' | 'food' | 'pay' | 'cancel' | 'checkout'>('none');
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
      setError(e instanceof NetworkError ? si.networkError : si.error);
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
          <SummaryRow key={p.id} label={`${p.kind === 'advance' ? si.form.advance : 'ගෙවීම'} · ${p.method === 'cash' ? 'Cash' : 'Bank'} · ${timeSi(new Date(p.paid_at))}`} value={rupeesSi(p.amount)} tone="green" />
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
      <CancelDialog open={dialog === 'cancel'} busy={busy} onClose={() => setDialog('none')}
        onConfirm={(reason) => setStatus({ status: 'cancelled', reason })} />
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
const CancelDialog = ({ open, busy, onClose, onConfirm }: { open: boolean; busy: boolean; onClose: () => void; onConfirm: (reason: string | null) => void }) => {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} labelledBy="cancel-title">
      <XCircle className="mx-auto size-20 text-red-600" aria-hidden />
      <h2 id="cancel-title" className="si mt-2 text-center text-3xl font-extrabold text-red-700">{si.cancelDialog.title}</h2>
      <p className="si mt-2 text-center text-lg">{si.cancelDialog.body}</p>
      <label className="si mt-4 block">
        <span className="mb-1 block text-lg font-semibold">{si.cancelDialog.reason}</span>
        <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 120))}
          className="si min-h-14 w-full rounded-2xl border-[3px] border-slate-300 px-3 text-lg outline-none focus:border-red-600" />
      </label>
      <div className="mt-5 space-y-3">
        <BigButton tone="neutral" size="xl" onClick={onClose}>{si.actions.keep}</BigButton>
        <BigButton tone="red" busy={busy} onClick={() => onConfirm(reason.trim() || null)}>{si.actions.confirmCancel}</BigButton>
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

