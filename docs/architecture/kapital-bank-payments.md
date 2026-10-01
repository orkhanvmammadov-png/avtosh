# AVTOSH.AZ — Kapital Bank Payment Integration (Phase 4.12)

Date: 2026-08-26
Status: implemented (LISTING_FEE + PREMIUM/BOOST promotion checkouts
share this foundation since Phase 4.13 — see promotion-purchases.md;
renewal purchases and refund workflows are later phases)

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

**OFFICIALLY DOCUMENTED / DIRECTLY OBSERVED** (the only statuses that
carry mapped semantics): `Order_SMS`, Basic Auth, the `ID`/`STATUS`
callback pattern, the warning that callback STATUS may be temporary,
`GET /order/{ID}` as verification authority, and the statuses
`Preparing`, `FullyPaid`, `Refunded`.

| Kapital status | Evidence | Attempt | Internal payment |
| --- | --- | --- | --- |
| `Preparing` | official | active | `PENDING` |
| `FullyPaid` | official | terminal, succeeded | `SUCCESS` + fulfillment (only after exact amount+currency match) |
| `Refunded` | official | terminal | `REFUNDED` (never fulfills) |
| **everything else** — incl. `Cancelled`, `Declined`, `Expired` | **UNCONFIRMED** | recorded, stays active (non-terminal) | unchanged `PENDING` — never SUCCESS, never fulfilled, **no automatic re-arm**; `unknown_provider_status` observability; held for reconciliation/operations |

`Cancelled`/`Declined`/`Expired` appear only in third-party wrappers,
which are NOT authoritative provider contract; terminal semantics are
deliberately NOT inferred from their English names. If a captured
Kapital sandbox response later proves an exact status and its
semantics, the evidence must be documented here before any mapping is
added. Regression tests pin the UNKNOWN behavior for all three plus a
synthetic `SomethingNew`.

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
non-terminal attempt per payment** — the database-level initiation
claim (next section) that guarantees concurrent requests cannot even
CALL the provider twice, let alone mint two authoritative checkouts.
`hpp_secret` (the order
password needed to reopen the HPP) lives only in this table and is
cleared the moment an attempt terminalizes; it never appears in DTOs
or logs — the UI receives one opaque `checkout_url`.

## Checkout initiation claim (no orphan orders)

A durable DB claim precedes every provider call: an INITIATING
attempt row (`provider_order_id IS NULL`) is inserted under the
payment row lock, guarded by the one-active partial unique index —
for N concurrent checkout requests exactly ONE obtains the claim and
performs `POST /order` (regression: 10 simultaneous requests → 1
provider call, 1 attempt); the rest wait briefly on the claim filling
in (bounded 16×250 ms poll of the row, no locks held) and reuse the
result. No transaction is held across the network call.

**Ambiguous POST recovery:** a crash after claiming (or a NETWORK
timeout where Kapital may or may not have created an order) leaves an
INITIATING row whose age is the lease (120 s). The next checkout
terminalizes it as `InitiationAbandoned`/`InitiationAmbiguous` —
honest audit, never overwritten — and takes a fresh claim. Creating a
fresh order is safe because any order the provider may have created
in the ambiguous window is UNPAYABLE: its HPP password never left the
failed request, so nobody can open its payment page and it can only
expire unpaid. Definite create failures release the claim the same
way (`InitiationFailed`) and surface `PAYMENT_CHECKOUT_UNAVAILABLE`.

## Idempotency / exactly-once

- Checkout: active attempt → reused; the initiation claim (above)
  makes the provider side effect at-most-once under concurrency.
- Verification: `GET /order/{id}` runs outside the transaction; the
  transition runs under the payment row lock with a terminal-state
  short-circuit — repeated callbacks, refreshes, concurrent
  verifications and reconciliation all settle into ONE fulfillment
  (one status-history pair, one `LISTING_ENTERED_MODERATION` +
  `PAYMENT_SUCCEEDED` outbox event).
- Lock order inside payment flows: payments → listings. The submit
  path locks users → listings and only inserts payments, so the
  orders cannot deadlock.
- Verification and fulfillment are SESSION-INDEPENDENT: the callback
  route runs them for any structurally valid order id that maps to
  one of our attempts, whether or not an AVTOSH session exists — an
  expired session can never block a legitimate FullyPaid fulfillment.
  The session only controls result-page personalization (below).

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

Only initiation failures release the claim and re-offer "Ödəniş et".
Unconfirmed provider statuses do NOT auto-re-arm the intent — the
payment stays `PENDING` with its attempt open until reconciliation/
operations resolve it (a future confirmed terminal mapping, or an
operations action that terminalizes the attempt and returns the
intent to `CREATED`). A failed VERIFICATION network call changes
nothing (`CHECK_FAILED` → "Ödəniş yoxlanıla bilmədi" + "Yenidən
yoxla"). A browser leaving the HPP changes nothing — only
provider-confirmed states move state.

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
- **Result-page privacy:** only a session belonging to the payment
  owner sees the personalized outcome. Anonymous viewers, foreign
  sessions, unknown ids and malformed ids all receive ONE
  indistinguishable generic view ("Ödəniş statusu yoxlanıldı…" with a
  login link back to the result URL) — the callback can never be used
  to enumerate order ids, and it exposes no seller identity, listing
  data, amounts, payment/listing UUIDs, or provider internals to
  non-owners. Unknown ids trigger no provider call.

## Local fake provider & tests

`PAYMENT_FAKE_KAPITAL=1` (refused in production) enables dev-only
routes: `/api/dev-kapital/order[…]` (the documented contract with
Basic-Auth checking) and a fake HPP that only simulates outcomes —
the REAL adapter runs against it over HTTP in E2E, so request shape,
auth and parsing are exercised end to end. Integration tests inject a
deterministic in-memory client via `setPaymentProviderForTesting`.
Nothing in the automated suites touches the live provider or the
network.

## Manual live smoke test (test terminal or PRODUCTION)

`scripts/payments/kapital-smoke.mts` — manual only, never in CI.
Requires `KAPITAL_SMOKE=1` plus env credentials loaded from the
local chmod-600 env file (never pasted into chat/commits/CI). Two
modes:

- **Create** (default): creates one `Order_SMS`. Everything is
  explicit and fail-closed REGARDLESS of host (Owner decision:
  direct production, no sandbox phase): `KAPITAL_API_BASE_URL` must
  parse to exactly one of the two intended Kapital origins (URL
  origin comparison, never a substring check);
  `KAPITAL_SMOKE_CONFIRM_PRODUCTION=YES` is always required;
  `KAPITAL_SMOKE_AMOUNT` must be explicitly supplied (no default,
  hard-capped); `NEXT_PUBLIC_APP_URL` must be explicit (no
  localhost fallback) and HTTPS for a production order. The checkout
  URL embeds the order password, so it is **never printed** — it is
  written exclusively (`O_EXCL`, born 0600, never overwritten, never
  through a symlink) to `~/.avtosh/kapital-smoke-url.txt`; an
  existing file or symlink at that path refuses the run BEFORE any
  order is created. Open the file locally, pay manually, then delete
  it. Gating lives in `kapital-smoke-guards.mts` and is unit-tested.
- **Verify**: `KAPITAL_SMOKE_ORDER_ID=<id>` re-reads the order over
  the authenticated API — the authoritative status check; the
  browser STATUS parameter is never trusted.

## Production merchant integration decisions (Owner)

- The direct production terminal is used without a bank sandbox
  phase (Owner decision). The controlled first charge follows the
  smoke procedure above with an Owner-approved amount and card.
- **Refund / Reversal** (`POST /order/{ID}/exec-tran` with
  `type: Refund` or `voidKind`): documented by the bank but
  **deliberately not implemented**. Automatic refunds are a
  moderation/operations policy decision, not a technical default.
  Open decisions before any refund code: who may trigger one (role),
  against which payment states, full vs. partial, same-day reversal
  vs. refund selection, audit trail, and reconciliation of
  `Refunded`/`Voided` responses. Until then, refunds are executed by
  the Owner directly with the bank, and the existing `Refunded`
  status handling marks the payment REFUNDED on the next
  authenticated read.
- Only wire-proven status strings are mapped (`Preparing`,
  `FullyPaid`, `Refunded`). The bank's status table lists display
  names ("Being prepared", "Partially paid", …) whose exact wire
  spellings the document does not prove; every unproven status is
  recorded verbatim, logged as `unknown_provider_status`, is never
  SUCCESS, never fulfills, and is surfaced for operations review.
  Reconciliation keeps re-checking pending payments; a payment that
  never reaches `FullyPaid` is bounded by the attempt/stale flow and
  the buyer can retry.

## Env vars

`KAPITAL_API_BASE_URL`, `KAPITAL_USERNAME`, `KAPITAL_PASSWORD`,
`KAPITAL_TIMEOUT_MS` (default 10 s), `KAPITAL_ALLOWED_HPP_HOSTS`
(extra HPP hosts; API host always allowed; HTTPS enforced in
production), plus `NEXT_PUBLIC_APP_URL` for the redirect URL.

## Production bank smoke — PASS (2026-10-01, Owner-run)

The controlled production smoke on the live merchant terminal
PASSED: the Owner completed one real 1.00 AZN payment through the
Kapital HPP, and the authenticated verify read returned
`status: FullyPaid` with `amountMinor: 100`, `currency: AZN` — an
exact amount/currency match. The private checkout-URL file was
deleted after use. No order id, credentials, payment URLs or card
data are recorded here.

Scope of this PASS — the WIRE contract only:
- It is NOT application end-to-end payment UAT. `LAUNCH_MODE` is
  still READ_ONLY, so listing fulfillment and the moderation
  transition remain UNVERIFIED in live production; they are covered
  by the automated suites and will be exercised live only after the
  later reviewed FULL release.
- An earlier attempt ended `Declined` and remains UNEXPLAINED (open
  item; the redirect audit established no merchant-side redirect
  defect, and no redirect fix is claimed). Not all payment
  scenarios have passed — exactly one successful purchase has.
- Refund of the controlled charge is DEFERRED by the Owner — open
  item, not completed.

## Production checklist (direct-production, Owner decision)

There is NO bank sandbox phase. While `LAUNCH_MODE=READ_ONLY`, the
public checkout stays closed, so the controlled bank smoke proves
the WIRE contract only — create order, HPP payment, authenticated
status read with exact amount/currency — and **cannot prove listing
fulfillment** (no payment-to-listing path runs in read-only mode;
fulfillment is exercised by the integration/E2E suites and verified
live only after a later reviewed FULL release).

1. Owner obtains production merchant credentials; locally they go
   only into the chmod-600 env file, and for deployment only into
   the Vercel **Production** secret environment — never Preview,
   never chat, never git.
2. Run the controlled production smoke (see above): explicit
   Owner-approved `KAPITAL_SMOKE_AMOUNT`,
   `KAPITAL_SMOKE_CONFIRM_PRODUCTION=YES`, explicit HTTPS
   `NEXT_PUBLIC_APP_URL`; pay once with the Owner-approved card from
   the 0600 URL file, delete the file, then confirm `FullyPaid` with
   the exact amount/currency via verify mode.
3. Record the raw (redacted) status strings observed so the unproven
   wire spellings can be mapped with evidence; refund the controlled
   charge directly with the bank (no code path).
4. Confirm the production `hppUrl` host and set
   `KAPITAL_ALLOWED_HPP_HOSTS` if it differs from the API host.
5. Full release (separate, reviewed): `LAUNCH_MODE=FULL`, crons
   restored, and only then does live checkout exercise fulfillment.

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
