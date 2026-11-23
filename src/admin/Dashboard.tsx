import { useMemo, useState } from 'react';
import { Download, TrendingUp, TrendingDown, Wallet, Landmark, Hourglass, Percent } from 'lucide-react';
import { useAppData } from '../data/AppData';
import { summarizeMonth, type MonthSummary } from '../lib/finance';
import { lkr, plain } from '../lib/money';
import { monthKey } from '../lib/time';
import { BOOKING_TYPES, type Room } from '../types';
import { addonsTotal, balanceDue, bookingTotal, paidTotal } from '../lib/booking';
import { downloadCsv, toCsv } from '../lib/csv';
import { Spinner, cx } from '../components/ui';
import { Btn, Card, MonthPicker, PageHeader, TYPE_EN, STATUS_EN, fmtDateTime, monthLabel, useMonthData, type MonthData } from './common';

const BAR = '#09714E'; // brand green; validated: lightness, chroma and 3:1 contrast on white

export const Dashboard = () => {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const { reference } = useAppData();
  const { data, error } = useMonthData(month);
  const summary = useMemo(
    () => (data && reference ? summarizeMonth(month, data.bookings, data.payments, data.expenses, reference.rooms, data.refunds) : null),
    [data, reference, month],
  );

  return (
    <div>
      <PageHeader title="Dashboard">
        <MonthPicker value={month} onChange={setMonth} />
      </PageHeader>
      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
      {!summary || !data || !reference ? <Spinner /> : <DashboardBody s={summary} data={data} rooms={reference.rooms} month={month} />}
    </div>
  );
};

const DashboardBody = ({ s, data, rooms, month }: { s: MonthSummary; data: MonthData; rooms: Room[]; month: string }) => (
  <div className="space-y-4">
    <div className={cx('rounded-2xl p-5 text-white shadow-sm', s.netProfit >= 0 ? 'bg-teal-800' : 'bg-red-700')}>
      <div className="flex items-center gap-2 text-sm font-medium opacity-90">
        {s.netProfit >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
        Net profit · {monthLabel(month)} · ශුද්ධ ලාභය
      </div>
      <div className="tabular mt-1 text-4xl font-bold">{lkr(s.netProfit)}</div>
      <div className="mt-1 text-sm opacity-90">
        Collected {lkr(s.collected.total)} − Expenses {lkr(s.expenses.total)} (cash basis)
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi icon={<Wallet className="size-4" />} label="Cash collected" value={lkr(s.collected.cash)} />
      <Kpi icon={<Landmark className="size-4" />} label="Bank transfers" value={lkr(s.collected.bank)} />
      <Kpi icon={<Hourglass className="size-4" />} label="Pending balances" value={lkr(s.pendingBalances)} warn={s.pendingBalances > 0} />
      <Kpi icon={<Percent className="size-4" />} label="Occupancy" value={`${s.occupancyPct}%`} sub={`${s.bookingsCount} bookings · ${s.cancelledCount} cancelled`} />
    </div>

    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Money collected per day (LKR)" className="lg:col-span-2">
        <DailyBars daily={s.daily} />
      </Card>
      <Card title="Revenue">
        <Row label="Room charges (billed)" value={lkr(s.billed.rooms)} />
        <Row label="Food & beverage (billed)" value={lkr(s.billed.addons)} />
        <Row label="Total billed" value={lkr(s.billed.total)} strong />
        <hr className="my-2" />
        <Row label="Collected – Cash" value={lkr(s.collected.cash)} />
        <Row label="Collected – Bank" value={lkr(s.collected.bank)} />
        {s.refunded.total > 0 && <Row label="Refunded (already deducted)" value={`− ${lkr(s.refunded.total)}`} />}
        <Row label="Total collected" value={lkr(s.collected.total)} strong />
        <Row label="Still to collect" value={lkr(s.pendingBalances)} />
      </Card>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Expenses">
        <Row label="Fixed (monthly)" value={lkr(s.expenses.fixed)} />
        <Row label="Variable (daily)" value={lkr(s.expenses.variable)} />
        <Row label="Total expenses" value={lkr(s.expenses.total)} strong />
        <CategoryBars byCategory={s.expenses.byCategory} />
      </Card>
      <Card title="By booking type">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr><th className="py-1 font-medium">Type</th><th className="py-1 text-right font-medium">Bookings</th><th className="py-1 text-right font-medium">Revenue</th></tr>
          </thead>
          <tbody>
            {BOOKING_TYPES.map((t) => (
              <tr key={t} className="border-t border-slate-100">
                <td className="py-2">{TYPE_EN[t]}</td>
                <td className="tabular py-2 text-right">{s.byType[t].count}</td>
                <td className="tabular py-2 text-right">{lkr(s.byType[t].revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>

    <Card title="Export (opens in Excel)">
      <div className="flex flex-wrap gap-2">
        <Btn onClick={() => exportSummary(s)}><Download className="size-4" /> Summary</Btn>
        <Btn onClick={() => exportBookings(month, data, rooms)}><Download className="size-4" /> Bookings</Btn>
        <Btn onClick={() => exportPayments(month, data, rooms)}><Download className="size-4" /> Payments</Btn>
        <Btn onClick={() => exportExpenses(month, data)}><Download className="size-4" /> Expenses</Btn>
      </div>
    </Card>
  </div>
);

const Kpi = ({ icon, label, value, sub, warn }: { icon: React.ReactNode; label: string; value: string; sub?: string; warn?: boolean }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">{icon}{label}</div>
    <div className={cx('tabular mt-1 text-xl font-bold', warn ? 'text-amber-700' : 'text-slate-900')}>{value}</div>
    {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
  </div>
);

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className={cx('flex justify-between py-1 text-sm', strong && 'font-semibold')}>
    <span className="text-slate-600">{label}</span>
    <span className="tabular text-slate-900">{value}</span>
  </div>
);

/** Single-series column chart with per-bar hover tooltip and an accessible table fallback. */
const DailyBars = ({ daily }: { daily: MonthSummary['daily'] }) => {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.collected));
  const peak = daily.reduce((best, d, i) => (d.collected > daily[best].collected ? i : best), 0);
  const shown = hover ?? null;
  return (
    <div>
      <div className="relative h-48">
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-slate-200" />
        <span className="absolute -top-2 right-0 bg-white pl-1 text-[11px] text-slate-500">{plain(max)}</span>
        <div className="absolute inset-0 flex items-end gap-[2px] pt-3" onMouseLeave={() => setHover(null)}>
          {daily.map((d, i) => (
            <div key={d.date} className="group relative flex h-full flex-1 items-end"
              onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
              <div
                className="w-full rounded-t-[4px] transition-opacity"
                style={{ height: `${(d.collected / max) * 100}%`, minHeight: d.collected > 0 ? 2 : 0, background: BAR, opacity: shown === null || shown === i ? 1 : 0.45 }}
              />
            </div>
          ))}
        </div>
        {shown !== null && (
          <div className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 rounded-lg bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow"
            style={{ left: `${((shown + 0.5) / daily.length) * 100}%` }}>
            {daily[shown].date.slice(8)} · {lkr(daily[shown].collected)}
            {daily[shown].expenses > 0 && <span className="block text-slate-300">spent {lkr(daily[shown].expenses)}</span>}
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between border-t border-slate-300 pt-1 text-[11px] text-slate-500">
        <span>1</span><span>{Math.ceil(daily.length / 2)}</span><span>{daily.length}</span>
      </div>
      {daily[peak].collected > 0 && <p className="mt-1 text-xs text-slate-500">Best day: {daily[peak].date.slice(8)} ({lkr(daily[peak].collected)})</p>}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-slate-500">Show as table</summary>
        <table className="mt-2 w-full text-xs">
          <thead><tr className="text-left text-slate-500"><th>Date</th><th className="text-right">Collected</th><th className="text-right">Expenses</th></tr></thead>
          <tbody>{daily.map((d) => <tr key={d.date} className="border-t border-slate-100"><td>{d.date}</td><td className="tabular text-right">{plain(d.collected)}</td><td className="tabular text-right">{plain(d.expenses)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
};

const CategoryBars = ({ byCategory }: { byCategory: Record<string, number> }) => {
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (entries.length === 0) return <p className="mt-3 text-sm text-slate-500">No expenses recorded this month.</p>;
  return (
    <ul className="mt-3 space-y-2">
      {entries.map(([cat, v]) => (
        <li key={cat} className="text-sm">
          <div className="flex justify-between"><span className="text-slate-700">{cat}</span><span className="tabular text-slate-900">{lkr(v)}</span></div>
          <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full" style={{ width: `${(v / max) * 100}%`, background: BAR }} /></div>
        </li>
      ))}
    </ul>
  );
};

// ---------- CSV exports ----------
const roomName = (rooms: Room[], id: string) => rooms.find((r) => r.id === id)?.name ?? id;

const exportSummary = (s: MonthSummary) => {
  const rows: (string | number)[][] = [
    ['Month', s.month],
    ['Collected – Cash (net of refunds)', s.collected.cash], ['Collected – Bank (net of refunds)', s.collected.bank], ['Collected – Total', s.collected.total],
    ['Refunded – Cash', s.refunded.cash], ['Refunded – Bank', s.refunded.bank],
    ['Billed – Rooms', s.billed.rooms], ['Billed – Food & beverage', s.billed.addons], ['Billed – Total', s.billed.total],
    ['Pending balances', s.pendingBalances],
    ['Expenses – Fixed', s.expenses.fixed], ['Expenses – Variable', s.expenses.variable], ['Expenses – Total', s.expenses.total],
    ...Object.entries(s.expenses.byCategory).map(([k, v]) => [`Expense: ${k}`, v]),
    ['Net profit (cash basis)', s.netProfit],
    ['Bookings', s.bookingsCount], ['Cancelled', s.cancelledCount], ['Occupancy %', s.occupancyPct],
    ...BOOKING_TYPES.map((t) => [`${TYPE_EN[t]} – count / revenue`, `${s.byType[t].count} / ${s.byType[t].revenue}`]),
  ];
  downloadCsv(`tranquil-rest-summary-${s.month}.csv`, toCsv(['Metric', 'Value (LKR)'], rows));
};

const exportBookings = (month: string, d: MonthData, rooms: Room[]) =>
  downloadCsv(`tranquil-rest-bookings-${month}.csv`, toCsv(
    ['Check-in', 'Check-out', 'Room', 'Type', 'Status', 'Guest', 'Phone', 'Room charge', 'Add-ons', 'Total', 'Paid', 'Balance', 'Cancel reason'],
    d.stays.map((b) => [fmtDateTime(b.check_in_time), fmtDateTime(b.check_out_time), roomName(rooms, b.room_id), TYPE_EN[b.booking_type],
      STATUS_EN[b.status], b.guest_name, b.guest_phone, b.room_charge, addonsTotal(b), bookingTotal(b), paidTotal(b),
      b.status === 'cancelled' ? 0 : balanceDue(b), b.cancel_reason]),
  ));

const exportPayments = (month: string, d: MonthData, rooms: Room[]) => {
  // Refunds are listed as negative amounts so the column sums to net money collected.
  const rows = [
    ...d.payments.map((p) => ({ at: p.paid_at, kind: p.kind, method: p.method, amount: p.amount, booking_id: p.booking_id })),
    ...d.refunds.map((r) => ({ at: r.refunded_at, kind: 'refund', method: r.method, amount: -r.amount, booking_id: r.booking_id })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  downloadCsv(`tranquil-rest-payments-${month}.csv`, toCsv(
    ['Paid at', 'Kind', 'Method', 'Amount', 'Room', 'Guest phone', 'Stay check-in'],
    rows.map((p) => {
      const b = d.byId.get(p.booking_id);
      return [fmtDateTime(p.at), p.kind, p.method, p.amount, b ? roomName(rooms, b.room_id) : '', b?.guest_phone ?? '', b ? fmtDateTime(b.check_in_time) : ''];
    }),
  ));
};

const exportExpenses = (month: string, d: MonthData) =>
  downloadCsv(`tranquil-rest-expenses-${month}.csv`, toCsv(
    ['Date', 'Type', 'Category', 'Amount', 'Note'],
    d.expenses.map((e) => [e.expense_date, e.expense_type, e.category, e.amount, e.note]),
  ));
