# AVTOSH.AZ — Lifecycle Jobs, Renewal & Notifications (Phase 4.16)

Date: 2026-08-31
Status: implemented (WhatsApp BSP integration and template approval
remain LAUNCH CHECKPOINTS — see Provider)

Phase 4.16 completes the operational lifecycle foundation: the expiry
worker, seller renewal on the accepted Kapital core, period-scoped
WhatsApp expiry reminders, scheduled payment reconciliation,
promotion status housekeeping, secured cron endpoints, and the
buyer-side report-intake MVP. No accepted lifecycle or payment
architecture was redesigned.

## Expiry authority & worker

Public visibility NEVER waits for a job: every public read keeps the
accepted fail-safe `status = 'ACTIVE' AND current_expires_at >
now()`, so a lapsed listing disappears from active results (and its
detail page degrades to the limited EXPIRED view) the moment its time
passes, even if the worker is hours late.

`runListingExpiry` synchronizes the DURABLE state in bounded batches
(100/batch, capped batches per run): one CTE claims overdue ACTIVE
listings with `FOR UPDATE SKIP LOCKED`, flips them to EXPIRED behind
a correlated `status = 'ACTIVE'` guard, and — in the same statement —
writes the SYSTEM status-history row (`LISTING_EXPIRED`), an outbox
event, and the lapsed period's `EXPIRED` status. Overlapping worker
executions partition the backlog instead of colliding: one
transition, one history row, one outbox event per listing, ever
(stress-tested with 10 concurrent runs over 30 listings). The partial
index `listings_active_expires_at` (accepted in Phase 4.2's index
migration for exactly this job) drives the scan.

## Renewal

Accepted rule: an EXPIRED listing renews for the settings-resolved
fee and duration — `listing.renewal_fee_minor` (seeded 200 = 2 AZN)
and `listing.renewal_duration_days` (seeded 30), both admin-editable
through the Phase 4.15 typed allowlist. Same listing id, same public
№, same publication identity and history; renewal is NOT a new
publication and consumes no free-publication quota
(`listing_publications` is untouched — regression-tested).

- **Eligibility** (`createRenewalCheckout`): authenticated, unblocked
  owner; listing status exactly `EXPIRED`. Every other status → 409
  `PAYMENT_NOT_REQUIRED`; foreign/missing/DELETED → uniform 404.
- **Intent snapshot**: fee → `payments.amount_minor`, duration →
  `payments.renewal_duration_days` (migration 019). The browser sends
  nothing but the listing id. Later setting changes never touch an
  existing intent: open intents are reused as-is, and fulfillment
  reads only the snapshot (2 AZN/30 d before a change stays 2 AZN/30
  d; the next purchase gets 3 AZN/45 d — regression-tested).
- **Single open intent**: partial unique index
  `payments_open_renewal_intent` (one CREATED/PENDING RENEWAL payment
  per listing) — 10 simultaneous requests converge on one intent and,
  via the Phase 4.12 initiation claim, ONE provider createOrder.
- **Kapital reuse**: `runProviderCheckout` is the only checkout core;
  callback, session-independent verification, exact amount/currency
  matching, HPP handling, and reconciliation are all the accepted
  4.12 implementation. No renewal-specific adapter, callback, or
  second verification path exists.
- **Fulfillment** (`fulfillRenewal`, inside the one verified-SUCCESS
  transaction): lock the listing row → insert the next sequential
  `listing_period` (`source = 'RENEWAL'`, `payment_id`, starts at
  fulfillment time, ends at start + snapshot duration) → `EXPIRED →
  ACTIVE` with `current_expires_at = ends_at`, SYSTEM history
  (`RENEWAL`), outbox `LISTING_RENEWED`. Exactly-once is inherited
  from the payment-status transition (a payment reaches SUCCESS at
  most once): callback ×20 + 10 concurrent verifications +
  overlapping reconciliation runs produce one period, one transition
  (stress-tested). If the listing left EXPIRED through another path
  meanwhile (operations edge), the paid time is still recorded
  (`current_expires_at` only grows) and the status is left alone with
  an operations log flag.
- **UX**: My Listings shows "Müddəti bitib" with a "Yenilə" action →
  `/profil/elanlar/[id]/yenile` shows the server-loaded price,
  duration, and what happens after payment → HPP → the accepted
  result page renders "Elan yeniləndi" with the new expiry date ONLY
  after verified provider success (pending/outage/mismatch states are
  the accepted 4.12 result patterns).

## Expiry reminders

Accepted schedule (single source: `EXPIRY_REMINDER_OFFSETS_DAYS`):
**7 / 5 / 3 / 1 days before expiry, at 10:00 Asia/Baku** (UTC+4, no
DST). Send time = (expiry date in Baku − offset days) at 10:00 Baku,
computed in SQL.

- **Scheduling** (idempotent, every reminders run): for each CURRENT
  period (`listing.current_expires_at = period.ends_at`, both ACTIVE)
  entering the 9-day horizon, insert the reminder rows whose send
  time is still in the future. Identity =
  `LISTING_EXPIRY_REMINDER:<listing_period_id>:D<offset>` on the
  accepted UNIQUE `dedupe_key` — cron running twice, overlapping
  schedulers, and reruns are structural no-ops. Send times already
  past are never inserted (a stale "7 days left" is worse than
  silence).
- **Period scoping**: renewal creates a NEW period → a fresh identity
  set schedules automatically; the old period's pending rows can
  never match the new expiry and are CANCELLED at claim time.
- **Recipient authority**: the SELLER ACCOUNT phone
  (`users.phone_e164` via `notifications.user_id`) — the verified
  business identity. `listings.contact_phone_e164` is the
  buyer-facing contact, may belong to someone else, and is
  deliberately NOT used. Phones never appear in logs or payloads.
- **Sending**: single-statement claim (due SCHEDULED rows honoring
  `next_retry_at`, plus PROCESSING rows whose 15-minute lease
  lapsed) → PROCESSING with `FOR UPDATE SKIP LOCKED` — each
  notification is held by at most one worker (10 overlapping workers:
  every notification sent exactly once, stress-tested). Before
  sending, eligibility is re-checked: ACTIVE + current period + expiry
  ahead → send; SUSPENDED → DEFER (returned to SCHEDULED with a 1-hour
  hold — a restored listing still gets its reminder; a stale one
  auto-cancels); SOLD/DELETED/EXPIRED/superseded → CANCELLED with
  `cancel_reason` (no misleading messages).
- **Retry**: transient provider failures re-schedule the SAME row
  (same dedupe identity, no duplicate business rows) with exponential
  backoff (5 min base, ×2 per attempt, max 5 attempts →
  `RETRIES_EXHAUSTED`); PERMANENT provider errors (template/config)
  fail immediately. Row failures are isolated — one bad row never
  sinks the batch; job-level DB/claim failures still propagate.

## WhatsApp provider

A NEW notification-domain interface
(`WhatsAppNotificationProvider.sendTemplate`) separate from the OTP
interface — lifecycle and authentication templates cannot be
confused. Content is controlled: `template_code`
(`LISTING_EXPIRY_REMINDER`, registered as a DRAFT/inactive
`notification_templates` row in migration 019) + structured params
(listing №, title, days left, expiry date) — arbitrary outbound text
is not accepted, and nothing sensitive beyond the listing reference
is included.

**Production fails closed**: no BSP is integrated, so the factory
returns `null` in production — the sender schedules rows, sends
NOTHING, leaves them safely SCHEDULED, and logs
`provider_unconfigured`. Delivery is never fabricated. Dev/E2E use a
deterministic accept-only stub; tests inject a memory provider with
failure injection. Delivery states: SCHEDULED → PROCESSING → SENT
("accepted by provider" — `sent_at`, `provider_message_id`) /
FAILED / CANCELLED. `DELIVERED`/`READ` stay unused until a BSP
delivery webhook exists — we do not invent provider semantics.

## Scheduled jobs & cron security

No queue/scheduler framework was added. Vercel Cron (vercel.json)
invokes four GET endpoints; every one requires
`Authorization: Bearer ${CRON_SECRET}` (server-only env, timing-safe
comparison). **Fail closed**: a missing/short secret refuses every
request in every environment — jobs are simply not HTTP-executable
until the secret is provisioned. Tests use a controlled secret.

| Endpoint | Schedule | Work |
| --- | --- | --- |
| `/api/jobs/reconcile-payments` | */5 min | `reconcileProviderPayments` (4.12) over stale non-terminal Kapital payments, bounded batch (`PAYMENT_RECONCILE_OLDER_THAN_SECONDS`/`_BATCH_LIMIT` env-tunable) |
| `/api/jobs/send-reminders` | */10 min | schedule + deliver expiry reminders |
| `/api/jobs/expire-listings` | */15 min | durable ACTIVE→EXPIRED sync |
| `/api/jobs/promotion-housekeeping` | */15 min | durable promotion status sync |

Intervals are deliberately modest (visibility never depends on them);
Vercel Hobby-tier cron limits would require stretching them —
documented deployment consideration, not a correctness issue.
Promotion housekeeping only reconciles stored `listing_promotions`
status (SCHEDULED→ACTIVE, →EXPIRED) — public ranking already uses
time windows and is untouched, as is listing publication expiry.

**Observability**: every run logs structured scrubbed events
(`job.started`/`job.finished` with run id, row counts, duration;
per-row failure events) — never phones, payment secrets, provider
payloads, or message bodies.

## Report intake (MVP)

`POST /api/v1/listings/[publicId]/report` — anonymous buyer reports
from the public detail page ("Şikayət et"): controlled reason codes
(`WRONG_INFORMATION | DUPLICATE | FRAUD_SUSPECTED |
SOLD_OR_UNAVAILABLE | PROHIBITED_CONTENT | OTHER`, Azerbaijani labels
client-side, DB check constraint in migration 019) + optional ≤500
char note. Reportable targets are exactly the publicly reachable
detail statuses (ACTIVE/SOLD/EXPIRED); everything else answers the
same uniform 404 as the detail page — no hidden-listing oracle.

Abuse protection reuses the accepted `anonymous_action_events`
infrastructure (keyed HMAC of the client IP — raw IPs never stored):
per source+listing (default 1/day) and per source overall (default
20/day), env-tunable; 429 `REPORT_RATE_LIMITED`. No CAPTCHA (not
warranted yet). Privacy: the response returns only `{accepted:true}`
— no report id, reporter identity, IP material, or staff metadata
ever leaves the server, and the seller cannot learn who reported
them. Rows land as OPEN `listing_reports` managed by the Phase 4.15
admin workflow (round-trip tested end to end).

## Database (migration 019, additive)

1. `payments_open_renewal_intent` partial unique index.
2. `payments.renewal_duration_days` snapshot column.
3. `listing_reports` reason-code check constraint.
4. DRAFT/inactive `LISTING_EXPIRY_REMINDER` template registration.

No accepted migration was modified. The notifications/outbox schema
(4.2) needed no changes — `dedupe_key`, retry, and status fields were
designed for exactly this phase.

## Launch checkpoints

- **WhatsApp BSP**: integrate a real provider behind
  `WhatsAppNotificationProvider`, register + approve the
  `LISTING_EXPIRY_REMINDER` template (flip the template row to
  APPROVED/active). Until then production reminders stay safely
  SCHEDULED.
- **CRON_SECRET** must be provisioned in Vercel before any job runs.
- Cron intervals vs. the deployment plan tier.
- Outbox event consumption (analytics/audit fan-out) remains a later
  phase; events accumulate durably meanwhile.
