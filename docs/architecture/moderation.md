# Moderation & Listing Activation (Phase 4.7)

Date: 2026-08-21
Status: implemented (backend/API only — Moderator Portal UI, public
marketplace, payment fulfillment, expiry/notification workers are
later phases)

## Staff authorization

`requireStaff` = authenticated + not BLOCKED + role ∈ {MODERATOR,
ADMIN, SUPER_ADMIN}. A blocked account has no staff access. The
actor is always the session user; decision bodies are strict schemas,
so `moderator_id`/role fields are rejected. Normal USERs get
`STAFF_ROLE_REQUIRED` 403 on every `/api/v1/moderator/*` route.

## Queue — `GET /moderator/listings`

`status = 'PENDING_MODERATION'` ordered `submitted_at ASC, id ASC`
(oldest first, uses the `listings_moderation_queue` partial index);
keyset pagination with an opaque cursor (full-precision
`submitted_at` text + id — a Date-typed cursor would lose
microseconds and repeat boundary rows). PAYMENT_REQUIRED and ACTIVE
listings are structurally excluded. Items carry labels, seller-safe
summary (masked phone), primary-image signed URL, and live-claim
state. `GET /moderator/listings/:id` returns the full review view
(labels, ordered images via signed URLs, feature ids, review history,
claim) — never storage paths.

## Claims — `POST /moderator/listings/:id/claim`

Operational coordination (10 min TTL, `MODERATION_CLAIM_TTL_SECONDS`).
Inside a transaction with the listing row locked: listing must be
PENDING_MODERATION; a live claim (`released_at IS NULL AND expires_at
> now()`) by the same moderator is extended (safe retry); by another
moderator → `MODERATION_CLAIMED_BY_OTHER` 409 (no silent takeover);
an expired claim is released and replaced. The partial unique index
(`listing_id WHERE released_at IS NULL`) is defense in depth; a
concurrent two-moderator claim yields exactly one winner (tested).
Claims are operational rows: decisions set `released_at` (kept, not
deleted); correctness never depends on cleanup.

## Decisions — approve / reject / request-correction

**Claim policy (strict, all roles)**: a decision requires a live claim
owned by the acting moderator — no ADMIN override (simplest and
safest for MVP; `MODERATION_CLAIM_REQUIRED` / `…CLAIMED_BY_OTHER`).

One transaction per decision:
```
lock listing FOR UPDATE
status = PENDING_MODERATION  (else idempotency check, see below)
revision = expected_revision (else 409 LISTING_REVISION_CONFLICT)
live claim owned by actor
INSERT moderation_reviews (listing_revision, decision, reason, note)
approve: validity = listing.validity_days (fail closed)
         period #n = MAX+1 (1 = INITIAL) [now, now + validity)
         listings: ACTIVE, published_at = COALESCE(published_at, now),
                   current_expires_at = period.ends_at
reject / correction: listings → REJECTED / CORRECTION_REQUIRED
INSERT listing_status_history (actor USER = moderator's user row)
INSERT outbox_events (LISTING_ACTIVATED | LISTING_REJECTED |
                      LISTING_CORRECTION_REQUESTED)
release claim
```
No network calls inside. Reviews are immutable history; reason codes
are a controlled enum, notes ≤ 1000 chars plain text (never rendered
as HTML).

**Idempotency**: a retry that finds the listing no longer pending
returns the existing decision only if an identical review exists
(same listing_revision, moderator, decision); anything else is
`MODERATION_INVALID_STATE` 409 with the current status. Duplicate
side effects are impossible — races serialize on the row lock
(approve-vs-approve → one review/one period; approve-vs-reject → one
winner; tested).

## Activation semantics

- `published_at` = first public activation, set once (`COALESCE`),
  never changed by renewal/reactivation.
- `current_expires_at` = current period end; public queries must
  always use `status = 'ACTIVE' AND current_expires_at > now()` —
  the future expiry worker is never the correctness source.
- Exactly one INITIAL `listing_periods` row per first approval
  (`UNIQUE(listing_id, period_number)` as defense), `payment_id`
  NULL for the initial (free or already-paid) publication.
- Rejection/correction set neither timestamp and create no period.

## Seller side

- **Editable states** are now centralized
  (`SELLER_EDITABLE_STATUSES` = DRAFT, CORRECTION_REQUIRED, REJECTED)
  for field and image mutations, with all Phase 4.5 protections
  (owner, blocked, origin, catalog validation, revision bump, image
  limits/pending-upload rules). PENDING_MODERATION, PAYMENT_REQUIRED,
  ACTIVE and later states stay frozen (ACTIVE editing is a later
  phase).
- **Resubmit** — `POST /me/listings/:id/resubmit {expected_revision}`
  from CORRECTION_REQUIRED/REJECTED: full completeness + current
  catalog revalidation (same checks as initial submission), then
  `→ PENDING_MODERATION` with `submitted_at = now()` (queue/SLA
  restarts), pending uploads EXPIRED, history + outbox
  `LISTING_ENTERED_MODERATION`. **No new publication row, ordinal,
  or LISTING_FEE payment** — the initial publication (free or paid)
  remains authoritative, so a future paid listing that reaches
  moderation resubmits identically. Idempotent on retry. Prior
  reviews remain.

## Boundaries

- Payment fulfillment (`PAYMENT_REQUIRED → PAYMENT_COMPLETED →
  PENDING_MODERATION`): payment phase.
- Expiry worker and 7/5/3/1 reminders: triggered later from
  `LISTING_ACTIVATED` + period data; not implemented.
- Moderator Portal UI, public Home/Search/Detail: later phases.
