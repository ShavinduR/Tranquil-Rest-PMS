import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { repo } from '../data';
import type { Booking, Expense, Payment } from '../types';
import { monthKey, monthRange, shiftMonth } from '../lib/time';
import { cx } from '../components/ui';

export const monthLabel = (key: string): string => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export const MonthPicker = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className="flex items-center gap-1 rounded-xl border border-slate-300 bg-white p-1">
    <button type="button" aria-label="Previous month" className="rounded-lg p-2 hover:bg-slate-100" onClick={() => onChange(shiftMonth(value, -1))}>
      <ChevronLeft className="size-5" />
    </button>
    <span className="min-w-36 text-center font-semibold">{monthLabel(value)}</span>
    <button type="button" aria-label="Next month" className="rounded-lg p-2 hover:bg-slate-100" onClick={() => onChange(shiftMonth(value, 1))}
      disabled={value >= monthKey(new Date())}>
      <ChevronRight className={cx('size-5', value >= monthKey(new Date()) && 'opacity-30')} />
    </button>
  </div>
);

export const Card = ({ title, children, className, action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) => (
  <section className={cx('rounded-2xl border border-slate-200 bg-white p-4 shadow-sm', className)}>
    {(title || action) && (
      <div className="mb-3 flex items-center justify-between gap-2">
        {title && <h2 className="font-semibold text-slate-800">{title}</h2>}
        {action}
      </div>
    )}
    {children}
  </section>
);

export const PageHeader = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

export const Btn = ({ children, onClick, tone = 'default', disabled, type = 'button' }: {
  children: ReactNode; onClick?: () => void; tone?: 'default' | 'primary' | 'danger'; disabled?: boolean; type?: 'button' | 'submit';
}) => (
  <button type={type} onClick={onClick} disabled={disabled}
    className={cx('inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-40',
      tone === 'primary' && 'bg-teal-700 text-white hover:bg-teal-800',
      tone === 'danger' && 'border border-red-300 text-red-700 hover:bg-red-50',
      tone === 'default' && 'border border-slate-300 bg-white hover:bg-slate-50')}>
    {children}
  </button>
);

export const inputCls = 'min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20';

export type MonthData = { bookings: Booking[]; stays: Booking[]; payments: Payment[]; expenses: Expense[] };

/** Everything the finance views need for one month. */
export const useMonthData = (month: string) => {
  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const { start, end } = monthRange(month);
      const next = shiftMonth(month, 1);
      const [overlapping, stays, payments, expenses] = await Promise.all([
        repo.listBookings(start, end),
        repo.listBookingsByCheckIn(start, end),
        repo.listPayments(start, end),
        repo.listExpenses(`${month}-01`, `${next}-01`),
      ]);
      const byId = new Map([...overlapping, ...stays].map((b) => [b.id, b]));
      setData({ bookings: [...byId.values()], stays, payments, expenses });
    } catch {
      setError('Could not load data. Check your connection.');
    }
  }, [month]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);
  return { data, error, reload: load };
};

export const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' });

export const TYPE_EN = { short_time: 'Short Time', day: 'Day', night: 'Night', full_day: 'Full Day' } as const;
export const STATUS_EN = { booked: 'Booked', checked_in: 'Checked in', checked_out: 'Checked out', cancelled: 'Cancelled' } as const;
