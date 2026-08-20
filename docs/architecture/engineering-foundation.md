# Phase 4.1 — Engineering Foundation Decisions

Date: 2026-08-20
Status: implemented

This document records the concrete engineering decisions of
Phase 4.1. `CLAUDE.md` at the repository root remains the
authoritative product and architecture instruction file.

## Missing product documentation

Phase 1–3 product/business documentation is **not present** in this
repository. It still needs to be materialized into `/docs`
(architecture, api, analytics) before business-feature implementation
continues deeply. Until then, CLAUDE.md is authoritative.

## Repository & toolchain

| Decision | Value | Rationale |
| --- | --- | --- |
| VCS | Git, primary branch `main`, no remote yet | Task requirement |
| Framework | Next.js 16.3.1 (App Router, stable) | CLAUDE.md stack; Vercel-compatible |
| Language | TypeScript (strict) | CLAUDE.md stack |
| Styling | Tailwind CSS 4 (PostCSS plugin) | CLAUDE.md stack |
| Package manager | pnpm 11 (single lockfile: `pnpm-lock.yaml`) | Task preference; installed locally |
| Node.js | ≥ 24 LTS, pinned via `.nvmrc` + `engines` | Current LTS, compatible with Next 16 and Vercel; validated locally on Node 26 |
| Scaffolding | Files authored directly (create-next-app-equivalent layout) | Sandbox blocked `pnpm dlx`; output matches the standard CNA `--ts --tailwind --eslint --app --src-dir` scaffold |

## Dependencies (all with present-tense justification)

Runtime:
- `next`, `react`, `react-dom` — the application framework.
- `zod` — environment validation now; API DTO validation in later
  phases (mandated by CLAUDE.md).
- `server-only` — makes importing server env/secret modules from
  client components a build-time error (server/client boundary).

Dev:
- `typescript`, `@types/*` — strict typing.
- `tailwindcss`, `@tailwindcss/postcss` — styling toolchain.
- `eslint`, `eslint-config-next`, `@eslint/eslintrc` — linting
  (flat config with Next.js presets).
- `vitest` — unit test runner.
- `@playwright/test` — E2E smoke infrastructure.

Deliberately **not** installed: ORMs (Prisma/Drizzle), Redis/BullMQ,
Zustand, TanStack Query, Axios, payment/WhatsApp/analytics/Sentry
SDKs. Each arrives only with the phase that needs it.

## Directory architecture

Only directories with a real Phase 4.1 purpose exist:

```
src/app/               App Router + /api/v1 routes
src/lib/api/           response envelope, typed errors, request IDs
src/lib/env/           server/client env validation
supabase/{migrations,seed}/
tests/{unit,e2e,helpers}/
docs/architecture/
.github/workflows/
```

The target structure additionally reserves `src/components/{ui,shared}`,
`src/domain`, `src/services`, `src/repositories`, `src/validators`,
`src/providers`, `src/auth`, `src/analytics`, `src/lib/server`,
`src/types`, `docs/api`, `docs/analytics`. They are created when the
first real module lands in them — empty placeholder files are
deliberately avoided.

## API foundation

- Versioned namespace `/api/v1`; only `GET /api/v1/health` exists.
- Success envelope `{ "data": ... }`; error envelope
  `{ "error": { code, message, details, request_id } }`
  (`src/lib/api/response.ts`).
- Typed `ApiError` with stable codes (`VALIDATION_ERROR`,
  `INTERNAL_ERROR`); unknown thrown values are collapsed into a
  generic `INTERNAL_ERROR` so stack traces / DB errors / secrets can
  never leak (`src/lib/api/errors.ts`).
- Request IDs: incoming `X-Request-ID` is used only when it matches a
  bounded safe pattern (`^[A-Za-z0-9._-]{8,128}$`), otherwise a UUID
  is generated; the ID is echoed on responses and embedded in error
  bodies (`src/lib/api/request-id.ts`). This will back Sentry,
  logging, and payment/provider troubleshooting later without extra
  infrastructure.

## Environment architecture

- `src/lib/env/server.ts` — Zod schema for server-only variables
  (`DATABASE_URL`, `SUPABASE_*`, `WHATSAPP_*`, `PAYMENT_*`,
  `SENTRY_DSN_SERVER`). All optional in Phase 4.1 so the app runs with
  no `.env`. Guarded by `server-only`. Validation errors report
  variable names only, never values.
- `src/lib/env/client.ts` — explicit allowlist of `NEXT_PUBLIC_*`
  values referenced literally for build-time inlining.
- `.env.example` documents names with placeholders; all real `.env*`
  files are git-ignored.

## Testing

- **Vitest** (`tests/unit/`): request-ID validation, error model,
  response envelopes, health route contract, server env parsing
  (`server-only` stubbed via a Vitest alias since unit tests run in
  plain Node).
- **Playwright** (`tests/e2e/`): chromium-only smoke — home page
  renders, health endpoint contract incl. `X-Request-ID` echo. Uses a
  `webServer` block that boots `pnpm dev`.
- React Testing Library is intentionally deferred until UI testing
  becomes relevant.

## CI

`.github/workflows/ci.yml` runs on pushes to `main` and all PRs:
checkout → pnpm → Node (from `.nvmrc`) → frozen-lockfile install →
PostgreSQL binaries on PATH → typecheck → lint → unit tests →
database constraint validation (`pnpm db:validate`) → database
integration tests (`pnpm test:integration:db`) → production build.
The database checks use the repository's own ephemeral-PostgreSQL
harness against a throwaway localhost instance — no secrets, no
shared or production databases. Playwright is **not** in the required
pipeline (browser provisioning would slow/fragile-ify it); it can be
added as a separate job when E2E coverage grows.

## Supabase

`supabase/migrations/` and `supabase/seed/` exist with documented
migration rules (`supabase/README.md`). The Supabase CLI was not
available on the development machine, so `supabase init` (local
`config.toml`) is deferred to Phase 4.2. No database was contacted.

## Known deviations / notes

- Scaffolding was authored manually instead of via
  `create-next-app` (sandbox policy blocked `pnpm dlx`); the result is
  the standard CNA layout.
- `.nvmrc` pins Node 24 (current LTS); the machine used for initial
  validation ran Node 26, which also satisfies `engines: ">=24"`.
