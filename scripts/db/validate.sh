#!/usr/bin/env bash
set -euo pipefail

# Ephemeral PostgreSQL validation of the AVTOSH.AZ schema.
#
# Boots a throwaway PostgreSQL instance in a temp directory (unix
# socket only, no TCP listeners), applies every migration in
# supabase/migrations/ from scratch, then runs the negative constraint
# tests in scripts/db/constraint-tests.sql. Never touches any shared,
# local-default, or production database.
#
# Requires PostgreSQL server binaries on PATH (initdb, pg_ctl, psql) —
# e.g. `brew install postgresql@16`.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKDIR="$(mktemp -d)"
DATADIR="$WORKDIR/pgdata"
# Unix sockets are limited to 103 bytes on macOS, so the socket dir
# must live at a short path even when TMPDIR is long.
SOCKDIR="$(mktemp -d /tmp/avtoshpg.XXXXXX)"
PORT=54329
DB=avtosh_validation
export PGUSER=avtosh
# Avoid the macOS "postmaster became multithreaded during startup"
# failure caused by inherited locale environment variables.
export LC_ALL=C LANG=C

cleanup() {
  pg_ctl -D "$DATADIR" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$WORKDIR" "$SOCKDIR"
}
trap cleanup EXIT

command -v initdb >/dev/null || { echo "initdb not found — install PostgreSQL"; exit 1; }

initdb -D "$DATADIR" -U "$PGUSER" -E UTF8 --no-locale >/dev/null
pg_ctl -D "$DATADIR" -o "-p $PORT -k $SOCKDIR -c listen_addresses=''" \
  -l "$WORKDIR/pg.log" start >/dev/null

psql -h "$SOCKDIR" -p "$PORT" -d postgres -qc "create database $DB"

echo "Applying migrations from scratch..."
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  -> $(basename "$f")"
  psql -h "$SOCKDIR" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "Running constraint tests..."
psql -h "$SOCKDIR" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q \
  -f "$ROOT/scripts/db/constraint-tests.sql"

echo "OK: all migrations applied cleanly and all constraint tests passed."
