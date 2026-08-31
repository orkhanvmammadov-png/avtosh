#!/usr/bin/env bash
set -euo pipefail

# Runs a command against a throwaway PostgreSQL instance with all
# AVTOSH.AZ migrations applied from scratch.
#
#   scripts/db/with-temp-postgres.sh <command> [args...]
#
# The command runs with DATABASE_URL exported, pointing at the
# ephemeral database (127.0.0.1 only). The instance and its data are
# destroyed afterwards. Never touches a shared, default-local, or
# production database. Requires PostgreSQL server binaries on PATH
# (initdb, pg_ctl, psql) — e.g. `brew install postgresql@16`.
# No Docker required.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKDIR="$(mktemp -d)"
DATADIR="$WORKDIR/pgdata"
# Unix sockets are limited to 103 bytes on macOS, so the socket dir
# must live at a short path even when TMPDIR is long.
SOCKDIR="$(mktemp -d /tmp/avtoshpg.XXXXXX)"
# Pick a free TCP port so back-to-back/parallel runs cannot collide
# (TEMP_PG_PORT still pins one explicitly).
pick_free_port() {
  local p
  for p in $(seq 54329 54399); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
      echo "$p"; return 0
    fi
    exec 3>&- 2>/dev/null || true
  done
  echo "54329"
}
PORT="${TEMP_PG_PORT:-$(pick_free_port)}"
DB=avtosh_temp
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

initdb -D "$DATADIR" -U "$PGUSER" -E UTF8 --no-locale >/dev/null 2>&1 \
  || { echo "[temp-postgres] initdb failed" >&2; exit 1; }
pg_ctl -D "$DATADIR" \
  -o "-p $PORT -k $SOCKDIR -c listen_addresses=127.0.0.1" \
  -l "$WORKDIR/pg.log" start >/dev/null \
  || { echo "[temp-postgres] server failed to start:" >&2; cat "$WORKDIR/pg.log" >&2; exit 1; }

psql -h "$SOCKDIR" -p "$PORT" -d postgres -qc "create database $DB"

echo "[temp-postgres] applying migrations..." >&2
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql -h "$SOCKDIR" -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" \
    || { echo "[temp-postgres] migration failed: $(basename "$f")" >&2; exit 1; }
done

export DATABASE_URL="postgres://$PGUSER@127.0.0.1:$PORT/$DB"
# Marker consumed by UAT tooling to prove it runs against THIS
# ephemeral instance (scripts/uat/seed.mjs refuses without it).
export TEMP_PG_EPHEMERAL=1

"$@"
