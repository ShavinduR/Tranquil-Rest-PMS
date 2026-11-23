import { useState } from 'react';
import { Minus, Plus, Banknote, Landmark } from 'lucide-react';
import type { AddonPreset, NewAddon, PaymentMethod } from '../types';
import { si } from '../i18n/si';
import { rupeesSi } from '../lib/money';
import { Choice, cx } from '../components/ui';

/** Digits-only amount field that opens the numeric keypad. */
export const AmountInput = ({
  value, onChange, label, autoFocus,
}: { value: number; onChange: (v: number) => void; label: string; autoFocus?: boolean }) => (
  <label className="block">
    <span className="si mb-1 block text-lg font-semibold text-slate-700">{label}</span>
    <div className="flex items-center rounded-2xl border-[3px] border-slate-300 bg-white focus-within:border-teal-700">
      <span className="si pl-4 text-xl font-bold text-slate-500">රු.</span>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        autoFocus={autoFocus}
        className="tabular min-h-16 w-full rounded-2xl bg-transparent px-3 text-2xl font-bold outline-none"
        value={value === 0 ? '' : String(value)}
        placeholder="0"
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '').slice(0, 7)) || 0)}
      />
    </div>
  </label>
);

export const MethodPicker = ({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) => (
  <div className="grid grid-cols-2 gap-3">
    <Choice selected={value === 'cash'} onClick={() => onChange('cash')} className="flex items-center justify-center gap-2 text-center text-lg">
      <Banknote className="size-7 text-green-700" aria-hidden /> {si.method.cash}
    </Choice>
    <Choice selected={value === 'bank'} onClick={() => onChange('bank')} className="flex items-center justify-center gap-2 text-center text-lg">
      <Landmark className="size-7 text-blue-700" aria-hidden /> {si.method.bank}
    </Choice>
  </div>
);

/** One-tap quick amounts (none / round sums / full) plus free entry. */
export const AdvancePicker = ({
  total, value, onChange,
}: { total: number; value: number; onChange: (v: number) => void }) => {
  const quick = Array.from(new Set([0, 500, 1000, Math.round(total / 2 / 100) * 100, total]))
    .filter((v) => v <= total)
    .sort((a, b) => a - b);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {quick.map((v) => (
          <Choice key={v} selected={value === v} onClick={() => onChange(v)} className="text-center text-lg">
            {v === 0 ? si.form.none : v === total ? si.form.full : null}
            <span className="tabular block">{rupeesSi(v)}</span>
          </Choice>
        ))}
      </div>
      <AmountInput label={si.form.custom} value={value} onChange={(v) => onChange(Math.min(v, total))} />
    </div>
  );
};

export type CartLine = NewAddon & { key: string };

/** Preset food/drink buttons: tap to add, +/- to adjust, plus a custom line. */
export const AddonPicker = ({
  presets, lines, onChange,
}: { presets: AddonPreset[]; lines: CartLine[]; onChange: (lines: CartLine[]) => void }) => {
  const [customLabel, setCustomLabel] = useState('');
  const [customAmount, setCustomAmount] = useState(0);

  const qty = (key: string) => lines.find((l) => l.key === key)?.quantity ?? 0;
  const setQty = (key: string, label: string, unit_price: number, q: number) => {
    const rest = lines.filter((l) => l.key !== key);
    onChange(q > 0 ? [...rest, { key, label, unit_price, quantity: q }] : rest);
  };
  const customs = lines.filter((l) => l.key.startsWith('custom-'));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {presets.filter((p) => p.active).map((p) => {
          const q = qty(p.id);
          return (
            <div
              key={p.id}
              className={cx('rounded-2xl border-[3px] p-2', q > 0 ? 'border-teal-700 bg-teal-50' : 'border-slate-300 bg-white')}
            >
              <button
                type="button"
                className="si w-full text-left active:scale-[0.98]"
                onClick={() => setQty(p.id, p.label_si, p.price, q + 1)}
              >
                <span className="block text-lg font-bold">{p.label_si}</span>
                <span className="tabular block text-slate-600">{rupeesSi(p.price)}</span>
              </button>
              {q > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <button type="button" aria-label="අඩු කරන්න" className="flex size-11 items-center justify-center rounded-xl bg-white shadow active:bg-slate-100" onClick={() => setQty(p.id, p.label_si, p.price, q - 1)}>
                    <Minus className="size-6" />
                  </button>
                  <span className="tabular text-2xl font-bold">{q}</span>
                  <button type="button" aria-label="වැඩි කරන්න" className="flex size-11 items-center justify-center rounded-xl bg-white shadow active:bg-slate-100" onClick={() => setQty(p.id, p.label_si, p.price, q + 1)}>
                    <Plus className="size-6" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {customs.map((c) => (
        <div key={c.key} className="si flex items-center justify-between rounded-2xl border-2 border-teal-700 bg-teal-50 px-3 py-2 text-lg">
          <span>{c.label}</span>
          <span className="flex items-center gap-3">
            <span className="tabular font-bold">{rupeesSi(c.unit_price)}</span>
            <button type="button" className="rounded-xl bg-white px-3 py-2 shadow" onClick={() => onChange(lines.filter((l) => l.key !== c.key))}>✕</button>
          </span>
        </div>
      ))}

      <div className="rounded-2xl border-2 border-dashed border-slate-300 p-3">
        <p className="si mb-2 text-lg font-semibold text-slate-700">{si.form.custom}</p>
        <input
          className="si mb-2 min-h-14 w-full rounded-2xl border-[3px] border-slate-300 px-3 text-lg outline-none focus:border-teal-700"
          placeholder={si.form.customLabel}
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
        />
        <div className="flex gap-2">
          <div className="flex-1">
            <AmountInput label="" value={customAmount} onChange={setCustomAmount} />
          </div>
          <button
            type="button"
            disabled={customAmount <= 0}
            className="si mt-1 min-h-16 self-end rounded-2xl bg-teal-700 px-5 text-lg font-bold text-white disabled:opacity-40"
            onClick={() => {
              onChange([...lines, { key: `custom-${Date.now()}`, label: customLabel.trim() || 'වෙනත්', unit_price: customAmount, quantity: 1 }]);
              setCustomLabel('');
              setCustomAmount(0);
            }}
          >
            <Plus className="size-7" aria-label="එකතු කරන්න" />
          </button>
        </div>
      </div>
    </div>
  );
};

export const cartTotal = (lines: readonly NewAddon[]): number => lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);

export const SummaryRow = ({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'red' | 'green' }) => (
  <div className={cx('si flex items-baseline justify-between gap-3 py-1', strong ? 'text-2xl font-bold' : 'text-lg')}>
    <span className="text-slate-700">{label}</span>
    <span className={cx('tabular font-bold', tone === 'red' && 'text-red-700', tone === 'green' && 'text-green-700')}>{value}</span>
  </div>
);
