# Supabase — Database Structure

This directory holds everything database-related for AVTOSH.AZ
(Supabase PostgreSQL).

- `migrations/` — versioned SQL schema migrations
- `seed/` — development/test seed data (never production data)

No business schema exists yet; the schema arrives in
Phase 4.2 — Database Schema & Migrations.

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

## Local setup

The Supabase CLI is not yet part of this repository's tooling
(it was not available when the foundation was created). When local
Supabase development starts (Phase 4.2), initialize it with
`supabase init` and commit the generated `supabase/config.toml`.
