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

## 1. Supabase project (staging) and local secret handling

1. Create a dedicated staging project. You will use THREE connection
   strings from the dashboard (Settings → Database):
   - **Direct connection** (db.<ref>.supabase.co:5432) — migrations only.
   - **Session pooler** (…pooler.supabase.com:5432).
   - **Transaction pooler** (…pooler.supabase.com:6543).
2. Keep runtime and migration connections SEPARATE:
   - `DATABASE_URL` (Vercel runtime) → pooler URL chosen in step 2 below.
   - `MIGRATION_DATABASE_URL` (local file only, never in Vercel) →
     the direct connection.
3. **Local secret file — never in shell history, logs, the repo, or
   chat.** Create a private env file OUTSIDE the repository and open
   it in your editor (do not build it with `echo`/`printf`, which
   land in shell history):

   ```bash
   install -m 600 /dev/null ~/.avtosh/staging.env && open -t ~/.avtosh/staging.env
   ```

   Fill it in the editor with (values from the Supabase dashboard):

   ```
   MIGRATION_DATABASE_URL=...direct connection...
   SESSION_POOLER_URL=...session pooler...
   TRANSACTION_POOLER_URL=...transaction pooler...
   ```

   Every command below loads it in a subshell so nothing leaks into
   your interactive environment or history:

   ```bash
   run_staging() ( set -a; . ~/.avtosh/staging.env; set +a; "$@" )
   ```

   Define `run_staging` once per terminal session. Never paste any of
   these values into chat, commits, or the PR.

## 2. Choose and VERIFY the runtime connection mode

Supabase's Postgres.js guidance warns: postgres.js **pipelines
queries by default**, and combined with the **shared transaction
pooler** this can **hang queries or return mismatched rows**;
`prepare: false` (which this app already sets) does **not** disable
pipelining, and `max_pipeline: 0` breaks `sql.begin()` upstream.

`scripts/db/check-supabase-pooler.mjs` is a **bounded smoke/stress
test, not proof of complete compatibility**: it exercises one risky
shape (saturated pool, interleaved queries + transactions) and
verifies every reply against its unique tag. Run it against BOTH
pooler URLs, labeled with `POOLER_KIND` so the output and any advice
name the pooler that was actually tested (it only SELECTs; the
connection string is never printed):

```bash
run_staging sh -c 'DATABASE_URL="$SESSION_POOLER_URL" POOLER_KIND=SESSION node scripts/db/check-supabase-pooler.mjs'
run_staging sh -c 'DATABASE_URL="$TRANSACTION_POOLER_URL" POOLER_KIND=TRANSACTION node scripts/db/check-supabase-pooler.mjs'
```

How to read the result — the checker distinguishes a hang from a
slow remote database:
- **STALL** — no round completed within the inactivity window
  (default 30 s, resets after every completed round). This is the
  signature of the pipelining hang.
- **TOTAL_BUDGET_EXCEEDED** — rounds kept completing but the run
  passed the absolute safety ceiling (default 10 min). This points
  at latency/throughput, **not** a proven hang: re-run with a higher
  `POOLER_CHECK_TOTAL_BUDGET_MS` or fewer `POOLER_CHECK_ROUNDS`
  before drawing conclusions.
- **MISMATCH** — a reply carried the wrong tag: hard evidence of the
  documented truncation/mismatch failure. Do not use that pooler.

Both PASS and FAIL print completed rounds and elapsed time. Load is
tunable via validated env vars: `POOLER_CHECK_CONCURRENCY`
(default 24), `POOLER_CHECK_ROUNDS` (rounds per worker, default 40),
`POOLER_CHECK_STALL_TIMEOUT_MS` (default 30000),
`POOLER_CHECK_TOTAL_BUDGET_MS` (default 600000). On a high-latency
link, raise the budget or lower the rounds rather than concluding
from a ceiling trip.

Decision rule:
- **Provisional preference: the session pooler (port 5432)** — it is
  not subject to the transaction-mode pipelining truncation. This
  remains PROVISIONAL until the real application's queries and
  transactions have been exercised against staging; a smoke-test
  PASS is necessary, not sufficient.
- Use the transaction pooler (6543) only if its check PASSES
  repeatedly and Supavisor on the project is a version with native
  pipelining support; otherwise avoid it.
- Record in the release notes: the chosen URL kind, the check
  output, the project's client-connection limits for its compute
  size, and any failures observed. If both fail, stop and
  investigate before deploying. No connection mode may be described
  as "verified" without an actual staging run.

## 3. Migrations (direct connection, tracked runner)

Apply the committed migrations with the tracked, fail-fast runner —
never with an ad-hoc loop, and never edit a migration a shared
environment has already recorded:

```bash
run_staging scripts/db/apply-migrations.sh
```

The runner keeps a `schema_migrations` history table, skips files
already recorded (non-idempotent files are never blindly re-run),
applies each pending file in ONE transaction together with its
history row, exits nonzero on the first failure and names the failed
file. A failed file is fully rolled back and unrecorded; recovery on
a fresh staging database is documented in the script header
(inspect `schema_migrations`, fix forward via a reviewed migration,
or drop and recreate the fresh database). The runner is verified in
CI-adjacent tooling against an ephemeral database, including an
intentionally failing migration.

Verify afterwards:

```bash
run_staging sh -c 'psql "$MIGRATION_DATABASE_URL" -c "select count(*) from schema_migrations"'
```

## 4. Approved catalog import (dry-run first, then import)

The catalog is the ONLY data loaded in the read-only release — no
listings, no UAT seed data, no fake rows.

```bash
python3 -c "import json; b=json.load(open('data/catalog/owner-brands.json')); m=json.load(open('data/catalog/owner-models.json')); c=json.load(open('data/catalog/owner-cities.json')); json.dump({**b, **m, **c}, open('/tmp/owner-full-catalog.json','w'))"
run_staging sh -c 'DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm catalog:import /tmp/owner-full-catalog.json --dry-run'
run_staging sh -c 'DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm catalog:import /tmp/owner-full-catalog.json'
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
