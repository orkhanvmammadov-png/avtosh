# AVTOSH.AZ — Kapital Bank Payment Integration (Phase 4.12)

Date: 2026-08-26
Status: implemented (LISTING_FEE checkout only; Boost/Premium/renewal
purchases and refund workflows are later phases)

Provider contract: the official Kapital Bank e-commerce API
(https://pg.kapitalbank.az/docs).

## Environments & auth

| | Base URL |
| --- | --- |
| Test | `https://txpgtst.kapitalbank.az/api` |
| Production | `https://e-commerce.kapitalbank.az/api` |

HTTP Basic Auth (`KAPITAL_USERNAME:KAPITAL_PASSWORD`). The
Authorization header is constructed only inside
`src/providers/payments/kapital-provider.ts`; it is never persisted,
logged, returned in responses, or exposed via `NEXT_PUBLIC_*`.
Configuration (`src/lib/config/kapital.ts`) is lazy and fails closed:
without `KAPITAL_API_BASE_URL/USERNAME/PASSWORD` every checkout and
verification returns a safe `PAYMENT_CHECKOUT_UNAVAILABLE` /
CHECK_FAILED — nothing pretends to work.

## Flow

```
PAYMENT_REQUIRED listing (immutable CREATED LISTING_FEE intent,
                          Phase 4.6/4.11)
  → POST /api/v1/me/listings/:id/payment/checkout   (owner-only)
  → adapter: POST {base}/order  { order: { typeRid: "Order_SMS",
        amount: "2.00", currency: "AZN", language: "az",
        description, hppRedirectUrl } }
  → response order.id / order.password / order.hppUrl (validated)
  → attempt row persisted, payment CREATED → PENDING
  → browser → {hppUrl}?id={id}&password={password}   (Hosted Payment Page)
  → buyer pays on Kapital's page (AVTOSH never touches PAN/CVV)
  → Kapital redirects to /odenis/kapital/netice?ID=…&STATUS=…
  → server calls GET {base}/order/{ID}                (Basic Auth)
  → verified FullyPaid + exact amount + exact currency
  → payment SUCCESS → listing PAYMENT_COMPLETED → PENDING_MODERATION
```

## Why callback STATUS is untrusted

The documented flow redirects the browser back with `ID`/`STATUS`
query parameters, and the documentation itself warns the callback
status may be temporary. Query parameters are attacker-writable in
any case. Therefore **callback STATUS is never read for state**: the
only authority is the authenticated server-to-server
`GET /order/{ID}` (Get Order Details). No webhook is documented by
Kapital; none was invented. The provider abstraction
(`src/providers/payments/types.ts`) leaves room to add an official
webhook capability later.

## Money conversion

AVTOSH stores integer minor units; Kapital speaks major-unit decimal
strings. `src/lib/payments/money.ts` converts exactly with
integer/string math only: `200 → "2.00"`, `1 → "0.01"`; provider
amounts are parsed with a strict decimal regex (`2`, `2.5`, `2.50`);
anything else is rejected and therefore can never match/fulfill.
Currency must equal the intent's `AZN` exactly.

## Status mapping

| Kapital status | Source | Attempt | Internal payment |
| --- | --- | --- | --- |
| `Preparing` | official docs | active | `PENDING` |
| `FullyPaid` | official docs | terminal, succeeded | `SUCCESS` + fulfillment (only after exact amount+currency match) |
| `Refunded` | official docs | terminal | `REFUNDED` (never fulfills) |
| `Cancelled` | wrapper-observed contract¹ | terminal | back to `CREATED` (retry available) |
| `Declined` | wrapper-observed contract¹ | terminal | back to `CREATED` |
| `Expired` | wrapper-observed contract¹ | terminal | back to `CREATED` |
| anything else | — | recorded, stays active | unchanged (`PENDING`); logged `unknown_provider_status`; reconciliation retries — **never SUCCESS** |

¹ Confirmed by maintained open-source clients of this API; the
official SPA docs could not be machine-read (see Ambiguities). To be
re-confirmed against the owner's documentation access.

`FullyPaid` with an amount or currency mismatch does **not** fulfill:
the attempt stays open, an `amount_currency_mismatch` operations
event is recorded, and the seller sees the safe "not yet confirmed"
state (never "pay again").

## Intent snapshot & attempts (migration 017)

The Phase 4.6 `payments` row (linked via
`listing_publications.payment_id`) remains the single business
amount — checkout always charges the snapshot, immune to later
`listing.publication_fee_minor` changes (Phase 4.11 invariant,
re-tested here). `payment_provider_attempts` (additive migration 017)
records every provider checkout: `UNIQUE (provider,
provider_order_id)` plus a **partial unique index allowing one
non-terminal attempt per payment** — the database-level guarantee
that double clicks / concurrent requests cannot mint two
authoritative checkouts (the loser's provider order becomes a
harmless unpaid orphan that expires). `hpp_secret` (the order
password needed to reopen the HPP) lives only in this table and is
cleared the moment an attempt terminalizes; it never appears in DTOs
or logs — the UI receives one opaque `checkout_url`.

## Idempotency / exactly-once

- Checkout: active attempt → reused; provider create runs OUTSIDE any
  DB transaction; persistence re-locks the payment and the partial
  unique index arbitrates races.
- Verification: `GET /order/{id}` runs outside the transaction; the
  transition runs under the payment row lock with a terminal-state
  short-circuit — repeated callbacks, refreshes, concurrent
  verifications and reconciliation all settle into ONE fulfillment
  (one status-history pair, one `LISTING_ENTERED_MODERATION` +
  `PAYMENT_SUCCEEDED` outbox event).
- Lock order inside payment flows: payments → listings. The submit
  path locks users → listings and only inserts payments, so the
  orders cannot deadlock.
- Ambiguous create-order network outcome: the payment stays `CREATED`
  with no attempt row; retry simply creates a fresh order (a possible
  unpaid orphan on the provider side expires harmlessly).

## Fulfillment

One central path (`verifyProviderPayment` →
`fulfillListingFee`): payment `SUCCESS` (+`paid_at`,
`fulfillment_status FULFILLED`, `provider_transaction_id` when
reported), listing `PAYMENT_REQUIRED → PAYMENT_COMPLETED →
PENDING_MODERATION` with `submitted_at = now()` (queue entry starts at
payment, per Phase 4.6), two SYSTEM-actor status-history rows, outbox
events. The callback page, "Yenidən yoxla", and reconciliation all
call this same function.

## Retry & recovery

Terminal non-success attempt → payment returns to `CREATED`; the
PAYMENT_REQUIRED screen offers "Ödəniş et" again and a fresh provider
order is created; previous attempts remain as append-only audit. A
failed VERIFICATION network call changes nothing (`CHECK_FAILED` →
"Ödəniş yoxlanıla bilmədi" + "Yenidən yoxla"). A browser leaving the
HPP changes nothing — only provider-confirmed states move state.

## Reconciliation

`reconcileProviderPayments({ olderThanSeconds, limit })` scans
`PENDING` Kapital payments (partial index `payments_pending_provider`)
and runs the same verify-and-fulfill path. Phase 4.16 schedules it as
a recurring job (idempotent, safe to overlap with user traffic); until
then it is service-invocable and integration-tested.

## Seller UX

- PAYMENT_REQUIRED screens show the immutable intent amount and
  "Ödəniş et" (loading + safe initiation-failure retry).
- `/odenis/kapital/netice` result states: uğurla tamamlandı /
  hələ təsdiqlənməyib (+ never "pay again" while the card may be
  charged) / tamamlanmadı (+ retry) / yoxlanıla bilmədi (+ yenidən
  yoxla) / generic "tapılmadı" for unknown or foreign order ids (no
  existence disclosure, no provider probing).
- Session expired during payment → login with `return_to` back to the
  result URL.

## Local fake provider & tests

`PAYMENT_FAKE_KAPITAL=1` (refused in production) enables dev-only
routes: `/api/dev-kapital/order[…]` (the documented contract with
Basic-Auth checking) and a fake HPP that only simulates outcomes —
the REAL adapter runs against it over HTTP in E2E, so request shape,
auth and parsing are exercised end to end. Integration tests inject a
deterministic in-memory client via `setPaymentProviderForTesting`.
Nothing in the automated suites touches the live provider or the
network.

## Optional live sandbox smoke test

`scripts/payments/kapital-sandbox-smoke.mts` — manual only, requires
`KAPITAL_SANDBOX_SMOKE=1` + env credentials; creates a 0.01 AZN
Order_SMS (no charge until a card pays), prints the checkout URL for
a manual HPP walk-through (test cards: official Kapital docs — never
copied into this repo), and reads the order back. CI never runs it.

## Env vars

`KAPITAL_API_BASE_URL`, `KAPITAL_USERNAME`, `KAPITAL_PASSWORD`,
`KAPITAL_TIMEOUT_MS` (default 10 s), `KAPITAL_ALLOWED_HPP_HOSTS`
(extra HPP hosts; API host always allowed; HTTPS enforced in
production), plus `NEXT_PUBLIC_APP_URL` for the redirect URL.

## Production checklist

1. Obtain merchant credentials; set the four `KAPITAL_*` vars and
   `NEXT_PUBLIC_APP_URL` in the production environment.
2. Run the sandbox smoke test against the test environment; complete
   one manual HPP payment with the bank's test card and verify the
   listing reaches PENDING_MODERATION.
3. Confirm the production `hppUrl` host and add it to
   `KAPITAL_ALLOWED_HPP_HOSTS` if it differs from the API host.
4. Confirm callback parameter names and the full status vocabulary
   against the owner's Kapital documentation access (see below).
5. Schedule reconciliation (Phase 4.16).

## Documentation ambiguities (explicit)

The official docs site is a JavaScript SPA that could not be rendered
server-side during this phase. The contract implemented here comes
from the brief's quoted semantics (Order_SMS flow, ID/STATUS
callback, callback-status warning, Get Order Details authority,
Preparing/FullyPaid/Refunded) cross-checked against maintained
open-source clients of the same API. Remaining to confirm with direct
docs access: exact callback parameter casing, the complete status
vocabulary (`Cancelled`/`Declined`/`Expired` and any others such as
partial-payment states), and the error envelope (`errorCode`). The
conservative design means a wrong guess degrades to "stays pending +
reconciliation", never to a wrong SUCCESS.
