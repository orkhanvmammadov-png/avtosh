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
- **Env changes are not instantaneous:** changing `LAUNCH_MODE` (or
  any env var) in Vercel takes effect only after a SUCCESSFUL
  redeployment. Until that deployment is live, the previous mode
  keeps serving — plan flips and rollbacks around a verified deploy,
  not around saving the variable.
- **Owner-only pilot:** `LAUNCH_PILOT_PHONES` (Production-only
  secret, comma-separated `+994XXXXXXXXX`; never `NEXT_PUBLIC_*`)
  gates the FULL launch to the listed phones: outsiders cannot
  receive SMS, log in, use an existing session, start payments, or
  use the anonymous contact/report endpoints, while public browsing,
  cron jobs and session-independent payment verification keep
  working. FAIL-CLOSED: if the variable is set but malformed, NOBODY
  (including the Owner) is allowed, and a sanitized
  `launch_pilot_misconfigured` log line is emitted (counts only,
  never numbers). Opening the public launch = deleting the variable
  + a successful redeploy.

## 1. Supabase project (staging) and local secret handling

1. Create a dedicated staging project **in `eu-central-1`
   (Frankfurt)** — the Azerbaijan launch pairs it with Vercel
   Functions pinned to `fra1` (see §6), keeping compute and database
   colocated instead of Vercel's default `iad1`. You will use THREE
   connection strings from the dashboard (Settings → Database):
   - **Direct connection** (db.<ref>.supabase.co:5432) — migrations
     only. NOTE: the direct connection is **IPv6 by default**; on a
     local network that cannot resolve or reach it, the **session
     pooler (port 5432) is the supported IPv4-compatible migration
     fallback**.
   - **Session pooler** (…pooler.supabase.com:5432).
   - **Transaction pooler** (…pooler.supabase.com:6543).
2. Keep runtime and migration connections SEPARATE:
   - `DATABASE_URL` (Vercel runtime) → the session pooler URL
     (selected in §2 below).
   - `MIGRATION_DATABASE_URL` (local file only, never in Vercel) →
     the direct connection, or on an IPv4-only network the session
     pooler.
3. **Local secret file — never in shell history, logs, the repo, or
   chat.** Create a private env file OUTSIDE the repository and open
   it in your editor (do not build it with `echo`/`printf`, which
   land in shell history):

   ```bash
   install -m 600 /dev/null ~/.avtosh/staging.env && open -t ~/.avtosh/staging.env
   ```

   Fill it in the editor with (values from the Supabase dashboard —
   never place a connection string or password directly in a
   command, document, log, commit, or the PR):

   ```
   SESSION_POOLER_URL=...session pooler...
   TRANSACTION_POOLER_URL=...transaction pooler...
   MIGRATION_DATABASE_URL=...direct connection...
   ```

   On an IPv4-only network where the direct connection is
   unreachable, point migrations at the session pooler instead by
   referencing the variable (no value is retyped):

   ```
   MIGRATION_DATABASE_URL="$SESSION_POOLER_URL"
   ```

   (Define `SESSION_POOLER_URL` first — the file is sourced top to
   bottom.)

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

Decision rule and current status (SECOND REVISION, 2026-10, after
the transaction-pooler rollout broke page streaming):
- **Runtime `DATABASE_URL`: the SESSION pooler (port 5432). The
  TRANSACTION pooler (6543) is PROHIBITED for this application's
  runtime.** Switching production to 6543 made `/elanlar` (and
  intermittently `/`) hang on the loading skeleton forever: Next
  streams the shell (HTTP 200 logged with a tiny duration), then the
  page's data chunk never arrives. Reproduced deterministically
  against the staging transaction pooler with the production build
  (31,605-byte stall vs. a full 128,882-byte page in ~3 s on the
  session pooler), and caught in the act server-side: a backend
  stuck `active / wait_event=ClientRead` on the page's
  `categories where code = $1` lookup — the extended-protocol
  message sequence never completed through Supavisor. This is the
  documented postgres.js-pipelining failure, now proven for this
  workload; `prepare: false` does not prevent it and
  `max_pipeline: 1` (the driver's minimum) does not either. A later
  re-run even failed the simple phase with server-side statement
  timeouts — the mode is not dependable for this driver.
- The session-mode client cap that caused the original FULL
  exhaustion (`EMAXCONNSESSION`, pool_size 15) is addressed on the
  session pooler instead: (1) Owner raises the project's pooler
  `pool_size` in the Supabase dashboard (and/or upgrades compute);
  (2) production sets `DB_POOL_MAX=3` to cut per-instance use;
  (3) the cron schedules are STAGGERED (§10) so job invocations
  never align on the quarter hour. With pool_size 30 and
  DB_POOL_MAX 3, ten concurrently busy instances fit.
- `scripts/db/check-supabase-pooler.mjs` now runs TWO phases: the
  original interleaved-transaction smoke AND a "page burst" phase
  reproducing the shape that actually hung (many more concurrent
  multi-query tasks than pool connections). Verified live on
  staging: SESSION passes both phases (960/960 and 240/240);
  TRANSACTION fails. Run both kinds before ever revisiting this
  decision.
- Per-instance pool size stays tunable via `DB_POOL_MAX` (default 5,
  validated 1–20); connections are tagged
  `application_name='avtosh-runtime'` for `pg_stat_activity`
  attribution. Raising `DB_POOL_MAX` is never the fix for client
  exhaustion — instance fan-out is the multiplier.
- `MIGRATION_DATABASE_URL` is unchanged throughout (direct
  connection, or the session pooler on IPv4-only networks).

## 3. Migrations (tracked runner)

Apply the committed migrations with the tracked, fail-fast runner —
never with an ad-hoc loop, and never edit a migration a shared
environment has already recorded:

```bash
run_staging scripts/db/apply-migrations.sh
```

**Variable precedence (deliberate, migration-specific):** the runner
uses `MIGRATION_DATABASE_URL` whenever it is set, and falls back to
`DATABASE_URL` only when it is not. Prefixing the command with
`DATABASE_URL=...` does **not** override a `MIGRATION_DATABASE_URL`
already loaded from the env file — a run redirected that way still
targets the env-file value (this exact mistake failed against an
unreachable IPv6 direct connection on an IPv4-only network). The
runner announces which variable it selected at the start of every
run; check that line. To redirect a run — e.g. to the
IPv4-compatible session pooler — set `MIGRATION_DATABASE_URL`
itself:

```bash
run_staging sh -c 'MIGRATION_DATABASE_URL="$SESSION_POOLER_URL" scripts/db/apply-migrations.sh'
```

(or set `MIGRATION_DATABASE_URL="$SESSION_POOLER_URL"` in the env
file as §1 shows, and run the plain command above).

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

## 6. Vercel project (staging)

**Region:** `vercel.json` pins Functions to `"regions": ["fra1"]`
(Frankfurt), colocated with the `eu-central-1` Supabase project;
without the pin Vercel defaults to `iad1`, far from the database.
Keep `"crons": []` for this release — both are enforced by
`tests/unit/vercel-config.test.ts`.

Set in the dashboard (Owner enters values directly):
- `DATABASE_URL` — the SESSION pooler URL (the selected runtime
  connection from step 2).
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

- App code: revert to the previous Vercel deployment (fast, but
  verify it is actually serving before declaring the rollback done).
- Launch mode: setting `LAUNCH_MODE=READ_ONLY` requires a SUCCESSFUL
  redeployment to take effect — rollback is NOT instantaneous, and a
  failed deploy leaves FULL serving. Verify with the 503 spot checks
  in §7 after the deploy completes.
- **Pending paid orders when READ_ONLY is restored:** in READ_ONLY
  both the payment-return verification and the cron job endpoints
  refuse, so a payment captured by the bank just before the rollback
  stays PENDING in AVTOSH (money captured, fulfillment deferred —
  the exactly-once design holds; nothing is lost or doubled). Check
  for them with SQL over the migration connection
  (`select id, status, created_at from payments where status in
  ('CREATED','PENDING') order by created_at`), and read the
  authoritative bank state per order with the Kapital smoke script's
  verify mode (authenticated read, no writes). They reconcile
  automatically on the next FULL deployment (reconcile-payments job
  / first callback). If the rollback will last long, prefer rolling
  back to FULL + `LAUNCH_PILOT_PHONES` (everyone gated, verification
  and reconciliation still running) over READ_ONLY, or refund the
  captured orders directly with the bank.
- Catalog data: the importer never deletes; to withdraw a bad import,
  deactivate rows (`is_active=false`) via a corrected import file —
  do not hand-edit SQL.
- Migrations: never rolled back in place on a shared environment;
  ship a new forward migration instead.

## 9. Staging evidence (2026-09-28, Frankfurt staging project)

Recorded from the Owner's verified staging runs — **staging
evidence, not universal performance guarantees**. No URL, project
reference, username or secret is recorded here. No production
deployment has occurred and no production database exists.

- Pooler checks: SESSION PASS 960/960 rounds in 130944 ms;
  TRANSACTION PASS 960/960 rounds in 134878 ms.
- Migrations: fresh apply 29 applied / 0 already recorded; re-run
  0 applied / 29 already recorded.
- Imported and directly counted: 210 brands, 222 brand_categories,
  1661 models, 704 model_variants, 72 cities, 29 schema_migrations.
- Real local application with `DATABASE_URL` = session pooler and
  `LAUNCH_MODE=READ_ONLY`: `GET /` 200; warm home total ≈1.45 s in
  `next dev` from the Owner's Azerbaijan connection; health ≈6 ms;
  cities catalog ≈84 ms; CAR brands catalog ≈332 ms; legal rules
  page ≈71 ms; mutation gate 503 `SERVICE_READ_ONLY`.
- Owner visual UAT: PASS.

The former Seoul staging project is not the selected environment; it
is left untouched (do not access or delete it yet).

## 10. Scheduled jobs (restored in vercel.json)

The five production cron schedules are RESTORED in `vercel.json`
(pinned by `tests/unit/vercel-config.test.ts`):

| Job | Schedule | Effect on production records |
|---|---|---|
| `reconcile-payments` | `*/5 * * * *` | re-verifies stale PENDING Kapital payments through the same exactly-once verification path as the callback — the safety net for pending paid orders (see §8) |
| `send-reminders` | `3-59/10 * * * *` | schedules expiry-reminder rows; DELIVERY is a no-op in production (the notification provider is fail-closed null until a channel is integrated — MSM covers OTP only), logged as `provider_unconfigured` |
| `expire-listings` | `7-59/15 * * * *` | overdue ACTIVE listings → EXPIRED (idempotent; public queries already exclude overdue rows by `current_expires_at`) |
| `promotion-housekeeping` | `11-59/15 * * * *` | syncs promotion statuses from their time windows (idempotent) |
| `cleanup-images` | `23 */6 * * *` | reference-checked, grace-gated, bounded storage-orphan cleanup (idempotent) |

Deploying the schedules does NOT run the jobs: every endpoint is
double-gated — in READ_ONLY it refuses even a valid `CRON_SECRET`
(503, covered for all five routes by
`tests/integration/cron-routes-auth.test.ts`), and without a
provisioned `CRON_SECRET` (≥16 chars) every call gets a uniform 401,
so Vercel's unauthenticated cron pings are inert until the secret is
set.

Prerequisites before these schedules actually execute work:
- **Vercel plan**: sub-daily schedules require a paid plan (Hobby
  allows only a couple of daily crons) — the Owner must confirm the
  team plan supports `*/5` frequencies BEFORE merging, or Vercel will
  not honor them.
- `CRON_SECRET` set in Vercel Production (Vercel then sends it as
  the Bearer automatically).
- `LAUNCH_MODE=FULL` via a successful redeploy (§0), as part of the
  reviewed full release (login, selling, payments, moderation),
  optionally behind the Owner pilot gate.

If READ_ONLY is ever restored while payments are pending, follow §8:
the jobs refuse again, pending paid orders wait safely and reconcile
on the next FULL deployment — never assume a captured payment can be
ignored just because the site went read-only.
