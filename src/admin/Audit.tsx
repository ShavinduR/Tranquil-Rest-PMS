import { useCallback, useEffect, useState } from 'react';
import { repo } from '../data';
import type { AuditLog } from '../types';
import { Spinner, cx } from '../components/ui';
import { Btn, Card, PageHeader, fmtDateTime, inputCls } from './common';

const PAGE = 50;
const TABLES = ['bookings', 'payments', 'refunds', 'booking_addons', 'expenses', 'profiles', 'rooms', 'pricing_rules', 'settings', 'addon_presets'];
const IGNORED = new Set(['updated_at', 'updated_by', 'created_at']);

const actionCls: Record<string, string> = {
  insert: 'bg-green-100 text-green-800', update: 'bg-blue-100 text-blue-800', cancel: 'bg-red-100 text-red-800',
  delete: 'bg-red-600 text-white', check_in: 'bg-orange-100 text-orange-800', check_out: 'bg-slate-200 text-slate-800',
};

/** Fields whose value changed between old and new, ignoring bookkeeping columns. */
const changes = (log: AuditLog): [string, unknown, unknown][] => {
  if (!log.old_data || !log.new_data) return [];
  return Object.keys(log.new_data)
    .filter((k) => !IGNORED.has(k) && JSON.stringify(log.old_data?.[k]) !== JSON.stringify(log.new_data?.[k]))
    .map((k) => [k, log.old_data?.[k], log.new_data?.[k]]);
};

const show = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const describe = (log: AuditLog): string => {
  const d = (log.new_data ?? log.old_data ?? {}) as Record<string, unknown>;
  if (log.table_name === 'bookings') return `${show(d.guest_name ?? d.guest_phone)} · ${show(d.booking_type)}`;
  if (log.table_name === 'payments') return `${show(d.kind)} ${show(d.method)} LKR ${show(d.amount)}`;
  if (log.table_name === 'refunds') return `refund ${show(d.method)} LKR ${show(d.amount)}`;
  if (log.table_name === 'booking_addons') return `${show(d.label)} × ${show(d.quantity)}`;
  if (log.table_name === 'expenses') return `${show(d.category)} LKR ${show(d.amount)}`;
  if (log.table_name === 'pricing_rules') return `${show(d.category)} ${show(d.booking_type)}`;
  if (log.table_name === 'rooms') return show(d.name);
  if (log.table_name === 'profiles') return `${show(d.display_name)} (${show(d.role)})${d.pin_changed === true ? ' · PIN changed' : ''}`;
  return '';
};

export const AuditPage = () => {
  const [table, setTable] = useState('');
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [more, setMore] = useState(true);

  const load = useCallback(async (before?: number) => {
    const page = await repo.listAudit({ limit: PAGE, before, table: table || undefined });
    setLogs((cur) => (before ? [...(cur ?? []), ...page] : page));
    setMore(page.length === PAGE);
  }, [table]);

  useEffect(() => {
    setLogs(null);
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader title="Audit log">
        <select className={cx(inputCls, 'w-auto')} value={table} onChange={(e) => setTable(e.target.value)}>
          <option value="">All records</option>
          {TABLES.map((t) => <option key={t} value={t}>{t === 'profiles' ? 'staff' : t.replace('_', ' ')}</option>)}
        </select>
      </PageHeader>
      <Card>
        {!logs ? <Spinner /> : logs.length === 0 ? <p className="py-6 text-center text-slate-500">No activity yet.</p> : (
          <ul className="divide-y divide-slate-100">
            {logs.map((l) => (
              <li key={l.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-slate-500">{fmtDateTime(l.created_at)}</span>
                  <span className="font-medium">{l.actor_name ?? 'system'}</span>
                  <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium', actionCls[l.action] ?? 'bg-slate-100')}>{l.action.replace('_', ' ')}</span>
                  <span className="text-slate-500">{l.table_name === 'profiles' ? 'staff' : l.table_name.replace('_', ' ')}</span>
                  <span className="si text-slate-800">{describe(l)}</span>
                </div>
                {changes(l).length > 0 && (
                  <ul className="mt-1 ml-2 text-xs text-slate-600">
                    {changes(l).map(([k, a, b]) => (
                      <li key={k}><span className="font-mono">{k}</span>: <s className="text-red-600">{show(a)}</s> → <span className="text-green-700">{show(b)}</span></li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        {logs && more && <div className="mt-3"><Btn onClick={() => void load(logs[logs.length - 1]?.id)}>Load more</Btn></div>}
      </Card>
    </div>
  );
};
