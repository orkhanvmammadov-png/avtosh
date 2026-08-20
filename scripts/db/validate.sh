#!/usr/bin/env bash
set -euo pipefail

# Applies every migration from scratch to an ephemeral PostgreSQL and
# runs the negative constraint tests. Wrapper around
# with-temp-postgres.sh — see that script for environment details.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

"$ROOT/scripts/db/with-temp-postgres.sh" sh -c '
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$0"
' "$ROOT/scripts/db/constraint-tests.sql"

echo "OK: all migrations applied cleanly and all constraint tests passed."
