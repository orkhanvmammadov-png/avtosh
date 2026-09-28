#!/usr/bin/env bash
set -euo pipefail

# Tracked, fail-fast migration runner for staging/production-shaped
# databases.
#
#   MIGRATION_DATABASE_URL=postgres://... scripts/db/apply-migrations.sh [migrations-dir]
#
# - Keeps a `schema_migrations(filename, applied_at)` history table
#   and SKIPS files already recorded there, so non-idempotent files
#   are never blindly re-run.
# - Applies each pending file inside ONE transaction together with
#   its history INSERT (psql --single-transaction with two -f/-c
#   steps), so a file is either fully applied AND recorded, or
#   neither.
# - Exits NONZERO on the first failure and names the failed file.
#   Later files are not attempted.
# - Never prints the connection string.
#
# Recovering a failed run on a FRESH staging database:
#   1. The failed file was rolled back (single transaction): the
#      database holds exactly the files listed in schema_migrations —
#      inspect with:
#        psql "$MIGRATION_DATABASE_URL" -c 'select * from schema_migrations order by filename'
#   2. Fix the failing migration by shipping a corrected migration
#      through review — never edit a file that any shared environment
#      has already recorded in schema_migrations.
#   3. On a fresh staging database it is also acceptable to drop and
#      recreate the database and re-run this script from zero.

DIR="${1:-supabase/migrations}"
# Variable precedence is deliberate and migration-specific:
# MIGRATION_DATABASE_URL always wins when set. Prefixing a run with
# DATABASE_URL=... does NOT override an already-defined
# MIGRATION_DATABASE_URL (e.g. one loaded from an env file) — to
# redirect a run, set MIGRATION_DATABASE_URL itself. The selected
# source is announced below so a wrong target is visible immediately;
# the URL value is never printed.
if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
  URL="$MIGRATION_DATABASE_URL"
  echo "connecting via: MIGRATION_DATABASE_URL"
elif [ -n "${DATABASE_URL:-}" ]; then
  URL="$DATABASE_URL"
  echo "connecting via: DATABASE_URL (fallback; MIGRATION_DATABASE_URL not set)"
else
  echo "MIGRATION_DATABASE_URL (or DATABASE_URL) is not set." >&2
  exit 1
fi
if [ ! -d "$DIR" ]; then
  echo "Migrations directory not found: $DIR" >&2
  exit 1
fi

psql "$URL" -v ON_ERROR_STOP=1 -q -c \
  "create table if not exists schema_migrations (
     filename text primary key,
     applied_at timestamptz not null default now()
   )"

applied=0
skipped=0
for f in "$DIR"/*.sql; do
  name="$(basename "$f")"
  already="$(psql "$URL" -v ON_ERROR_STOP=1 -qtA -c \
    "select 1 from schema_migrations where filename = '$name'")"
  if [ "$already" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  if ! psql "$URL" -v ON_ERROR_STOP=1 -q --single-transaction \
      -f "$f" \
      -c "insert into schema_migrations (filename) values ('$name')"; then
    echo "" >&2
    echo "MIGRATION FAILED: $name" >&2
    echo "The file was rolled back and NOT recorded; nothing after it ran." >&2
    echo "Inspect state: psql \"\$MIGRATION_DATABASE_URL\" -c 'select * from schema_migrations order by filename'" >&2
    exit 1
  fi
  echo "applied: $name"
  applied=$((applied + 1))
done

echo "migrations complete: $applied applied, $skipped already recorded."
