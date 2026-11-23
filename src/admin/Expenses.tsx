import { useState } from 'react';
import { Plus, Trash2, Copy } from 'lucide-react';
import { repo } from '../data';
import type { Expense, ExpenseType } from '../types';
import { lkr, sum } from '../lib/money';
import { dateKey, daysInMonth, monthKey, shiftMonth } from '../lib/time';
import { Spinner, cx } from '../components/ui';
import { Btn, Card, MonthPicker, PageHeader, inputCls, useMonthData } from './common';

export const FIXED_CATEGORIES = ['CEB Electricity', 'Water', 'Internet', 'Caretaker Salary'];
export const VARIABLE_CATEGORIES = ['Laundry', 'Cleaning Supplies', 'Food Ingredients', 'Repairs', 'Other'];

export const Expenses = () => {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const { data, error, reload } = useMonthData(month);
  const [type, setType] = useState<ExpenseType>('variable');
  const [category, setCategory] = useState(VARIABLE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => dateKey(new Date()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const categories = type === 'fixed' ? FIXED_CATEGORIES : VARIABLE_CATEGORIES;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!(value > 0)) return;
    setBusy(true);
    setMsg(null);
    try {
      await repo.addExpense({ expense_type: type, category, amount: value, expense_date: date, note: note.trim() || null });
      setAmount('');
      setNote('');
      if (date.slice(0, 7) !== month) setMonth(date.slice(0, 7));
      else await reload();
    } catch {
      setMsg('Could not save the expense.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (x: Expense) => {
    if (!confirm(`Delete ${x.category} – ${lkr(x.amount)}? This is recorded in the audit log.`)) return;
    await repo.deleteExpense(x.id);
    await reload();
  };

  /** Fixed bills rarely change: copy last month's fixed lines into this month in one click. */
  const copyFixed = async () => {
    const prev = shiftMonth(month, -1);
    const last = (await repo.listExpenses(`${prev}-01`, `${month}-01`)).filter((e) => e.expense_type === 'fixed');
    const existing = new Set((data?.expenses ?? []).filter((e) => e.expense_type === 'fixed').map((e) => e.category));
    const todo = last.filter((e) => !existing.has(e.category));
    if (todo.length === 0) {
      setMsg('Nothing to copy – fixed expenses already entered (or none last month).');
      return;
    }
    if (!confirm(`Copy ${todo.length} fixed expense(s) from last month (${lkr(sum(todo.map((t) => t.amount)))})?`)) return;
    for (const e of todo) {
      await repo.addExpense({ expense_type: 'fixed', category: e.category, amount: e.amount, expense_date: `${month}-${String(Math.min(Number(e.expense_date.slice(8)), daysInMonth(month))).padStart(2, '0')}`, note: 'Copied from last month' });
    }
    await reload();
  };

  const list = data?.expenses ?? [];
  const fixed = list.filter((e) => e.expense_type === 'fixed');
  const variable = list.filter((e) => e.expense_type === 'variable');

  return (
    <div>
      <PageHeader title="Expenses">
        <MonthPicker value={month} onChange={setMonth} />
        <Btn onClick={() => void copyFixed()}><Copy className="size-4" /> Copy last month&apos;s fixed</Btn>
      </PageHeader>
      {(error || msg) && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-amber-900">{error ?? msg}</p>}

      <Card title="Add expense" className="mb-4">
        <form onSubmit={(e) => void add(e)} className="grid gap-3 md:grid-cols-6">
          <div className="flex rounded-xl border border-slate-300 p-1 md:col-span-2">
            {(['variable', 'fixed'] as const).map((t) => (
              <button key={t} type="button" onClick={() => { setType(t); setCategory((t === 'fixed' ? FIXED_CATEGORIES : VARIABLE_CATEGORIES)[0]); }}
                className={cx('flex-1 rounded-lg py-2 text-sm font-semibold', type === t ? 'bg-teal-700 text-white' : 'text-slate-600')}>
                {t === 'fixed' ? 'Fixed (monthly)' : 'Variable (daily)'}
              </button>
            ))}
          </div>
          <select className={cx(inputCls, 'md:col-span-2')} value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input className={inputCls} type="number" min="1" step="1" placeholder="Amount (LKR)" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <input className={cx(inputCls, 'md:col-span-5')} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Btn type="submit" tone="primary" disabled={busy}><Plus className="size-4" /> Add</Btn>
        </form>
      </Card>

      {!data ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ExpenseList title={`Fixed · ${lkr(sum(fixed.map((e) => e.amount)))}`} items={fixed} onDelete={remove} />
          <ExpenseList title={`Variable · ${lkr(sum(variable.map((e) => e.amount)))}`} items={variable} onDelete={remove} />
        </div>
      )}
    </div>
  );
};

const ExpenseList = ({ title, items, onDelete }: { title: string; items: Expense[]; onDelete: (e: Expense) => void }) => (
  <Card title={title}>
    {items.length === 0 ? <p className="text-sm text-slate-500">None this month.</p> : (
      <ul className="divide-y divide-slate-100">
        {items.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div>
              <div className="font-medium">{e.category}</div>
              <div className="text-xs text-slate-500">{e.expense_date}{e.note ? ` · ${e.note}` : ''}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular font-semibold">{lkr(e.amount)}</span>
              <button type="button" aria-label="Delete" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => onDelete(e)}>
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    )}
  </Card>
);
