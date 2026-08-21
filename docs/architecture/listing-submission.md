# Listing Submission & Publication Allocation (Phase 4.6)

Date: 2026-08-21
Status: implemented (payment-provider fulfillment and moderator
actions are later phases)

Turns a completed DRAFT into the initial publication flow: lifetime
first-3-free accounting, FREE → moderation queue, PAID → waiting for
an internal LISTING_FEE payment intent. Nothing becomes public here.

## Endpoints

- `GET /api/v1/me/listing-quota` — advisory quota computed from the
  immutable `listing_publications` history (BLOCKED users may read).
  Never trusted by submit: two listings can be submitted after the
  quota screen; the submit transaction is authoritative.
- `POST /api/v1/me/listings/:id/submit` `{ expected_revision }` —
  session identity only, same-origin guard, `requireActiveSeller`
  (BLOCKED → 403). No client price/number/billing input exists (the
  strict schema rejects it).

## Completeness (submission is not sparse)

Required persisted values: brand, model, year, price, mileage, city,
contact phone (→ `LISTING_INCOMPLETE` with `missing` codes); at least
`listing.image_min` (3) **confirmed** `listing_images` — PENDING
uploads never count — and exactly one primary image (→
`LISTING_INSUFFICIENT_IMAGES`). Optional fields stay optional. Then
**catalog revalidation against current data** (reusing the catalog
repository): category, brand∈category, model∈brand+category, city,
every selected reference option (group + category scope), every
feature — all must be active now (→
`LISTING_INVALID_CATALOG_SELECTION` with `field`).

## The transaction (lock order: users → listings)

```
BEGIN
  settings (fail closed)            listing.free_publication_limit,
                                    listing.publication_fee_minor,
                                    listing.image_min
  SELECT users FOR UPDATE           per-user serialization
  SELECT listings FOR UPDATE        owner-scoped
  publication exists?  → return existing result (idempotent retry)
  status = DRAFT, revision = expected_revision  (else 409)
  completeness + catalog revalidation
  n = MAX(publication_number)+1 for user
  n ≤ free_limit → FREE            n > free_limit → PAID:
                                     INSERT payments (LISTING_FEE,
                                     amount = setting, AZN, provider
                                     NULL, CREATED/PENDING,
                                     idempotency_key =
                                     listing_fee:initial:<listing_id>)
  INSERT listing_publications (n, billing_type, payment_id)
  UPDATE listings: FREE → PENDING_MODERATION + submitted_at = now()
                   PAID → PAYMENT_REQUIRED (submitted_at stays NULL)
  UPDATE listing_image_uploads PENDING → EXPIRED for the listing
  INSERT listing_status_history (DRAFT → …, actor USER)
  INSERT outbox_events (LISTING_ENTERED_MODERATION |
                        LISTING_PAYMENT_REQUIRED)
COMMIT
```

No network/provider calls inside. Image and draft flows lock only
the listing row, so the users→listings order cannot deadlock with
them. The UNIQUE constraints (`listing_id`, `(user_id,
publication_number)`, payments `idempotency_key`) are defense in
depth behind the user lock.

## Rules encoded

- **First 3 free, #4+ paid** — limit and fee come from
  `system_settings` at submit time; missing/corrupt values fail
  closed with `LISTING_PAYMENT_CONFIGURATION_ERROR` (no silent
  fallback for money). Currency is AZN (payments default; not
  separately modeled).
- **What consumes a publication**: only the first successful submit
  of a NEW listing. Deletion, rejection, correction/resubmit, editing,
  renewal never create another row (`listing_id UNIQUE`).
- **submitted_at = moderation-queue entry**: set on FREE submit,
  left NULL on PAID until payment fulfillment moves the listing into
  PENDING_MODERATION (future phase).
- **Revision**: submission is a pure state transition — the content
  revision is NOT incremented; the listing is frozen afterwards (all
  Phase 4.5 mutation APIs reject non-DRAFT with
  `LISTING_NOT_EDITABLE`; regression-tested).
- **Idempotency**: a retry (same or concurrent request) finds the
  existing publication under the locks and returns the identical
  result — one publication, ≤ one payment intent, one history row,
  one outbox event (tested with 4 concurrent submits).
- **Not activation**: `listing_publications` is lifetime accounting.
  `published_at`, `current_expires_at`, `listing_periods`,
  moderation reviews/claims are all untouched. Only future moderator
  approval activates the first 30-day period.

## Internal payment intent

Pre-provider intents need no provider, so migration 014 relaxed
`payments.provider` to nullable with `CHECK (provider IS NOT NULL OR
status IN ('CREATED','CANCELLED'))` — a payment cannot progress
(PENDING/SUCCESS/FAILED/REFUNDED) without a real provider. No
provider name, order, transaction id, checkout URL, or SUCCESS state
is ever fabricated. The dedicated payment phase will attach the
provider, handle hosted checkout + verified webhooks, and perform
`PAYMENT_REQUIRED → PAYMENT_COMPLETED → PENDING_MODERATION`.

## Boundaries

- Payment provider integration: **not implemented**.
- Moderator approve/reject/correction/suspend/claim: **not
  implemented** — FREE listings merely sit in the
  `PENDING_MODERATION` queue (existing partial index on
  `submitted_at`).
- Temporary upload objects of invalidated uploads remain for the
  future cleanup worker; correctness never depends on it.
