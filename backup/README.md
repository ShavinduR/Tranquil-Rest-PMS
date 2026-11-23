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

Each JSON file contains every row of every table (`bookings`, `payments`, `booking_addons`, `expenses`, `rooms`,
`pricing_rules`, `settings`, `addon_presets`, `profiles`, `audit_logs`), exactly as stored in Postgres.
Insert the rows back in that dependency order: rooms → bookings → payments/add-ons. `booking_addons.amount` is a
generated column, so leave it out on insert. Auth users must already exist with the same IDs.

## Testing

`DUMP_EXPORT=/tmp/export.json npm run test:sql` produces a real export from a throwaway Postgres.
The SQL tests cover: only admins can create keys, a wrong key is rejected, PIN hashes are never exported, and the key table can't be read.
