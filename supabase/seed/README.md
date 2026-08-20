# Seed Data

Development/test seed SQL lives here.
Never place production or personal data in seed files.

- `dev_catalog.sql` — DEVELOPMENT-ONLY catalog sample (brands,
  models, cities, features). Idempotent; apply manually with
  `psql "$DATABASE_URL" -f supabase/seed/dev_catalog.sql`. This is
  NOT the official catalog — production data is imported via
  `pnpm catalog:import` (see `data/catalog/README.md`).

Stable system/reference data (roles, categories, reference options,
system settings) is seeded by the immutable `..._initial_seed.sql`
migration, not from this directory.
