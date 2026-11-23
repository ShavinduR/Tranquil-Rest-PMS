# Nightly backups → Google Sheets + Google Drive

| What | Where |
|---|---|
| Readable copy (Bookings, Payments, Food & Drinks, Expenses, Monthly, Settings, Audit tabs) | [Backup sheet](https://docs.google.com/spreadsheets/d/1It4FV6SPDzEBHr4Tb-_5XZ-Pu2I7FvDdx8YtZ6B9jTY/edit) |
| Complete JSON snapshot, one file per night, in a subfolder per month | [Drive folder "Tranquil Rest PMS"](https://drive.google.com/drive/folders/10Iczo9m-yxF-JSbMkItAyUuvGQS5I9eM) |

## How it works

```
Google Apps Script (in the backup sheet, runs as the owner's Google account, ~2 AM Asia/Colombo)
   │  POST /rest/v1/rpc/export_backup   { p_key: <backup key> }   (anon API key)
   ▼
Supabase: export_backup() checks the SHA-256 of the key, returns every table as JSON (no PIN hashes)
   │
   ├─► Drive:  Tranquil Rest PMS/2026-11/tranquil-rest-backup-2026-11-24_0200.json
   └─► Sheet:  tabs rewritten in one batch each; "Backup Log" gets a new row (OK / FAILED)
```

- **Read-only key.** The script never holds the Supabase `service_role` key. The backup key can only call
  `export_backup()`. Admins create or replace it in *Admin → Settings → Google backups*. Only its hash is
  stored, in a `private` schema that clients can't read.
- **Retention.** Daily JSON files are kept for 60 days. The first file of every month is kept forever.
- **Failures.** A failed run writes a red FAILED row to *Backup Log* and e-mails the Google account that installed the script.
  The Settings card turns red if the last successful backup is more than 36 hours old.
- **No Google keys or service accounts.** Apps Script uses the owner's own Google account.

## Setup

Follow the *Setup (read me)* tab in the backup sheet. In short:

1. Sheet → *Extensions → Apps Script* → paste `Code.gs`, and replace `appsscript.json` (Project Settings → show manifest).
2. Reload the sheet → menu **Tranquil Rest → Set Supabase connection…** → enter the project URL, anon key and backup key.
3. **Back up now** (approve Google's permission prompt) → **Install nightly backup**.

## Restoring

Two modes. Both run in **one database transaction** (all or nothing), and both can be **previewed first** without changing anything.

| Mode | What it does | When to use it |
|---|---|---|
| **Merge** (default) | Puts back rows from the backup that are missing now. Never changes or deletes current data. A booking whose time slot has since been taken by a newer booking is skipped and reported. | Something was deleted by mistake (a payment, an expense, a booking). |
| **Replace** | Deletes all business data and loads the backup exactly: bookings, payments, food, expenses, rooms, prices, presets, settings and audit history. Anything entered after the backup was taken is lost. Needs the typed phrase `REPLACE ALL DATA`, and a copy of the current data is saved first. | The database is damaged, or you are moving to a new Supabase project. |

Restored rows keep their original IDs, timestamps and authors. Each restore adds one `restore_merge` / `restore_replace` entry to the audit log.
If the backup mentions a staff account that doesn't exist in the target project (e.g. a fresh project), that person's name
is removed from their records and the report lists them. Create those users first if you want to keep the names.

### From the app (normal case)
1. Download the backup `.json` from the Drive folder (subfolder per month).
2. *Admin → Restore* → choose the file → pick **Merge** or **Replace** → **Preview** → confirm.

### From the command line (app is down, or moving to a new project)
Needs Node 18+ and the project's **service_role** key (Supabase → Project Settings → API). Keep that key secret: use it only on your own computer and never commit it.

```bash
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... npm run restore -- backup.json                    # preview only
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... npm run restore -- backup.json --apply            # merge
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... npm run restore -- backup.json --mode replace --apply
```

**Moving to a brand-new project:** run all migrations, then create the owner user (and caretakers) and make the owner an admin. Seeding is not needed; Replace loads rooms and prices from the backup. Then run a **replace** restore.

## Testing

`DUMP_EXPORT=/tmp/export.json npm run test:sql` produces a real export from a throwaway Postgres.
The SQL tests cover: only admins can create keys, a wrong key is rejected, PIN hashes are never exported, the key table can't be read, and for restore: caretakers are refused, dry runs change nothing, merge restores only missing rows and skips clashing bookings, replace needs the phrase and reproduces the snapshot, triggers work again afterwards, and unknown users are nulled and reported.
