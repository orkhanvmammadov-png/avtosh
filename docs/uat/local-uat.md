# AVTOSH.AZ — Local Full UAT Guide (Phase 4.17.5)

One command starts a complete, deterministic, **local-only** AVTOSH
instance for manual business acceptance. Every business rule runs the
real accepted implementation; only external deliveries (WhatsApp,
bank, cloud storage) are local stand-ins.

## 1. Prerequisites

- Node ≥ 24 and `pnpm` (`corepack enable`)
- PostgreSQL client+server binaries on PATH (`initdb`, `pg_ctl`,
  `psql`) — e.g. `brew install postgresql@16` (a running server is
  NOT needed; UAT boots its own throwaway instance)
- `pnpm install` once in the repo

## 2. Start

```bash
pnpm uat:dev
```

This single command: enables the UAT guards (`AVTOSH_UAT=1`), boots an
**ephemeral PostgreSQL** (random local port, exists only while the
command runs), applies all accepted migrations, runs the deterministic
UAT seed, configures local storage / fake Kapital / dev WhatsApp with
clearly-fake local values, and starts Next dev.

Stop it with **Ctrl+C in its terminal** (that also tears the database
down). Keep this terminal visible — OTP codes appear here.

## 3. URLs

| Surface | URL |
| --- | --- |
| Public marketplace | http://localhost:3000 |
| Moderator portal | http://localhost:3000/moderator |
| Admin portal | http://localhost:3000/admin |

## 4. Accounts

All identities are fake and local-only. **Login is always the real
OTP flow** — enter the phone on `/giris`, then read the 6-digit code
from the `pnpm uat:dev` terminal (`[dev-whatsapp] OTP for …: 123456`).
There is no bypass, fixed code, or auto-login.

| Account | Phone | Roles | Purpose |
| --- | --- | --- | --- |
| SELLER_A | `+994551000001` | USER | **Clean seller journey.** Starts with zero listings/publications/payments — use it to prove listing #1/#2/#3 publish FREE and #4 demands the 2 AZN listing fee, entirely through the wizard. |
| SELLER_B | `+994551000002` | USER | **Fixture seller.** Owns the 14-listing status matrix below. |
| MODERATOR | `+994551000003` | MODERATOR | Queue/claim/approve/reject/correction/suspend. |
| ADMIN | `+994551000004` | ADMIN | Full admin console except SUPER_ADMIN-only boundaries. |
| SUPER_ADMIN | `+994551000005` | SUPER_ADMIN | Role management (grant/revoke ADMIN & MODERATOR), everything ADMIN can. |
| STAFF_CANDIDATE | `+994551000006` | USER | Target for the staff role grant → portal access → revoke → access removed test. Not a seller fixture. |

Tip: use separate browsers/profiles (or private windows) to hold two
sessions at once (e.g. SELLER_B + MODERATOR).

### SELLER_B fixture matrix (public № printed at seed time)

`draft`, `pending1` (with images), `pending2`, `correction` (with real
moderator feedback), `rejected` (with feedback), `active` (public,
contactable, reportable, images), `premium`, `boost`, `both`
(premium+boost, motorcycle), `expiryDemo` (time already lapsed, status
still ACTIVE — see §9), `reminder` (expires in 6 days — see §10),
`expired` (renewal-eligible), `sold`, `suspended` (restorable by
admin). Lifecycle-consistent publications (first 3 FREE, then PAID
with SUCCESS fee payments), periods, reviews, promotion payments, and
a suspension history row are seeded; nothing impossible is faked.

## 5. What is REAL vs FAKE locally

**REAL** (production code paths): all migrations and DB rules; OTP
issuing/hashing/attempt+resend limits and sessions; quota accounting;
the whole wizard incl. autosave, `expected_revision`, image
validation/EXIF-strip/WebP re-encode via the signed-upload pipeline;
moderation (queue, claims, one-winner decisions); public read models
and time-window fail-safes; payment intents, initiation claim,
verification, exactly-once fulfillment, reconciliation; promotions;
renewal; reports incl. hashed-source rate limiting; RBAC and the
SUPER_ADMIN boundary; secured cron endpoints; audit immutability.

**FAKE / local stand-ins**: WhatsApp delivery (OTP → terminal log;
lifecycle reminders → accept-only dev provider + log line — *accepted
by fake provider*, never real delivery); Kapital Bank (local fake bank
+ hosted-payment page spoken to by the **real** adapter over HTTP);
storage (filesystem under `.dev-storage/uat/` behind the same
signed-URL contract). UAT prices for Premium/Boost packages are the
placeholder values activated **only in this seeded database** —
production package seeds remain disabled.

## 6. Clean quota journey (SELLER_A)

1–3: log in as SELLER_A → "Elan yerləşdir" → complete the wizard
(≥3 photos) → submit → **FREE**, listing goes to moderation.
4: the fourth submission shows **"Ödəniş tələb olunur — 2 AZN"** with
the real payment intent; pay via fake Kapital (§7) → the listing
proceeds to moderation. The counter is the real lifetime
`listing_publications` accounting — nothing UI-faked.

## 7. Fake Kapital payments

Any payment (listing fee #4, Premium/Boost purchase, renewal) leads
to the local hosted payment page:

- **Ödə** → success → you return to `/odenis/kapital/netice`, which
  performs the real server-to-server verification before showing
  success. Refreshing re-verifies idempotently (never double-fulfils).
- **İmtina** → decline → the return page shows the non-success state;
  the payment stays pending/ops (matching the accepted
  unknown-status policy) and can be retried or picked up by
  reconciliation (§11).
- Pending/re-check: open the return URL again, or run reconciliation.

There is no "mark as paid" shortcut anywhere.

## 8. Moderator / Admin / Staff-role walkthroughs

- **Moderator** (`/moderator`): claim `pending1`, approve → listing
  goes ACTIVE and public. Claim `pending2`, try reject/correction with
  reasons. Suspend the ACTIVE listing from its review page. History
  shows prior decisions on `correction`/`rejected`.
- **Correction round-trip**: as SELLER_B open `correction` in the
  wizard, fix, resubmit → back in the queue.
- **Admin** (`/admin`): dashboard, users (search `+994551`), block →
  the blocked seller loses mutations → unblock; listings ops view;
  unsuspend the `suspended` fixture (restores ACTIVE — its period is
  still valid); payments list/detail + "Provayderdə yoxla";
  Premium/Boost package pricing + activation (version-conflict UX by
  editing in two tabs); typed settings; catalog toggles; reports;
  read-only audit.
- **SUPER_ADMIN vs ADMIN**: log in as ADMIN → user detail of
  STAFF_CANDIDATE shows no "Admin təyin et" control. As SUPER_ADMIN,
  grant MODERATOR to STAFF_CANDIDATE → candidate logs in →
  `/moderator` works → revoke → 404 again.

## 9. Expiry demo (public fail-safe + real worker)

The `expiryDemo` listing's paid time has already lapsed while its
stored status is still ACTIVE:

1. Search/home: it is **already absent** from active results — public
   visibility is time-based and never waits for the worker.
2. Run the real secured job (§11): its status flips ACTIVE → EXPIRED,
   and SELLER_B's My Listings shows "Müddəti bitib / Yenilə".
3. **Renewal**: as SELLER_B, open the `expired` fixture → "Yenilə" →
   2 AZN / 30 days (server-priced) → fake Kapital → verified success →
   "Elan yeniləndi" with the new date → same public № live again.

## 10. WhatsApp reminders (two separate demos)

Reminder identity: `LISTING_EXPIRY_REMINDER:<period>:D7/D5/D3/D1`,
pinned to 10:00 Asia/Baku in production — UAT does not change that.

**SCHEDULING TEST** — run the reminders job (§11) once: the
`reminder` fixture (expires in 6 days) gets D5/D3/D1 rows created
with future send times. Running the job again creates no duplicates
(dedupe). Verify in admin/audit? No — check the job JSON response
(`scheduled: 3`, then `0`).

**DELIVERY WORKER TEST** — production would wait for 10:00 Baku;
instead run the UAT-only time control (separate terminal):

```bash
pnpm uat:reminder-due
```

It moves ONLY the seeded fixture's scheduled rows to "due now"
(guarded: `AVTOSH_UAT`, ephemeral-DB contract, fixture identity only;
no HTTP route, no scheduling-code change). Then run the reminders job
again → response shows `sent: 3` and the server log prints
`whatsapp.dev_notification_accepted` lines — accepted by the FAKE
provider, not real delivery.

## 11. Invoking the secured jobs

All jobs require the UAT cron secret; export it once per terminal:

```bash
export CRON_SECRET=uat-cron-secret-0123456789abcdef
```

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/expire-listings
```

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/send-reminders
```

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/reconcile-payments
```

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/jobs/promotion-housekeeping
```

Negative check — cron auth is NOT disabled locally (expect 401):

```bash
curl -i http://localhost:3000/api/jobs/expire-listings
```

## 12. Report flow & rate limit

Browser: open the `active` fixture's public page anonymously →
"Şikayət et" → reason + note → submit → confirmation. As ADMIN:
`/admin/hesabatlar` shows the OPEN report; resolve/dismiss it.

**Localhost note**: with no `X-Forwarded-For` header the accepted
policy skips per-source rate limiting (no trustworthy client IP), so
repeat browser reports will all succeed locally. To exercise the
limit, send a controlled source header (replace `<№>` with the active
fixture's public number):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "content-type: application/json" -H "x-forwarded-for: 198.51.100.42" -d '{"reason_code":"WRONG_INFORMATION"}' http://localhost:3000/api/v1/listings/<№>/report
```

Run it twice: first → `200`, second (same source, same listing) →
`429 REPORT_RATE_LIMITED`. The endpoint itself is unmodified.

## 13. Reset

**Stop `pnpm uat:dev` (Ctrl+C) and start it again.** Every start
creates a brand-new ephemeral database, re-applies migrations, and
re-seeds deterministically (~15 s). The UAT storage namespace
(`.dev-storage/uat/` only) is cleared by the seed; other local
`.dev-storage` content is never touched. There is deliberately **no
destructive DB reset command** — and nothing here can reach a remote
or production database at all.

## 14. Troubleshooting

- **Port 3000 in use / "run kill <pid>"**: a previous `next dev` is
  still alive (e.g. the terminal was closed instead of Ctrl+C). Kill
  the reported pid, also `pkill -f "next dev"` if needed, then rerun.
- **`initdb failed` (shared memory exhausted)**: orphaned temp
  Postgres instances from killed runs. Clean up:
  `ps ax | grep avtoshpg` → `kill` those postgres pids →
  `rm -rf /tmp/avtoshpg.*` → rerun.
- **OTP code not visible**: it prints in the `pnpm uat:dev` terminal,
  masked phone + 6 digits. Requesting again too fast hits the real
  resend cooldown (UAT-tuned to 15 s).
- **`[uat-seed] REFUSED: …`**: a safety guard fired — the seed only
  runs inside the ephemeral wrapper. Always start via `pnpm uat:dev`.
- **Images don't render**: ensure the run was started by
  `pnpm uat:dev` (it sets `STORAGE_DRIVER=local` and
  `LOCAL_STORAGE_SUBDIR=uat`).
- **`pnpm uat:reminder-due` says no rows**: run the send-reminders
  job once first (it schedules), or restart if they were already sent.

## 15. Manual acceptance checklist

Work through `docs/uat/manual-checklist.md` and record PASS/FAIL per
case. Automated test results do not substitute for this manual pass.
