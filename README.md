# AVTOSH.AZ

Azerbaijan-focused responsive **web** marketplace for cars and
motorcycles. Web only — no native iOS/Android applications.

**Current phase: Phase 4.12 — Kapital Bank Payment Integration.**
Implemented so far: the MVP database schema (Supabase migrations),
the public read-only Catalog API (`/api/v1/catalog/*`), passwordless
WhatsApp-OTP authentication with opaque cookie sessions
(`/api/v1/auth/*` — production WhatsApp delivery pending), and the
authenticated seller draft + image-upload foundation
(`/api/v1/me/listings/*` — real Supabase Storage smoke test pending),
and initial submission with lifetime first-3-free publication
accounting (FREE → moderation queue, PAID → internal payment intent),
and the moderation engine (`/api/v1/moderator/*`: queue, claims,
approve/reject/correction, first 30-day activation, seller
resubmission), and the anonymous public read model (`/api/v1/home`,
`/api/v1/listings` search with Boost placement, `/api/v1/listings/premium`,
`/api/v1/listings/:publicId`), and the public buyer web experience
(`/`, `/elanlar`, `/elan/:publicId`). Payment-provider fulfillment,
seller/auth/staff UIs, and the expiry/notification workers are not
implemented yet. `CLAUDE.md` is the authoritative
product/architecture instruction file; see `docs/architecture/`,
`docs/api/`, and `docs/runbooks/` for details.

## Technology stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Zod for validation (env today, API DTOs later)
- REST API under `/api/v1`
- Supabase PostgreSQL + Storage (structure prepared, no schema yet)
- GitHub Actions CI; Vercel + Cloudflare for infrastructure (later)
- PostHog/GA4 analytics and Sentry monitoring (later phases)

## Prerequisites

- **Node.js ≥ 24 (LTS)** — pinned in `.nvmrc` (`nvm use`)
- **pnpm 11** — the only supported package manager for this repo.
  Do not use npm or yarn; do not commit their lockfiles.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # optional in Phase 4.1 — all vars are optional
pnpm dev                     # http://localhost:3000
```

Health check: `GET http://localhost:3000/api/v1/health`

## Scripts

| Command         | Purpose                          |
| --------------- | -------------------------------- |
| `pnpm dev`      | Local development server         |
| `pnpm build`    | Production build                 |
| `pnpm start`    | Serve the production build       |
| `pnpm lint`     | ESLint                           |
| `pnpm typecheck`| TypeScript (strict, no emit)     |
| `pnpm test`     | Unit tests (Vitest)              |
| `pnpm test:e2e` | E2E smoke tests (Playwright)     |
| `pnpm db:validate` | Apply all migrations to an ephemeral PostgreSQL and run constraint tests |
| `pnpm test:integration:db` | Catalog API integration tests against a real ephemeral PostgreSQL |
| `pnpm catalog:import <file> [--dry-run]` | Import verified catalog data (needs `DATABASE_URL`) |

Before first `pnpm test:e2e` run: `pnpm exec playwright install chromium`.

CI (GitHub Actions) runs typecheck, lint, unit tests, the database
constraint validation, the database integration tests (both on an
ephemeral throwaway PostgreSQL — no shared or production database),
and the production build as required checks. `pnpm db:validate` and
`pnpm test:integration:db` require local PostgreSQL binaries
(`brew install postgresql@16`); Docker is not needed. Native Supabase
CLI reset validation remains a later checkpoint once Docker is
available (see `supabase/README.md`).

## Environment variables

- Copy `.env.example` to `.env.local`. All variables are optional in
  Phase 4.1; the app runs with none set.
- Server secrets are validated in `src/lib/env/server.ts` (guarded by
  `server-only` — importing it from client code fails the build).
- Client-safe values live in `src/lib/env/client.ts` and must be
  `NEXT_PUBLIC_*` only.
- **Never** put `SUPABASE_SERVICE_ROLE_KEY`, payment or WhatsApp
  secrets into `NEXT_PUBLIC_*` or commit them. `.env*` files are
  git-ignored (except `.env.example`).

## Directory overview

```
src/app/            Next.js App Router (pages + /api/v1 routes)
src/lib/api/        API envelope, typed errors, request-ID, route handler helpers
src/lib/env/        Zod-validated server/client environment modules
src/lib/server/db/  Server-only postgres.js client (lazy, pooler-compatible)
src/repositories/   SQL-only data access (parameterized)
src/services/       Domain services + DTO mapping
src/validators/     Zod schemas for API inputs
supabase/           Database migrations & seed (rules in supabase/README.md)
data/catalog/       Catalog import format + examples (no production data)
scripts/            DB validation harness, catalog importer
tests/unit/         Vitest unit tests
tests/integration/  Real-PostgreSQL integration tests
tests/e2e/          Playwright smoke tests
docs/architecture/  Engineering decisions
docs/api/           API contracts
.github/workflows/  CI pipeline
```

Future layers (`src/domain`, `src/services`, `src/repositories`,
`src/validators`, `src/auth`, …) are added when the first real module
needs them — see `docs/architecture/engineering-foundation.md`.

## Database migrations

Rules live in [`supabase/README.md`](supabase/README.md). In short:
migrations are version controlled, applied migrations are immutable,
destructive one-step migrations are avoided, and production is never
changed manually.

## Security

- The frontend is untrusted; all authorization is server-side.
- Never commit real secrets. Only `.env.example` (placeholders) is
  tracked.
- API responses never expose stack traces, raw DB errors, or provider
  secrets — use the helpers in `src/lib/api/`.
