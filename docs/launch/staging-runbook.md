# Staging setup runbook — read-only initial release

Scope: bring up a **staging** environment (Vercel + Supabase) for the
read-only public release. Nothing here touches a production database.
Secrets are entered by the Owner locally (shell env) or directly in
the Vercel/Supabase dashboards — never in chat, never committed.

## 0. Launch mode

- The production runtime **fails closed**: without `LAUNCH_MODE`,
  `NODE_ENV=production` runs READ_ONLY (`src/lib/config/launch.ts`).
  For this release, do not set `LAUNCH_MODE` at all (or set
  `LAUNCH_MODE=READ_ONLY` explicitly for clarity).
- The later full release enables the marketplace by deliberately
  setting `LAUNCH_MODE=FULL` after review. Nothing else flips it.

## 1. Supabase project (staging)

1. Create a dedicated staging project. Note THREE connection strings
   from the dashboard (Settings → Database):
   - **Direct connection** (db.<ref>.supabase.co:5432) — migrations only.
   - **Session pooler** (…pooler.supabase.com:5432).
   - **Transaction pooler** (…pooler.supabase.com:6543).
2. Keep runtime and migration connections SEPARATE:
   - `DATABASE_URL` (Vercel runtime) → pooler URL chosen in step 2 below.
   - `MIGRATION_DATABASE_URL` (local shell only, never in Vercel) →
     the direct connection.

## 2. Choose and VERIFY the runtime connection mode

Supabase's Postgres.js guidance warns: postgres.js **pipelines
queries by default**, and combined with the **shared transaction
pooler** this can **hang queries or return mismatched rows**;
`prepare: false` (which this app already sets) does **not** disable
pipelining, and `max_pipeline: 0` breaks `sql.begin()` upstream.

Run the repository's compatibility check against BOTH pooler URLs
(it only SELECTs; a hang fails via timeout):

```bash
DATABASE_URL='<session pooler url>' node scripts/db/check-supabase-pooler.mjs
DATABASE_URL='<transaction pooler url>' node scripts/db/check-supabase-pooler.mjs
```

Decision rule:
- **Recommended for this release: the session pooler (port 5432)** —
  it is not subject to the transaction-mode pipelining truncation.
  Keep the app's pool small (`max: 5` per instance, already set) and
  watch Supabase's client-connection limit for the instance size.
- Use the transaction pooler (6543) only if its check PASSES
  repeatedly and Supavisor on the project is a version with native
  pipelining support; otherwise avoid it.
- Record the chosen URL kind and the check output in the release
  notes. If both fail, stop and investigate before deploying.

## 3. Migrations (direct connection, local shell)

Apply the committed migrations in filename order — never edit a
migration already applied to a shared environment:

```bash
for f in supabase/migrations/*.sql; do
  psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" || break
done
```

Verify: `psql "$MIGRATION_DATABASE_URL" -c '\dt'` shows the expected
tables (brands, models, model_variants, cities, listings, …).

## 4. Approved catalog import (dry-run first, then import)

The catalog is the ONLY data loaded in the read-only release — no
listings, no UAT seed data, no fake rows.

```bash
python3 -c "import json; b=json.load(open('data/catalog/owner-brands.json')); m=json.load(open('data/catalog/owner-models.json')); c=json.load(open('data/catalog/owner-cities.json')); json.dump({**b, **m, **c}, open('/tmp/owner-full-catalog.json','w'))"
DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm catalog:import /tmp/owner-full-catalog.json --dry-run
DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm catalog:import /tmp/owner-full-catalog.json
```

Expected: `210 brands, 222 brand/category links, 1661 models,
704 model variants, 72 cities`. The import is one transaction and
idempotent — re-running it is safe. Remember the open Product-review
items (5 provisional model categories, 30 brand QA notes) remain
open; the import being technically possible is not their resolution.

## 5. Storage (Supabase Storage, PRIVATE bucket)

1. Create bucket `listing-images` with **Public bucket = OFF**.
2. In Vercel set `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, and
   `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never
   `NEXT_PUBLIC_*`). The app serves images exclusively through
   short-lived signed URLs, so a private bucket is required.
3. Do NOT set `PAYMENT_FAKE_KAPITAL`, `STORAGE_DRIVER=local`, or any
   UAT/OTP dev values in staging or production; the dev routes are
   additionally disabled whenever `NODE_ENV=production`.

## 6. Vercel project env (staging)

Set in the dashboard (Owner enters values directly):
- `DATABASE_URL` — the VERIFIED pooler URL from step 2.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_DRIVER=supabase`.
- Do not set `CRON_SECRET` for this release (jobs must not run; the
  job endpoints also refuse in read-only mode even with a secret).
- Do not set WhatsApp or Kapital credentials — those integrations are
  deferred and every path that would use them is blocked server-side.

## 7. Verification checklist (staging deploy)

- `GET /api/v1/health` → 200.
- Home, `/elanlar?category=CAR|MOTORCYCLE`, brand/model/variant/city
  filters, an empty search → honest empty state.
- Legal pages: `/istifadeci-razilasmasi`, `/qaydalar`,
  `/mexfilik-siyaseti` (unchanged documents).
- `/giris` shows the "Tezliklə" notice; header shows the read-only
  badge and no login/post CTAs; footer has no Hesab column.
- Fail-closed spot checks (expect 503 SERVICE_READ_ONLY):
  `curl -X POST .../api/v1/auth/otp/request`,
  `curl -X POST .../api/v1/listings/1/contact`,
  `curl .../api/jobs/expire-listings -H 'Authorization: Bearer x'`.
- Vercel → Settings → Cron Jobs shows NO schedules.

## 8. Rollback

- App: revert to the previous Vercel deployment (instant).
- Catalog data: the importer never deletes; to withdraw a bad import,
  deactivate rows (`is_active=false`) via a corrected import file —
  do not hand-edit SQL.
- Migrations: never rolled back in place on a shared environment;
  ship a new forward migration instead.

## 9. Restoring the scheduled jobs (later FULL release)

`vercel.json` intentionally ships with `"crons": []` for this
release. The full release restores exactly this configuration
(preserved here and in git history at tag/commit of PR #43-era
`vercel.json`):

```json
{
  "crons": [
    { "path": "/api/jobs/reconcile-payments", "schedule": "*/5 * * * *" },
    { "path": "/api/jobs/send-reminders", "schedule": "*/10 * * * *" },
    { "path": "/api/jobs/expire-listings", "schedule": "*/15 * * * *" },
    { "path": "/api/jobs/promotion-housekeeping", "schedule": "*/15 * * * *" },
    { "path": "/api/jobs/cleanup-images", "schedule": "0 */6 * * *" }
  ]
}
```

together with: `LAUNCH_MODE=FULL`, a strong `CRON_SECRET` (≥16
chars), real WhatsApp + Kapital credentials, and a reviewed release
that re-enables login, selling, payments and moderation. The job
endpoints stay double-gated: cron auth AND launch mode.
