#!/usr/bin/env node
/**
 * Restore a Tranquil Rest backup file from the command line (no app needed).
 * Use it when the app is down, or to move everything into a new Supabase project.
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/restore-backup.mjs <backup.json> [--mode merge|replace] [--apply]
 *
 * Without --apply it only previews (dry run). Replace asks you to type REPLACE ALL DATA,
 * and first saves a copy of the current data next to the backup file.
 * The service_role key is secret: run this on your own computer, never commit the key.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const CONFIRM = 'REPLACE ALL DATA';
const TABLES = ['rooms', 'pricing_rules', 'addon_presets', 'expenses', 'bookings', 'payments', 'booking_addons', 'audit_logs'];

const usage = (msg) => {
  if (msg) console.error(`\n✖ ${msg}\n`);
  console.error('Usage: node scripts/restore-backup.mjs <backup.json> [--mode merge|replace] [--apply]');
  process.exit(1);
};

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const modeIdx = args.indexOf('--mode');
const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'merge';
const apply = args.includes('--apply');
if (!file) usage();
if (!['merge', 'replace'].includes(mode)) usage('--mode must be merge or replace');

const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) usage('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');

let backup;
try {
  backup = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  usage(`Cannot read ${file}: ${e.message}`);
}
if (backup.format !== 'tranquil-rest-backup/1') usage('Not a Tranquil Rest backup file');
for (const t of TABLES) if (!Array.isArray(backup[t])) usage(`Backup file is incomplete (missing ${t})`);

const rpc = async (fn, body) => {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message ?? text; } catch { /* plain text */ }
    throw new Error(`${fn} failed (${res.status}): ${msg}`);
  }
  return JSON.parse(text);
};

const printReport = (r) => {
  console.log(`\n${r.dry_run ? 'PREVIEW (nothing changed)' : 'RESTORED'} — mode: ${r.mode}, backup taken ${r.backup_exported_at}`);
  console.table(Object.fromEntries(Object.entries(r.tables).map(([t, v]) => [t, { [r.dry_run ? 'will restore' : 'restored']: v.restored, skipped: v.skipped }])));
  if (r.missing_users.length) {
    console.log('⚠ Staff in the backup but not in this project (their name is removed from their records):');
    for (const u of r.missing_users) console.log(`   - ${u.display_name} (${u.role}) ${u.id}`);
  }
};

const main = async () => {
  console.log(`Backup: ${basename(file)} · taken ${backup.exported_at}`);
  console.log(TABLES.map((t) => `${t}: ${backup[t].length}`).join(' · '));

  const preview = await rpc('restore_backup', { p_backup: backup, p_mode: mode, p_dry_run: true });
  printReport(preview);
  if (!apply) {
    console.log('\nThis was a preview. Add --apply to restore for real.');
    return;
  }

  let confirm = null;
  if (mode === 'replace') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    confirm = (await rl.question(`\nThis DELETES all current data in ${url}.\nType ${CONFIRM} to continue: `)).trim();
    rl.close();
    if (confirm !== CONFIRM) {
      console.log('Cancelled.');
      return;
    }
    const safety = join(dirname(file), `tranquil-rest-before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(safety, JSON.stringify(await rpc('export_backup_admin', {})));
    console.log(`Saved a copy of the current data to ${safety}`);
  }

  printReport(await rpc('restore_backup', { p_backup: backup, p_mode: mode, p_dry_run: false, p_confirm: confirm }));
  console.log('\nDone. The restore is recorded in the audit log.');
};

main().catch((e) => {
  console.error(`\n✖ ${e.message}`);
  process.exit(1);
});
