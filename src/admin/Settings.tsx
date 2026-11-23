import { useEffect, useState } from 'react';
import { Save, Plus, KeyRound, CloudUpload, Copy, ExternalLink, UserPlus, RotateCcwKey, RefreshCw, X } from 'lucide-react';
import { repo, isDemo } from '../data';
import { useAppData } from '../data/AppData';
import type { AddonPreset, PricingRule, Profile, Room, RoomCategory } from '../types';
import { BOOKING_TYPES } from '../types';
import { Dialog, cx } from '../components/ui';
import { generatePassword } from '../lib/password';
import { Btn, Card, PageHeader, TYPE_EN, inputCls } from './common';

const CAT_EN: Record<RoomCategory, string> = { non_ac: 'Non-AC', ac: 'AC' };

export const SettingsPage = () => {
  const { reference, refresh } = useAppData();
  const [toast, setToast] = useState<string | null>(null);
  const done = async (msg = 'Saved') => {
    await refresh();
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };
  const guard = async (fn: () => Promise<void>, msg?: string) => {
    try {
      await fn();
      await done(msg);
    } catch (e) {
      setToast(e instanceof Error ? `Error: ${e.message}` : 'Error');
    }
  };
  if (!reference) return null;

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      {toast && <div className="fixed right-4 bottom-4 z-50 rounded-xl bg-slate-900 px-4 py-2 text-white shadow-lg">{toast}</div>}

      <GeneralSettings key={JSON.stringify(reference.settings)} settings={reference.settings} onSave={(p) => guard(() => repo.updateSettings(p))} />

      <Card title="Pricing (LKR)">
        <p className="mb-3 text-sm text-slate-500">Prices and default times per room category. Changes apply to new bookings only.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          {(['non_ac', 'ac'] as const).map((cat) => (
            <div key={cat}>
              <h3 className="mb-2 font-semibold">{CAT_EN[cat]}</h3>
              {BOOKING_TYPES.map((t) => {
                const rule = reference.pricing.find((r) => r.category === cat && r.booking_type === t);
                return rule ? <PricingRow key={rule.id + JSON.stringify(rule)} rule={rule} onSave={(p) => guard(() => repo.updatePricing(rule.id, p))} /> : null;
              })}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Rooms">
        <div className="space-y-4 divide-y divide-slate-100 sm:space-y-2 sm:divide-y-0 [&>*]:pt-3 sm:[&>*]:pt-0">
          {reference.rooms.map((r) => <RoomRow key={r.id + JSON.stringify(r)} room={r} onSave={(p) => guard(() => repo.updateRoom(r.id, p))} />)}
        </div>
      </Card>

      <Card title="Food & beverage presets">
        <div className="space-y-2">
          {reference.presets.map((p) => <PresetRow key={p.id + JSON.stringify(p)} preset={p} onSave={(x) => guard(() => repo.upsertPreset(x))} />)}
          <PresetRow
            key={`new-${reference.presets.length}`}
            preset={{ id: '', label_si: '', label_en: '', price: 0, sort_order: reference.presets.length + 1, active: true }}
            onSave={({ id: _id, ...rest }) => guard(() => repo.upsertPreset(rest), 'Preset added')}
          />
        </div>
      </Card>

      <StaffCard onToast={setToast} />
      <BackupCard onToast={setToast} />
    </div>
  );
};

const GeneralSettings = ({ settings, onSave }: { settings: { property_name: string; property_phone: string | null; cleaning_buffer_minutes: number }; onSave: (p: typeof settings) => Promise<void> }) => {
  const [f, setF] = useState({ ...settings, property_phone: settings.property_phone ?? '' });
  return (
    <Card title="General">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm md:col-span-2">Property name<input className={inputCls} value={f.property_name} onChange={(e) => setF({ ...f, property_name: e.target.value })} /></label>
        <label className="text-sm">Contact phone (WhatsApp footer)<input className={inputCls} value={f.property_phone} onChange={(e) => setF({ ...f, property_phone: e.target.value })} /></label>
        <label className="text-sm">Cleaning buffer (minutes)<input className={inputCls} type="number" min={0} max={240} value={f.cleaning_buffer_minutes} onChange={(e) => setF({ ...f, cleaning_buffer_minutes: Number(e.target.value) })} /></label>
      </div>
      <div className="mt-3"><Btn tone="primary" onClick={() => void onSave({ ...f, property_phone: f.property_phone.trim() || null })}><Save className="size-4" /> Save</Btn></div>
    </Card>
  );
};

const PricingRow = ({ rule, onSave }: { rule: PricingRule; onSave: (p: Partial<PricingRule>) => Promise<void> }) => {
  const windowed = Boolean(rule.default_start_time && rule.default_end_time);
  const [price, setPrice] = useState(String(rule.price));
  const [start, setStart] = useState(rule.default_start_time?.slice(0, 5) ?? '');
  const [end, setEnd] = useState(rule.default_end_time?.slice(0, 5) ?? '');
  const [hours, setHours] = useState(String((rule.duration_minutes ?? 0) / 60));
  const dirty = price !== String(rule.price) || (windowed ? start !== rule.default_start_time?.slice(0, 5) || end !== rule.default_end_time?.slice(0, 5) : hours !== String((rule.duration_minutes ?? 0) / 60));
  return (
    <div className="mb-3 grid grid-cols-[6rem_1fr_auto] items-center gap-2 text-sm sm:mb-2 sm:grid-cols-[7rem_1fr_1fr_auto]">
      <span className="font-medium">{TYPE_EN[rule.booking_type]}</span>
      <input aria-label="Price" className={inputCls} type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
      {windowed ? (
        <div className="col-span-3 row-start-2 flex items-center gap-1 sm:col-span-1 sm:row-start-auto">
          <input aria-label="Start" className={inputCls} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          <span>–</span>
          <input aria-label="End" className={inputCls} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      ) : (
        <div className="col-span-3 row-start-2 flex items-center gap-1 sm:col-span-1 sm:row-start-auto">
          <input aria-label="Hours" className={inputCls} type="number" min={0.5} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} /><span>hrs</span>
        </div>
      )}
      <Btn tone={dirty ? 'primary' : 'default'} disabled={!dirty}
        onClick={() => void onSave(windowed
          ? { price: Number(price), default_start_time: start, default_end_time: end }
          : { price: Number(price), duration_minutes: Math.round(Number(hours) * 60) })}>
        <Save className="size-4" />
      </Btn>
    </div>
  );
};

const RoomRow = ({ room, onSave }: { room: Room; onSave: (p: Partial<Room>) => Promise<void> }) => {
  const [f, setF] = useState({ name: room.name, name_si: room.name_si, category: room.category, active: room.active });
  const dirty = JSON.stringify(f) !== JSON.stringify({ name: room.name, name_si: room.name_si, category: room.category, active: room.active });
  return (
    <div className="grid grid-cols-1 items-center sm:grid-cols-2 gap-2 text-sm md:grid-cols-[1fr_1fr_10rem_6rem_auto]">
      <input aria-label="Name (English)" className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input aria-label="Name (Sinhala)" className={cx(inputCls, 'si')} value={f.name_si} onChange={(e) => setF({ ...f, name_si: e.target.value })} />
      <select aria-label="Category" className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as RoomCategory })}>
        <option value="non_ac">Non-AC</option><option value="ac">AC</option>
      </select>
      <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
      <Btn tone={dirty ? 'primary' : 'default'} disabled={!dirty} onClick={() => void onSave(f)}><Save className="size-4" /></Btn>
    </div>
  );
};

const PresetRow = ({ preset, onSave }: { preset: AddonPreset; onSave: (p: AddonPreset) => Promise<void> }) => {
  const [f, setF] = useState(preset);
  const isNew = !preset.id;
  const dirty = JSON.stringify(f) !== JSON.stringify(preset);
  return (
    <div className={cx('grid grid-cols-1 items-center sm:grid-cols-2 gap-2 text-sm md:grid-cols-[1fr_1fr_8rem_6rem_auto]', isNew && 'border-t border-dashed border-slate-300 pt-3')}>
      <input aria-label="Sinhala label" placeholder="සිංහල නම" className={cx(inputCls, 'si')} value={f.label_si} onChange={(e) => setF({ ...f, label_si: e.target.value })} />
      <input aria-label="English label" placeholder="English name" className={inputCls} value={f.label_en} onChange={(e) => setF({ ...f, label_en: e.target.value })} />
      <input aria-label="Price" type="number" min={0} className={inputCls} value={f.price} onChange={(e) => setF({ ...f, price: Number(e.target.value) })} />
      {isNew ? <span /> : <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
      <Btn tone={dirty ? 'primary' : 'default'} disabled={!dirty || !f.label_si.trim()} onClick={() => void onSave(f)}>
        {isNew ? <Plus className="size-4" /> : <Save className="size-4" />}
      </Btn>
    </div>
  );
};

const StaffCard = ({ onToast }: { onToast: (m: string) => void }) => {
  const [staff, setStaff] = useState<Profile[]>([]);
  const [pins, setPins] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<Profile | null>(null);
  const load = () => void repo.listStaff().then(setStaff).catch(() => undefined);
  useEffect(load, []);

  const setPin = async (id: string) => {
    const pin = pins[id] ?? '';
    if (!/^\d{4}$/.test(pin)) {
      onToast('PIN must be exactly 4 digits');
      return;
    }
    try {
      await repo.setStaffPin(id, pin);
      setPins({ ...pins, [id]: '' });
      onToast('PIN updated');
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Could not set PIN');
    }
  };

  return (
    <Card title="Staff & PINs" action={<Btn tone="primary" onClick={() => setAdding(true)}><UserPlus className="size-4" /> Add staff member</Btn>}>
      <p className="mb-3 text-sm text-slate-500">
        Untick <b>Active</b> to lock someone out: their phone signs out within about 2 minutes and cannot load any data. Their past records are kept.
        {isDemo && ' (Demo: PIN is always 1234.)'}
      </p>
      <div className="space-y-4 divide-y divide-slate-100 sm:space-y-2 sm:divide-y-0 [&>*]:pt-3 sm:[&>*]:pt-0">
        {staff.map((s) => (
          <div key={s.id} className={cx('grid grid-cols-1 items-center sm:grid-cols-2 gap-2 text-sm md:grid-cols-[1fr_9rem_6rem_10rem_auto]', !s.active && 'opacity-60')}>
            <input aria-label="Display name" className={inputCls} defaultValue={s.display_name}
              onBlur={(e) => e.target.value !== s.display_name && void repo.updateStaff(s.id, { display_name: e.target.value }).then(load)} />
            <select aria-label="Role" className={inputCls} value={s.role} onChange={(e) => void repo.updateStaff(s.id, { role: e.target.value as Profile['role'] }).then(load)}>
              <option value="caretaker">Caretaker</option><option value="admin">Admin</option>
            </select>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.active} onChange={(e) => void repo.updateStaff(s.id, { active: e.target.checked }).then(load)} /> Active
            </label>
            {s.role === 'caretaker' ? (
              <div className="flex gap-1">
                <input aria-label="New PIN" inputMode="numeric" maxLength={4} placeholder="New PIN" className={inputCls}
                  value={pins[s.id] ?? ''} onChange={(e) => setPins({ ...pins, [s.id]: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
                <Btn onClick={() => void setPin(s.id)}><KeyRound className="size-4" /></Btn>
              </div>
            ) : <span />}
            <Btn onClick={() => setResetting(s)}><RotateCcwKey className="size-4" /> Reset password</Btn>
          </div>
        ))}
      </div>
      {adding && <AddStaffDialog onClose={() => setAdding(false)} onCreated={load} />}
      {resetting && <ResetPasswordDialog person={resetting} onClose={() => setResetting(null)} />}
    </Card>
  );
};

/** Shown once after creating a login or resetting a password. */
const Credentials = ({ name, email, password, isCaretaker }: { name: string; email?: string; password: string; isCaretaker: boolean }) => {
  const text = `Tranquil Rest sign-in for ${name}${email ? `\nEmail: ${email}` : ''}\nPassword: ${password}`;
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="mb-2 font-semibold">Write these down or copy them now. The password is shown only once.</p>
      <dl className="grid grid-cols-[5rem_1fr] gap-y-1">
        {email && (<><dt className="text-slate-500">Email</dt><dd className="font-mono break-all">{email}</dd></>)}
        <dt className="text-slate-500">Password</dt><dd className="font-mono text-base font-semibold">{password}</dd>
      </dl>
      <div className="mt-3"><Btn onClick={() => void navigator.clipboard.writeText(text)}><Copy className="size-4" /> Copy</Btn></div>
      {isCaretaker && (
        <p className="mt-3 text-slate-700">
          <b>Next:</b> on {name}&apos;s phone open the app → <i>Caretaker device</i> → sign in with these details once.
          After that they only use their 4-digit PIN.
        </p>
      )}
    </div>
  );
};

const AddStaffDialog = ({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState<Profile['role']>('caretaker');
  const [pin, setPin] = useState('');
  const [ownEmail, setOwnEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string } | null>(null);

  const valid = name.trim().length > 0 && password.length >= 8 && (role === 'admin' || /^\d{4}$/.test(pin)) && (!ownEmail || /\S+@\S+\.\S+/.test(email));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await repo.createStaff({
        display_name: name.trim(), role, password,
        email: ownEmail ? email.trim() : null,
        pin: role === 'caretaker' ? pin : null,
      });
      setDone({ email: r.email });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} labelledBy="add-staff-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="add-staff-title" className="text-xl font-bold">{done ? 'Staff member added' : 'Add staff member'}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-slate-100"><X className="size-5" /></button>
      </div>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm"><b>{name.trim()}</b> can now sign in as {role === 'admin' ? 'an admin' : 'a caretaker'}{role === 'caretaker' ? ` with PIN ${pin}` : ''}.</p>
          <Credentials name={name.trim()} email={done.email} password={password} isCaretaker={role === 'caretaker'} />
          <Btn tone="primary" onClick={onClose}>Done</Btn>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-3 text-sm">
          <label className="block">Name<input className={inputCls} value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} autoFocus placeholder="e.g. Sunil" /></label>
          <div>
            <span className="mb-1 block">Role</span>
            <div className="flex rounded-xl border border-slate-300 p-1">
              {(['caretaker', 'admin'] as const).map((r) => (
                <button key={r} type="button" onClick={() => setRole(r)}
                  className={cx('flex-1 rounded-lg py-2 font-semibold', role === r ? 'bg-teal-700 text-white' : 'text-slate-600')}>
                  {r === 'caretaker' ? 'Caretaker' : 'Admin (full access)'}
                </button>
              ))}
            </div>
          </div>
          {role === 'caretaker' && (
            <label className="block">4-digit PIN (used every day on the phone)
              <input className={inputCls} inputMode="numeric" maxLength={4} value={pin} placeholder="e.g. 4826"
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </label>
          )}
          <label className="block">Password (needed once, to sign a phone in)
            <div className="flex gap-1">
              <input className={cx(inputCls, 'font-mono')} value={password} onChange={(e) => setPassword(e.target.value)} />
              <Btn onClick={() => setPassword(generatePassword())}><RefreshCw className="size-4" /> New</Btn>
            </div>
            {password.length < 8 && <span className="text-xs text-red-700">At least 8 characters.</span>}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={ownEmail} onChange={(e) => setOwnEmail(e.target.checked)} />
            Use their own email address for the login
          </label>
          {ownEmail ? (
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" />
          ) : (
            <p className="text-xs text-slate-500">A login email is created from the name automatically (no email is sent). You&apos;ll see it after saving.</p>
          )}
          {error && <p role="alert" className="rounded-xl bg-red-50 p-2 text-red-800">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn type="submit" tone="primary" disabled={!valid || busy}><UserPlus className="size-4" /> {busy ? 'Creating…' : 'Create account'}</Btn>
          </div>
        </form>
      )}
    </Dialog>
  );
};

const ResetPasswordDialog = ({ person, onClose }: { person: Profile; onClose: () => void }) => {
  const [password] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await repo.resetStaffPassword(person.id, password);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset the password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} labelledBy="reset-title">
      <h2 id="reset-title" className="mb-2 text-xl font-bold">Reset password · {person.display_name}</h2>
      {done ? (
        <div className="space-y-3">
          <Credentials name={person.display_name} password={password} isCaretaker={person.role === 'caretaker'} />
          <Btn tone="primary" onClick={onClose}>Done</Btn>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p>A new password is created and the old one stops working. The PIN doesn&apos;t change. To force a phone out straight away, untick <b>Active</b> instead.</p>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-2 text-red-800">{error}</p>}
          <div className="flex justify-end gap-2">
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn tone="primary" onClick={() => void reset()} disabled={busy}><RotateCcwKey className="size-4" /> {busy ? 'Resetting…' : 'Create new password'}</Btn>
          </div>
        </div>
      )}
    </Dialog>
  );
};

const BACKUP_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1It4FV6SPDzEBHr4Tb-_5XZ-Pu2I7FvDdx8YtZ6B9jTY/edit';
const BACKUP_FOLDER_URL = 'https://drive.google.com/drive/folders/10Iczo9m-yxF-JSbMkItAyUuvGQS5I9eM';

/** Nightly backups run from a Google Apps Script in the backup sheet; this card issues its read-only key. */
const BackupCard = ({ onToast }: { onToast: (m: string) => void }) => {
  const [status, setStatus] = useState<{ created_at: string; last_used: string | null } | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const load = () => void repo.backupKeyStatus().then(setStatus).catch(() => undefined);
  useEffect(load, []);

  const rotate = async () => {
    if (status && !confirm('Create a new backup key? The old key stops working until you paste the new one into the backup sheet.')) return;
    try {
      setKey(await repo.rotateBackupKey());
      load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Could not create key');
    }
  };

  const stale = status?.last_used && Date.now() - new Date(status.last_used).getTime() > 36 * 3600_000;
  return (
    <Card title="Google backups">
      <p className="mb-3 text-sm text-slate-500">
        Every night the backup sheet copies all bookings, payments, expenses and the audit log, and saves a full JSON file into the Drive folder.
        The key below is read-only: it cannot change any data.
      </p>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <a className="inline-flex items-center gap-1 text-teal-800 underline" href={BACKUP_SHEET_URL} target="_blank" rel="noreferrer">Backup sheet <ExternalLink className="size-3" /></a>
        <a className="inline-flex items-center gap-1 text-teal-800 underline" href={BACKUP_FOLDER_URL} target="_blank" rel="noreferrer">Drive folder <ExternalLink className="size-3" /></a>
      </div>
      <p className={cx('mb-3 text-sm', stale ? 'font-semibold text-red-700' : 'text-slate-700')}>
        {!status ? 'No backup key yet.' : status.last_used
          ? `Last backup: ${new Date(status.last_used).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}${stale ? ' – more than a day ago, check the Backup Log tab.' : ''}`
          : 'Key created, but no backup has run yet.'}
      </p>
      {key && (
        <div className="mb-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="mb-1 font-semibold">Copy this key now — it is shown only once:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white px-2 py-1">{key}</code>
            <Btn onClick={() => void navigator.clipboard.writeText(key).then(() => onToast('Copied'))}><Copy className="size-4" /></Btn>
          </div>
          <p className="mt-1 text-slate-600">Paste it in the backup sheet: Tranquil Rest → Set Supabase connection…</p>
        </div>
      )}
      <Btn tone={status ? 'default' : 'primary'} onClick={() => void rotate()}><CloudUpload className="size-4" /> {status ? 'Replace backup key' : 'Create backup key'}</Btn>
    </Card>
  );
};
