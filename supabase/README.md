# Supabase — Database Structure

This directory holds everything database-related for AVTOSH.AZ
(Supabase PostgreSQL).

- `migrations/` — versioned SQL schema migrations (the executable
  source of truth for the schema; see `docs/architecture/database.md`
  for the design documentation)
- `seed/` — development/test seed data (never production data).
  Stable system/reference seed data lives in the
  `..._initial_seed.sql` migration instead, so every environment gets
  it deterministically.

The Phase 4.2 schema covers identity, catalog, marketplace,
moderation, payments, promotions, notifications, and governance.

## Validating migrations locally

```bash
pnpm db:validate
```

boots a throwaway local PostgreSQL instance (requires Homebrew/system
PostgreSQL binaries), applies every migration from scratch, runs the
negative constraint tests in `scripts/db/constraint-tests.sql`, and
tears everything down. It never touches a shared or production
database.

## Migration Rules (binding)

1. All schema changes are version controlled as migration files in
   `supabase/migrations/`.
2. A migration that has been applied to any shared environment is
   **immutable** — never edit it. Create a new migration instead.
3. Avoid destructive one-step migrations (e.g. dropping/renaming a
   column in the same release that stops writing it). Use multi-step
   expand → migrate → contract patterns.
4. The production database must never be changed manually as a normal
   workflow. Every change goes through a migration.
5. Migrations must be validated (locally / staging) before they reach
   production.
6. Use snake_case, UUID primary keys for major business entities,
   TIMESTAMPTZ for timestamps, and explicit FK/unique/check
   constraints and indexes (see CLAUDE.md → Database).

## Supabase CLI status

The Supabase CLI local stack requires Docker, which is not available
on the current development machine, so `supabase init`/`supabase db`
validation has not been run. Migrations follow the standard Supabase
`YYYYMMDDHHMMSS_name.sql` convention and are validated against plain
PostgreSQL 16 via `pnpm db:validate` instead. When Docker/CLI become
available, run `supabase init`, commit the generated `config.toml`,
and use `supabase db reset` as the canonical local workflow.
