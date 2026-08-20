# Catalog Application Foundation (Phase 4.3)

Date: 2026-08-20
Status: implemented

Application-side design for the catalog domain. Schema documentation
lives in `database.md`; the API contract in `../api/catalog.md`.

## Database access

- **Driver**: `postgres` (postgres.js). No ORM — migrations remain
  the schema source of truth, and tagged-template queries are always
  parameterized.
- **Server-only**: `src/lib/server/db/client.ts` imports
  `server-only`, so any client-component import fails the build.
  `DATABASE_URL` stays inside the server env module and is never
  logged.
- **Lazy**: the pool is created on first query. Build, lint,
  typecheck, and static rendering never require or open a database
  connection; invoking DB-dependent code without `DATABASE_URL`
  raises a clear server-side configuration error.
- **Production strategy**: connect through the Supabase pooler
  (Supavisor transaction mode) — the client runs `prepare: false`
  and a small per-instance pool (`max: 5`) for serverless
  compatibility. The direct connection string remains for migrations
  only.

## Layering

```
route.ts            request-ID, Zod query validation, envelope
  └─ services/catalog.ts     code→identity resolution, active/relationship
                             rules, DTO mapping, typed ApiErrors
       └─ repositories/catalog.ts   parameterized SQL only
            └─ lib/server/db/client.ts
```

- `createApiHandler` (`src/lib/api/handler.ts`) supplies request-ID
  resolution and safe error envelopes to every route; `parseQuery`
  turns Zod failures into `VALIDATION_ERROR` with parameter-level
  details only.
- Ordering is fixed in SQL (`sort_order`, then name); no client
  input ever reaches ORDER BY, table, or column positions.
- Catalog routes are `force-dynamic`: results always reflect current
  catalog state. No HTTP caching yet — correctness first;
  revalidation caching can be added later with documented
  invalidation.

## Development vs production catalog data

Three strictly separated tiers:

1. **Migration seed** (immutable, all environments): categories,
   reference groups/options, roles, system settings.
2. **Development sample** (`supabase/seed/dev_catalog.sql`):
   clearly-labeled, idempotent, small brand/model/city/feature sample
   for local development. Never applied by migrations, never
   production data.
3. **Production catalog data**: imported from product-owner-verified
   sources via `pnpm catalog:import` (`scripts/catalog/import.mts`,
   format in `data/catalog/README.md`) — Zod-validated, transactional,
   idempotent by stable slug/code, dry-run supported, activation
   instead of deletion.

### Production data still required (not created by engineering)

- full vehicle brand list (cars + motorcycles)
- complete car model catalog
- complete motorcycle model catalog
- official Azerbaijan city/location list
- final feature catalog
- Azerbaijani label review for the seeded reference options

## Testing

- `pnpm test:integration:db` — real-PostgreSQL integration tests
  (route handlers called end-to-end) on the shared ephemeral harness
  `scripts/db/with-temp-postgres.sh`, which applies all migrations
  from scratch and exports `DATABASE_URL`. `pnpm db:validate` uses
  the same harness for the schema constraint tests.
- CI runs both as required checks: the workflow puts the runner's
  preinstalled PostgreSQL binaries on PATH and executes the exact
  same `pnpm db:validate` and `pnpm test:integration:db` commands
  against a throwaway 127.0.0.1-only instance — no service
  containers, no shared databases, no credentials, and no divergence
  between local and CI execution.
- Native Supabase CLI validation (`supabase db reset`) is still
  pending Docker availability — tracked in `supabase/README.md`.
