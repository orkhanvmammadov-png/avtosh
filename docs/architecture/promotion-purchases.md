# AVTOSH.AZ — Premium & Boost Purchases (Phase 4.13)

Date: 2026-08-27
Status: implemented (renewal purchases, refund workflows, and admin
pricing UI are later phases)

## Packages & pricing authority

`promotion_packages` rows (migration 007, seeded by migration 018)
are the configurable pricing source of truth: PREMIUM and BOOST ×
1/3/7 gün, integer minor units, `is_active` toggle, admin-editable
later.

**Production pricing safeguard:** the seeded `price_minor` values are
UNAPPROVED placeholders, so migration 018 ships every package with
`is_active = false` — nothing is sellable by default. Activating a
package requires explicit owner price approval followed by setting
the approved `price_minor` and `is_active = true` on the row (until
an admin pricing UI exists, via a controlled SQL/operations change).
Server-side eligibility is authoritative: inactive packages are
invisible to the packages API and unpurchasable (regression: no
payment intent, no Kapital checkout, no promotion period); there is
no frontend exception, and the seller purchase page renders a safe
"Təşviq paketləri hazırda əlçatan deyil." state when no active
packages exist. Test environments activate packages explicitly as
fixture data (integration `beforeAll`, E2E seed) — the disabled
production default itself is regression-tested.

The browser sends only listing + type + package id;
the server resolves duration/price/currency from the enabled package
row and freezes them into the payment intent
(`payments.promotion_package_id`, `package_duration_days`,
`package_price_minor`, `amount_minor`). A later package-price change
never alters an existing intent — the LISTING_FEE snapshot invariant
reused and regression-tested (checkout verified and fulfilled at the
snapshot after the configured price rises).

## Payment linkage

`payment_type` PREMIUM/BOOST (accepted enum) + `payments.listing_id`
+ the package snapshot answer "what should this SUCCESS fulfill"
unambiguously. No LISTING_FEE overloading; no schema changes beyond
migration 018 (seeds + one partial unique index).

## Kapital reuse

The purchase POST creates/reuses the intent and calls the SAME
Phase 4.12 core (`runProviderCheckout`): initiation claim →
at-most-one `POST /order` → HPP URL → callback →
session-independent `GET /order/{id}` verification with exact
amount/currency matching → reconciliation. No promotion-specific
adapter, callback, checkout, or verification exists.

## Purchase idempotency

Partial unique index `payments_open_promotion_intent`: at most one
OPEN (CREATED or PENDING) promotion intent per (listing, type).
Double clicks, repeats, and concurrent POSTs converge on the single
intent and reuse its checkout (10-way regression: one intent, one
provider order). A different-package repeat replaces an UNSTARTED
(CREATED) intent — no provider order exists, nothing payable is
discarded; while a checkout is in flight the package cannot switch
(`PROMOTION_PAYMENT_PENDING` 409 — the open HPP could still be paid).
The moment an intent terminalizes, the next purchase opens fresh —
sequential purchases are never blocked.

## Fulfillment & extension semantics

`verifyProviderPayment`'s success branch dispatches by payment type
inside the SAME transaction as the payment SUCCESS transition:
LISTING_FEE → listing submission fulfillment (unchanged);
PREMIUM/BOOST → `fulfillPromotion`: lock the listing row (payments →
listings order), then ONE INSERT computes the period entirely in SQL:

```
starts_at = GREATEST(now(),
            max(ends_at) of same-type SCHEDULED/ACTIVE rows
            still ending in the future)
ends_at   = starts_at + snapshot duration
status    = ACTIVE if starting now, SCHEDULED if queued
```

- Active same-type promotion → the new period queues after its end
  (Sep 10 + 3 days bought Sep 7 → Sep 13). Paid time is never lost.
- Expired prior period → never extends; the new period starts at
  fulfillment time.
- The base never round-trips through JavaScript dates (microsecond
  truncation would break exact abutting under the `[)` exclusion
  constraint).

Three independent layers protect paid duration: the open-intent index
(same-type concurrent unpaid intents are structurally impossible) →
the listing row lock (serializes concurrent fulfillments; +3d/+7d
concurrent regression lands exactly 10 abutting days) → the GiST
exclusion constraint (any residual overlap is refused by the DB).

Exactly-once: repeated/refreshed/anonymous callbacks, concurrent
verifications, and reconciliation settle into ONE period insert (buy
3 days, callback ×20 → 3 days, regression-pinned).

## Premium + Boost coexistence

Different types never conflict (exclusion constraint is per type);
both active simultaneously is regression-tested at DB, service, and
E2E level (both badges on the public detail).

## Public behavior

Phase 4.8 read models remain authoritative and unchanged: the time
window is truth (`starts_at <= now() < ends_at`, status
SCHEDULED/ACTIVE), so a fulfilled period appears in the Home Premium
feed / Boost search placement immediately and disappears at expiry
with no worker involvement (Phase 4.16's expiry job only flips
lagging status labels).

## Listing lifecycle interaction

Promotion never touches `current_expires_at` (regression-asserted).
Public promotion behavior additionally requires the listing itself to
be publicly visible — when a listing expires or is SOLD, its
remaining paid promotion time simply stops being publicly effective;
if SUSPENDED, paid time keeps running while hidden. No automatic
compensation/refund rules are invented; unused time is a documented
business-policy checkpoint.

## Refund checkpoint

If Kapital later reports `Refunded` for a fulfilled promotion
payment, the payment maps to REFUNDED and is never re-fulfilled, but
NO automatic promotion rollback occurs (no accepted business rule
exists). The REFUNDED payment + the untouched promotion period are
the flag for business reconciliation — operations checkpoint.

## APIs

- `GET /api/v1/me/promotion-packages` — active packages,
  server-priced DTOs (auth required, no-store).
- `POST /api/v1/me/listings/:id/promotions/checkout`
  `{ type: PREMIUM|BOOST, package_id }` — auth + owner + active
  seller + listing ACTIVE & unexpired + enabled package + same-origin;
  strict schema (browser price fields are rejected); returns one
  opaque `checkout_url`. Errors: `LISTING_NOT_FOUND` 404 ·
  `PROMOTION_NOT_AVAILABLE` 409 · `PROMOTION_PACKAGE_NOT_FOUND` 404 ·
  `PROMOTION_PAYMENT_PENDING` 409 · `PAYMENT_CHECKOUT_UNAVAILABLE`
  503 · `USER_BLOCKED` 403.

## UI

My Listings ACTIVE cards: "İrəli çək" plus server-derived status
lines ("Premium aktivdir — DD.MM.YYYY tarixinədək"). Purchase page
`/profil/elanlar/:id/tesviq`: type tabs, server-priced package
radios, confirmation summary (listing/xidmət/müddət/qiymət),
"Ödəniş et" → HPP. Result page: "Premium aktiv edildi" / "Boost
aktiv edildi" + end date only after verified success; pending /
mismatch / failure states never claim activation. Dates format via
`formatDateAz` (Asia/Baku).

## Observability / audit

Structured events: `promotion_purchase_created`,
`payment_succeeded`, `promotion_activated` / `promotion_extended`
(scrubbed, no secrets/payloads); outbox `PROMOTION_ACTIVATED` +
`PAYMENT_SUCCEEDED` (server-side business events); append-only
`audit_logs` row (`PROMOTION_ACTIVATED`, SYSTEM actor) per
activation.

## Tests

Unit: date formatting, package price display. Integration (27,
incl. the disabled-by-default production safeguard):
package API, eligibility matrix, pricing immutability, double-click +
10-way checkout concurrency (one provider order), package switching,
activation (+ lifecycle untouched + audit/outbox), sequential
extension per type, expired-prior handling, coexistence, expiry
regression, exactly-once under 10-way verification, concurrent
+3d/+7d fulfillment (10 abutting days), callback-status impotence,
amount mismatch, reconciliation. E2E (8 × 3 viewports): full Premium
purchase to Home-feed appearance, Boost + coexistence with public
badges, pending/tampered callback never activates, wrong amount held
safely, repeated callbacks add duration once, extension from current
end, non-active listing refusal, zero-active-package safe state.
Visual-review screenshots via the fake HPP.
