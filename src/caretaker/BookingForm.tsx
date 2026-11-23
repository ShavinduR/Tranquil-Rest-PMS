import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, Pencil, Clock, Phone, Utensils, ChevronUp } from 'lucide-react';
import { useAppData } from '../data/AppData';
import { repo } from '../data';
import { BookingInPastError, NetworkError, SlotTakenError } from '../data/repo';
import { BOOKING_TYPES, type Booking, type BookingType, type PaymentMethod, type SlotIssue } from '../types';
import { defaultSlot, findRule, startsTooEarly } from '../lib/pricing';
import { findSlotIssues, hasOverlap } from '../lib/conflicts';
import { addDaysKey, addMinutes, dateKey, toLocalInput, fromLocalInput } from '../lib/time';
import { parsePhone } from '../lib/phone';
import { rupeesSi } from '../lib/money';
import { dateTimeSi, fullDateSi, si, timeSi, daySi } from '../i18n/si';
import { BigButton, Choice, Dialog, ErrorNote, Section, Spinner, cx } from '../components/ui';
import { AddonPicker, AdvancePicker, AmountInput, MethodPicker, SummaryRow, cartTotal, type CartLine } from './parts';
import { BookingSaved } from './BookingSaved';

type Mode = 'walk_in' | 'future';

export const BookingForm = () => {
  const params = useParams<{ mode: string }>();
  const mode: Mode = params.mode === 'future' ? 'future' : 'walk_in';
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { reference, bookings, canWrite, refresh } = useAppData();

  const today = dateKey(new Date());
  const [date, setDate] = useState(search.get('date') ?? (mode === 'future' ? addDaysKey(today, 1) : today));
  const [type, setType] = useState<BookingType | null>(null);
  const [roomId, setRoomId] = useState<string | null>(search.get('room'));
  const [startShift, setStartShift] = useState(0);
  const [endShift, setEndShift] = useState(0);
  const [priceOverride, setPriceOverride] = useState<number | null>(null);
  const [editingPrice, setEditingPrice] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [advance, setAdvance] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [serverIssues, setServerIssues] = useState<Record<string, SlotIssue[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmBuffer, setConfirmBuffer] = useState(false);
  const [saved, setSaved] = useState<Booking | null>(null);
  const [anchorNow] = useState(() => new Date());
  const [showAddons, setShowAddons] = useState(false);
  const [confirmPrice, setConfirmPrice] = useState(false);
  // Opened from "availability by date": start Short Time / Full Day at that free time.
  const startParam = search.get('start');

  const rooms = useMemo(() => (reference?.rooms ?? []).filter((r) => r.active), [reference]);
  const room = rooms.find((r) => r.id === roomId) ?? null;
  const category = room?.category ?? rooms[0]?.category ?? 'non_ac';
  const rule = reference && type ? findRule(reference.pricing, category, type) : undefined;

  const slot = useMemo(() => {
    if (!rule) return null;
    const base = mode === 'walk_in'
      ? defaultSlot(rule, { mode, now: anchorNow })
      : defaultSlot(rule, { mode, date, now: anchorNow, startClock: rule.duration_minutes && startParam ? startParam : undefined });
    const start = addMinutes(base.start, startShift);
    let end = addMinutes(base.end, endShift + startShift * (rule.duration_minutes ? 1 : 0));
    if (end <= start) end = addMinutes(start, 30);
    return { start, end, available: base.available };
  }, [rule, mode, anchorNow, date, startShift, endShift, startParam]);

  // Booking types that make no sense right now (e.g. "Day" at 16:30) are disabled.
  const typeAvailable = (t: BookingType): boolean => {
    const r = reference ? findRule(reference.pricing, category, t) : undefined;
    if (!r) return false;
    return (mode === 'walk_in' ? defaultSlot(r, { mode, now: anchorNow }) : defaultSlot(r, { mode, date, now: anchorNow })).available;
  };
  useEffect(() => {
    if (type && !typeAvailable(type)) setType(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, type]);

  // Reset manual adjustments whenever the preset or date changes.
  useEffect(() => {
    setStartShift(0);
    setEndShift(0);
    setPriceOverride(null);
    setEditingPrice(false);
  }, [type, date]);

  // Ask the server about every room for the chosen slot (covers dates beyond the offline cache).
  useEffect(() => {
    if (!slot || !canWrite) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const entries = await Promise.all(rooms.map(async (r) => [r.id, await repo.checkSlot(r.id, slot.start, slot.end)] as const));
        if (!cancelled) setServerIssues(Object.fromEntries(entries));
      } catch {
        /* fall back to local check below */
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [slot, rooms, canWrite]);

  const issuesFor = (id: string): SlotIssue[] => {
    if (!slot || !reference) return [];
    return serverIssues[id] ?? findSlotIssues(bookings, id, slot.start, slot.end, reference.settings.cleaning_buffer_minutes);
  };

  // Returning guest: fill in the name from their last stay.
  const parsedPhone = parsePhone(phone);
  const storedPhone = parsedPhone?.stored ?? null;
  useEffect(() => {
    if (!storedPhone || name) return;
    let cancelled = false;
    void repo.findGuestName(storedPhone).then((n) => {
      if (!cancelled && n) setName((cur) => cur || n);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedPhone]);

  if (!reference) return <Spinner />;
  if (saved && room) return <BookingSaved booking={saved} room={room} settings={reference.settings} />;

  const roomCharge = priceOverride ?? rule?.price ?? 0;
  const addonSum = cartTotal(cart);
  const total = roomCharge + addonSum;
  const balance = Math.max(0, total - advance);
  const roomIssues = room ? issuesFor(room.id) : [];
  const blocked = hasOverlap(roomIssues);
  const phoneTouched = phone.replace(/\D/g, '').length >= 9;
  const tooEarly = slot ? startsTooEarly(slot.start, new Date(), mode) : false;

  const save = async (acceptBuffer = false) => {
    setError(null);
    if (!type || !room || !slot || !storedPhone) {
      setError(si.form.missing);
      return;
    }
    if (startsTooEarly(slot.start, new Date(), mode)) {
      setError(si.form.pastStart);
      return;
    }
    if (blocked) {
      setError(si.form.overlap);
      return;
    }
    if (!acceptBuffer && roomIssues.some((i) => i.kind === 'buffer')) {
      setConfirmBuffer(true);
      return;
    }
    setSaving(true);
    try {
      const booking = await repo.createBooking({
        room_id: room.id,
        booking_type: type,
        guest_name: name.trim() || null,
        guest_phone: storedPhone,
        check_in_time: slot.start.toISOString(),
        check_out_time: slot.end.toISOString(),
        room_charge: roomCharge,
        status: mode === 'walk_in' ? 'checked_in' : 'booked',
        notes: null,
        advance: advance > 0 ? { kind: 'advance', method, amount: Math.min(advance, total) } : null,
        addons: cart.map(({ label, unit_price, quantity }) => ({ label, unit_price, quantity })),
      });
      setSaved(booking);
      void refresh();
    } catch (e) {
      if (e instanceof SlotTakenError) setError(si.conflictError);
      else if (e instanceof BookingInPastError) setError(si.pastError);
      else if (e instanceof NetworkError) setError(si.networkError);
      else setError(si.error);
      void refresh();
    } finally {
      setSaving(false);
    }
  };

  const shiftLimit = (v: number) => Math.max(-12 * 60, Math.min(12 * 60, v));

  return (
    <div className="space-y-3 p-3 pb-40">
      <header className="flex items-center gap-2">
        <button type="button" onClick={() => navigate(-1)} className="si flex min-h-14 items-center gap-1 rounded-2xl bg-white px-4 text-lg font-bold shadow-sm active:bg-slate-100">
          <ArrowLeft className="size-6" aria-hidden /> {si.actions.back}
        </button>
        <h1 className="si text-2xl font-extrabold text-slate-900">{mode === 'walk_in' ? si.form.titleWalkIn : si.form.titleFuture}</h1>
      </header>

      {mode === 'future' && (
        <Section title={si.form.date} step={1}>
          <div className="grid grid-cols-3 gap-2">
            {[
              [today, si.form.today],
              [addDaysKey(today, 1), si.form.tomorrow],
              [addDaysKey(today, 2), si.form.dayAfter],
            ].map(([key, label]) => (
              <Choice key={key} selected={date === key} onClick={() => setDate(key)} className="text-center text-xl">
                {label}
              </Choice>
            ))}
          </div>
          <label className="si mt-3 block">
            <span className="mb-1 block text-lg font-semibold text-slate-700">{si.form.otherDay}</span>
            <input
              type="date"
              min={today}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="min-h-16 w-full rounded-2xl border-[3px] border-slate-300 px-3 text-xl font-semibold outline-none focus:border-teal-700"
            />
          </label>
          <p className="si mt-2 text-lg font-bold text-teal-800">{fullDateSi(fromLocalInput(`${date}T12:00`))}</p>
        </Section>
      )}

      <Section title={si.form.type} step={mode === 'future' ? 2 : 1}>
        <div className="grid grid-cols-2 gap-2">
          {BOOKING_TYPES.map((t) => {
            const r = findRule(reference.pricing, category, t);
            const open = typeAvailable(t);
            return (
              <Choice key={t} selected={type === t} disabled={!open} onClick={() => setType(t)} className="text-center">
                <span className="block text-xl font-bold">{si.bookingType[t]}</span>
                <span className="tabular block text-lg text-slate-600">{r ? rupeesSi(r.price) : '-'}</span>
                <span className="block text-sm text-slate-500">{r ? ruleHint(r) : ''}</span>
                {!open && <span className="mt-1 block rounded-lg bg-slate-200 text-sm font-bold text-slate-700">{si.form.closedToday}</span>}
              </Choice>
            );
          })}
        </div>
        {BOOKING_TYPES.some((t) => !typeAvailable(t)) && (
          <p className="si mt-3 rounded-2xl bg-amber-50 p-3 text-base font-semibold text-amber-900">{si.form.closedHint}</p>
        )}
      </Section>

      {slot && (
        <Section title={si.form.time} step={mode === 'future' ? 3 : 2}>
          <TimeRow
            label={si.form.from}
            date={slot.start}
            onMinus={() => setStartShift((v) => shiftLimit(v - 30))}
            onPlus={() => setStartShift((v) => shiftLimit(v + 30))}
          />
          <TimeRow
            label={si.form.to}
            date={slot.end}
            onMinus={() => setEndShift((v) => shiftLimit(v - 30))}
            onPlus={() => setEndShift((v) => shiftLimit(v + 30))}
          />
          {tooEarly && <p role="alert" className="si mt-2 rounded-2xl bg-red-50 p-3 text-lg font-semibold text-red-800">{si.form.pastStart}</p>}
          <details className="si mt-2 text-slate-600">
            <summary className="cursor-pointer py-2 text-base">{si.actions.edit} (දිනය / වේලාව)</summary>
            <div className="grid grid-cols-1 gap-2">
              <input type="datetime-local" className="min-h-14 rounded-xl border-2 px-2 text-lg" value={toLocalInput(slot.start)}
                onChange={(e) => e.target.value && setStartShift((v) => v + Math.round((fromLocalInput(e.target.value).getTime() - slot.start.getTime()) / 60000))} />
              <input type="datetime-local" className="min-h-14 rounded-xl border-2 px-2 text-lg" value={toLocalInput(slot.end)}
                onChange={(e) => e.target.value && setEndShift((v) => v + Math.round((fromLocalInput(e.target.value).getTime() - slot.end.getTime()) / 60000))} />
            </div>
          </details>
        </Section>
      )}

      {slot && (
        <Section title={si.form.room} step={mode === 'future' ? 4 : 3}>
          <div className="grid grid-cols-2 gap-2">
            {rooms.map((r) => {
              const issues = issuesFor(r.id);
              const taken = hasOverlap(issues);
              const tight = !taken && issues.length > 0;
              return (
                <Choice
                  key={r.id}
                  selected={roomId === r.id}
                  disabled={taken}
                  tone={tight ? 'orange' : 'teal'}
                  onClick={() => setRoomId(r.id)}
                  className={cx('text-center', taken && 'bg-slate-200 line-through decoration-2')}
                >
                  <span className="block text-2xl font-extrabold">{r.name_si}</span>
                  {r.category === 'ac' && <span className="block text-sm font-bold text-blue-700">ඒසී</span>}
                  {taken && <span className="block text-base font-bold text-red-700 no-underline">{si.form.taken}</span>}
                  {tight && <span className="block text-sm font-bold text-orange-700">{si.form.bufferWarn}</span>}
                </Choice>
              );
            })}
          </div>
          {room && roomIssues.length > 0 && (
            <ul className="si mt-3 space-y-1 text-base">
              {roomIssues.map((i) => (
                <li key={i.booking_id} className={cx('rounded-xl px-3 py-2 font-semibold', i.kind === 'overlap' ? 'bg-red-50 text-red-800' : 'bg-orange-50 text-orange-900')}>
                  {i.kind === 'overlap' ? si.form.taken : si.form.bufferWarn}: {dateTimeSi(new Date(i.check_in_time))} – {timeSi(new Date(i.check_out_time))}
                  {i.guest_name ? ` (${i.guest_name})` : ''}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {slot && room && (
        <Section title={si.form.phone} step={mode === 'future' ? 5 : 4}>
          <div className="flex items-center rounded-2xl border-[3px] border-slate-300 bg-white focus-within:border-teal-700">
            <Phone className="ml-3 size-7 shrink-0 text-slate-500" aria-hidden />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder={si.form.phoneHint}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, '').slice(0, 22))}
              className="tabular min-h-16 w-full bg-transparent px-3 text-2xl font-bold tracking-wide outline-none"
            />
          </div>
          {!phoneTouched && <p className="si mt-2 text-base text-slate-500">{si.form.phoneForeign}</p>}
          {phoneTouched && !parsedPhone && <p className="si mt-2 text-lg font-semibold text-red-700">{si.form.phoneInvalid}</p>}
          {parsedPhone && <p className="si mt-2 text-lg font-semibold text-green-700">✓ {parsedPhone.display}</p>}
          <label className="si mt-3 block">
            <span className="mb-1 block text-lg font-semibold text-slate-700">{si.form.name}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 60))}
              className="si min-h-16 w-full rounded-2xl border-[3px] border-slate-300 px-3 text-xl outline-none focus:border-teal-700"
            />
          </label>
        </Section>
      )}

      {slot && room && (
        // Folded by default: most bookings have no food, and older staff scroll less.
        <Section title={si.form.addons} step={mode === 'future' ? 6 : 5}>
          {cart.length > 0 && !showAddons && (
            <ul className="si mb-3 space-y-1 text-lg">
              {cart.map((l) => (
                <li key={l.key} className="flex justify-between rounded-xl bg-teal-50 px-3 py-2">
                  <span>{l.label} × {l.quantity}</span>
                  <span className="tabular font-bold">{rupeesSi(l.unit_price * l.quantity)}</span>
                </li>
              ))}
            </ul>
          )}
          {showAddons ? (
            <>
              <AddonPicker presets={reference.presets} lines={cart} onChange={setCart} />
              <BigButton tone="neutral" className="mt-3" icon={<ChevronUp className="size-6" aria-hidden />} onClick={() => setShowAddons(false)}>
                {si.form.hideAddons}
              </BigButton>
            </>
          ) : (
            <BigButton tone="neutral" icon={<Utensils className="size-6 text-orange-600" aria-hidden />} onClick={() => setShowAddons(true)}>
              {si.form.showAddons}
            </BigButton>
          )}
        </Section>
      )}

      {slot && room && (
        <Section title={si.form.advance} step={mode === 'future' ? 7 : 6}>
          <div className="mb-3 rounded-2xl bg-slate-50 p-3">
            <SummaryRow label={priceOverride !== null ? si.form.priceChanged : si.form.price} value={rupeesSi(roomCharge)} />
            {!editingPrice ? (
              <button type="button" className="si flex items-center gap-2 py-1 text-base font-semibold text-teal-800 underline" onClick={() => setConfirmPrice(true)}>
                <Pencil className="size-4" aria-hidden /> {si.form.editPrice}
              </button>
            ) : (
              <AmountInput label={si.form.editPrice} value={roomCharge} onChange={(v) => setPriceOverride(v)} autoFocus />
            )}
            {addonSum > 0 && <SummaryRow label={si.form.addons} value={rupeesSi(addonSum)} />}
            <SummaryRow label={si.form.total} value={rupeesSi(total)} strong />
          </div>
          <AdvancePicker total={total} value={Math.min(advance, total)} onChange={setAdvance} />
          {advance > 0 && (
            <div className="mt-3">
              <p className="si mb-2 text-lg font-semibold text-slate-700">{si.form.method}</p>
              <MethodPicker value={method} onChange={setMethod} />
            </div>
          )}
        </Section>
      )}

      {/* Sticky save bar: always shows the balance that will be due. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-slate-200 bg-white/95 p-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur safe-bottom">
        <div className="mx-auto max-w-2xl space-y-2">
          <ErrorNote>{error}</ErrorNote>
          {room && slot && (
            <div className="si flex justify-between text-lg">
              <span>{room.name_si} · {daySi(slot.start)} {timeSi(slot.start)}</span>
              <span className="font-bold">
                {si.form.balance}: <span className={cx('tabular', balance > 0 ? 'text-red-700' : 'text-green-700')}>{rupeesSi(balance)}</span>
              </span>
            </div>
          )}
          <BigButton size="xl" tone="green" icon={<Save className="size-8" aria-hidden />} busy={saving}
            disabled={!canWrite || !type || !room || !storedPhone || blocked || tooEarly} onClick={() => void save()}>
            {saving ? si.actions.saving : si.actions.save}
          </BigButton>
        </div>
      </div>

      <Dialog open={confirmPrice} onClose={() => setConfirmPrice(false)} labelledBy="price-title">
        <h2 id="price-title" className="si mb-3 text-2xl font-bold text-amber-800">{si.form.priceConfirmTitle}</h2>
        <p className="si mb-4 text-lg">{si.form.priceConfirmBody}</p>
        <SummaryRow label={si.form.price} value={rupeesSi(rule?.price ?? 0)} strong />
        <div className="mt-5 space-y-3">
          <BigButton tone="neutral" size="xl" onClick={() => setConfirmPrice(false)}>{si.actions.back}</BigButton>
          <BigButton tone="orange" onClick={() => { setConfirmPrice(false); setEditingPrice(true); }}>{si.form.priceConfirmYes}</BigButton>
        </div>
      </Dialog>

      <Dialog open={confirmBuffer} onClose={() => setConfirmBuffer(false)} labelledBy="buffer-title">
        <h2 id="buffer-title" className="si mb-4 text-2xl font-bold text-orange-800">{si.form.bufferWarn}</h2>
        <p className="si mb-6 text-xl">{si.form.bufferConfirm}</p>
        <div className="space-y-3">
          <BigButton tone="orange" onClick={() => { setConfirmBuffer(false); void save(true); }}>{si.actions.save}</BigButton>
          <BigButton tone="neutral" onClick={() => setConfirmBuffer(false)}>{si.actions.back}</BigButton>
        </div>
      </Dialog>
    </div>
  );
};

const ruleHint = (r: { default_start_time: string | null; default_end_time: string | null; duration_minutes: number | null }) => {
  if (r.default_start_time && r.default_end_time) {
    const d = fromLocalInput(`2000-01-01T${r.default_start_time.slice(0, 5)}`);
    const e = fromLocalInput(`2000-01-01T${r.default_end_time.slice(0, 5)}`);
    return `${timeSi(d)} – ${timeSi(e)}`;
  }
  return r.duration_minutes ? `පැය ${Math.round(r.duration_minutes / 60)}` : '';
};

const TimeRow = ({ label, date, onMinus, onPlus }: { label: string; date: Date; onMinus: () => void; onPlus: () => void }) => (
  <div className="mb-2 flex items-center gap-2 rounded-2xl bg-slate-50 p-2">
    <button type="button" onClick={onMinus} aria-label={si.form.minus30} className="si min-h-14 rounded-xl bg-white px-3 text-lg font-bold shadow active:bg-slate-100">−30</button>
    <div className="si flex-1 text-center">
      <div className="text-base text-slate-600">{label}</div>
      <div className="flex items-center justify-center gap-1 text-xl font-extrabold">
        <Clock className="size-5 text-slate-500" aria-hidden />
        {daySi(date)} {timeSi(date)}
      </div>
    </div>
    <button type="button" onClick={onPlus} aria-label={si.form.plus30} className="si min-h-14 rounded-xl bg-white px-3 text-lg font-bold shadow active:bg-slate-100">+30</button>
  </div>
);
