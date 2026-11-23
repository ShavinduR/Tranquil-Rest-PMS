import { useState } from 'react';
import { FileUp, Eye, RotateCcw, Download, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { repo } from '../data';
import { useAppData } from '../data/AppData';
import { BACKUP_TABLES, parseBackupFile, type BackupFile, type RestoreMode, type RestoreReport } from '../data/repo';
import { cx } from '../components/ui';
import { Btn, Card, PageHeader, fmtDateTime, inputCls } from './common';

const BACKUP_FOLDER_URL = 'https://drive.google.com/drive/folders/10Iczo9m-yxF-JSbMkItAyUuvGQS5I9eM';
const CONFIRM_PHRASE = 'REPLACE ALL DATA';

const TABLE_LABEL: Record<string, string> = {
  rooms: 'Rooms', pricing_rules: 'Prices', addon_presets: 'Food presets', expenses: 'Expenses', bookings: 'Bookings',
  payments: 'Payments', refunds: 'Refunds', booking_addons: 'Food & drinks sold', audit_logs: 'Audit log entries', settings: 'General settings',
};

/** Saves a JSON file to the device. */
export const downloadJson = (filename: string, data: unknown): void => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export const RestorePage = () => {
  const { refresh } = useAppData();
  const [file, setFile] = useState<{ name: string; data: BackupFile } | null>(null);
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [preview, setPreview] = useState<RestoreReport | null>(null);
  const [result, setResult] = useState<RestoreReport | null>(null);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState<'preview' | 'restore' | 'export' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPreview(null);
    setResult(null);
    setPhrase('');
    setError(null);
  };

  const pick = async (f: File | undefined) => {
    reset();
    setFile(null);
    if (!f) return;
    try {
      setFile({ name: f.name, data: parseBackupFile(await f.text()) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file');
    }
  };

  const run = async <T,>(kind: NonNullable<typeof busy>, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(kind);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const doPreview = () =>
    file && run('preview', async () => setPreview(await repo.restoreBackup(file.data, mode, true)));

  const doRestore = () =>
    file &&
    run('restore', async () => {
      if (mode === 'merge' && !confirm('Put back the missing rows from this backup? Existing data is not changed.')) return;
      // Safety net: always keep a copy of what is about to be replaced.
      if (mode === 'replace') downloadJson(`tranquil-rest-before-restore-${stamp()}.json`, await repo.exportAll());
      const report = await repo.restoreBackup(file.data, mode, false, mode === 'replace' ? phrase : undefined);
      setResult(report);
      setPreview(null);
      await refresh();
    });

  const counts = file ? BACKUP_TABLES.map((t) => [t, file.data[t].length] as const) : [];
  const canRestore = Boolean(file && preview && preview.mode === mode && (mode === 'merge' || phrase === CONFIRM_PHRASE));

  return (
    <div className="space-y-4">
      <PageHeader title="Restore from backup">
        <Btn onClick={() => void run('export', async () => downloadJson(`tranquil-rest-export-${stamp()}.json`, await repo.exportAll()))} disabled={busy !== null}>
          <Download className="size-4" /> Download current data
        </Btn>
      </PageHeader>

      <Card title="1 · Choose a backup file">
        <p className="mb-3 text-sm text-slate-600">
          Download a nightly <code>tranquil-rest-backup-….json</code> file from the{' '}
          <a href={BACKUP_FOLDER_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-teal-800 underline">
            Drive backup folder <ExternalLink className="size-3" />
          </a>{' '}
          (one subfolder per month), then choose it here.
        </p>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-4 hover:border-teal-700">
          <FileUp className="size-5 text-teal-700" />
          <span className="text-sm font-medium">{file ? file.name : 'Choose backup file (.json)'}</span>
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        {file && (
          <div className="mt-3 text-sm">
            <p className="font-semibold">Backup taken {fmtDateTime(file.data.exported_at)} (Sri Lanka time)</p>
            <p className="mt-1 text-slate-600">{counts.map(([t, n]) => `${TABLE_LABEL[t]}: ${n}`).join(' · ')}</p>
          </div>
        )}
      </Card>

      {file && (
        <Card title="2 · What should happen?">
          <div className="grid gap-3 md:grid-cols-2">
            <ModeOption selected={mode === 'merge'} onSelect={() => { setMode('merge'); reset(); }} title="Put back missing records (recommended)"
              text="Adds bookings, payments, expenses, etc. that are in the backup but missing now. Nothing that exists today is changed or deleted. A booking whose time slot has since been taken is skipped." />
            <ModeOption selected={mode === 'replace'} onSelect={() => { setMode('replace'); reset(); }} danger title="Replace everything with the backup"
              text="Deletes all current bookings, payments, expenses, rooms, prices and history, and loads the backup exactly. Anything entered after the backup was taken is lost. A copy of the current data is downloaded first." />
          </div>
          <div className="mt-3">
            <Btn tone="primary" onClick={() => void doPreview()} disabled={busy !== null}>
              <Eye className="size-4" /> {busy === 'preview' ? 'Checking…' : 'Preview (changes nothing)'}
            </Btn>
          </div>
        </Card>
      )}

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}

      {preview && file && (
        <Card title="3 · Check and confirm">
          <ReportTable report={preview} />
          {mode === 'replace' && (
            <div className="mt-4 rounded-xl border-2 border-red-300 bg-red-50 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
                <AlertTriangle className="size-4" /> Type <code className="rounded bg-white px-1">{CONFIRM_PHRASE}</code> to confirm
              </p>
              <input className={cx(inputCls, 'mt-2')} value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={CONFIRM_PHRASE} autoComplete="off" />
            </div>
          )}
          <div className="mt-4">
            <Btn tone={mode === 'replace' ? 'danger' : 'primary'} onClick={() => void doRestore()} disabled={!canRestore || busy !== null}>
              <RotateCcw className="size-4" /> {busy === 'restore' ? 'Restoring…' : mode === 'replace' ? 'Replace all data now' : 'Restore missing records now'}
            </Btn>
          </div>
        </Card>
      )}

      {result && (
        <Card>
          <p className="mb-3 flex items-center gap-2 font-semibold text-green-800">
            <CheckCircle2 className="size-5" /> Restore complete. It is recorded in the audit log.
          </p>
          <ReportTable report={result} />
        </Card>
      )}
    </div>
  );
};

const ModeOption = ({ selected, onSelect, title, text, danger }: { selected: boolean; onSelect: () => void; title: string; text: string; danger?: boolean }) => (
  <button type="button" onClick={onSelect} aria-pressed={selected}
    className={cx('rounded-xl border-2 p-3 text-left',
      selected ? (danger ? 'border-red-600 bg-red-50' : 'border-teal-700 bg-teal-50') : 'border-slate-200 bg-white hover:border-slate-300')}>
    <span className={cx('block font-semibold', danger && 'text-red-800')}>{title}</span>
    <span className="mt-1 block text-sm text-slate-600">{text}</span>
  </button>
);

const ReportTable = ({ report }: { report: RestoreReport }) => (
  <div className="text-sm">
    <table className="w-full">
      <thead className="text-left text-xs text-slate-500 uppercase">
        <tr><th className="py-1 font-medium">Records</th><th className="py-1 text-right font-medium">{report.dry_run ? 'Will be restored' : 'Restored'}</th><th className="py-1 text-right font-medium">{report.mode === 'merge' ? 'Already present / skipped' : 'Skipped'}</th></tr>
      </thead>
      <tbody>
        {Object.entries(report.tables).map(([t, v]) => (
          <tr key={t} className="border-t border-slate-100">
            <td className="py-1.5">{TABLE_LABEL[t] ?? t}</td>
            <td className={cx('tabular py-1.5 text-right', v.restored > 0 && 'font-semibold text-teal-800')}>{v.restored}</td>
            <td className="tabular py-1.5 text-right text-slate-500">{v.skipped}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {report.missing_users.length > 0 && (
      <p className="mt-3 rounded-xl bg-amber-50 p-3 text-amber-900">
        These staff accounts are in the backup but don&apos;t exist in this project, so their name is removed from the records they created:{' '}
        <b>{report.missing_users.map((u) => u.display_name).join(', ')}</b>. Create them in Supabase → Authentication to keep names on future records.
      </p>
    )}
  </div>
);
