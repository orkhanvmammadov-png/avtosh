# AVTOSH.AZ

Azerbaijan-focused responsive **web** marketplace for cars and
motorcycles. Web only — no native iOS/Android applications.

**Current phase: Phase 4.2 — Database Schema & Migrations (complete).**
The full MVP database schema exists as Supabase migrations; no
application business features (auth, listings, payments, moderation, …)
are implemented yet. `CLAUDE.md` is the authoritative
product/architecture instruction file; see
`docs/architecture/database.md` for the schema design.

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

Before first `pnpm test:e2e` run: `pnpm exec playwright install chromium`.

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
src/lib/api/        API envelope, typed errors, request-ID handling
src/lib/env/        Zod-validated server/client environment modules
supabase/           Database migrations & seed (rules in supabase/README.md)
tests/unit/         Vitest unit tests
tests/e2e/          Playwright smoke tests
docs/architecture/  Engineering decisions
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
