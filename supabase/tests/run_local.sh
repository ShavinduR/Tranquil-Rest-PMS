#!/usr/bin/env bash
# Spins up a throwaway Postgres 16, applies the migration + seed, runs tests.sql.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | tail -1)}"
DATA="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
SUDO=""
if [ "$(id -u)" = "0" ]; then chown -R postgres "$DATA"; SUDO="runuser -u postgres --"; fi
$SUDO "$PGBIN/initdb" -D "$DATA" -A trust -U postgres >/dev/null
$SUDO "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/log" start >/dev/null
trap '$SUDO "$PGBIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null; rm -rf "$DATA"' EXIT
PSQL="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database pms"
$PSQL -d pms -f "$HERE/auth_stub.sql"
for f in "$ROOT"/migrations/*.sql; do $PSQL -d pms -f "$f"; done
$PSQL -d pms -f "$ROOT/seed.sql"
$PSQL -d pms -o /dev/null -f "$HERE/tests.sql"
$PSQL -d pms -o /dev/null -f "$HERE/tests_restore.sql"
echo "ALL SQL TESTS PASSED"
if [ -n "${DUMP_EXPORT:-}" ]; then
  $PSQL -d pms -At > "$DUMP_EXPORT" <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false) \g /dev/null
select public.rotate_backup_key() as k \gset
reset role;
set role anon;
select public.export_backup(:'k');
SQL
  echo "export written to $DUMP_EXPORT"
fi
if [ -n "${AFTER_HOOK:-}" ]; then
  PG_PSQL="$PSQL -d pms" bash -c "$AFTER_HOOK"
fi
