# AVTOSH.AZ — Admin Panel (Phase 4.15)

Date: 2026-08-30
Status: implemented (refund initiation deliberately BLOCKED — see
Payments; async workers, renewal, and notifications remain later
phases)

The admin panel is an operational console over dedicated, audited
server commands. No business rule lives in React; every route
re-authorizes on the server, every mutation is a named command, and
nothing in the panel can mutate payment snapshots or audit history.

## Routes & RBAC

| Route | Purpose |
| --- | --- |
| `/admin` | dashboard (operational counts) |
| `/admin/istifadeciler(/[userId])` | users: search, detail, block/unblock, roles |
| `/admin/emekdaslar` | staff-role holders |
| `/admin/elanlar(/[listingId])` | listings ops view + unsuspension |
| `/admin/odenisler(/[paymentId])` | payments view + provider re-verification |
| `/admin/tesviq-paketleri` | promotion package pricing/activation |
| `/admin/kataloq` | catalog activation toggles |
| `/admin/hesabatlar` | listing_reports workflow |
| `/admin/audit` | read-only audit explorer |
| `/admin/tenzimlemeler` | typed system settings |

Guard (`requireAdminPage`): anonymous → `/giris?return_to=…`;
authenticated non-admin (including MODERATOR) and BLOCKED admins →
plain 404 with no panel-existence disclosure. The layout AND every
page run the guard; every API route independently re-authorizes with
`requireAdmin` (active, not blocked, role ∈ ADMIN/SUPER_ADMIN). All
admin mutations additionally pass `assertSameOrigin`. Listing rows
and payment rows show masked owner phones; full numbers are never
serialized to the admin browser.

## ADMIN vs SUPER_ADMIN

| Capability | ADMIN | SUPER_ADMIN |
| --- | --- | --- |
| Dashboard, users, listings, payments, reports, audit, catalog, settings, packages | ✔ | ✔ |
| Block / unblock a normal user or MODERATOR | ✔ | ✔ |
| Block / unblock a SUPER_ADMIN account | ✖ | ✔ |
| Grant / revoke MODERATOR | ✔ | ✔ |
| Grant / revoke ADMIN | ✖ | ✔ |
| Grant / revoke SUPER_ADMIN | ✖ | ✖ (not via API) |
| Change own roles / block self | ✖ | ✖ |

SUPER_ADMIN is provisioned operationally (directly in the database),
never through the API — the role literally does not exist in the
request schema, so self-escalation and last-super-admin lockout are
structurally impossible rather than merely validated. Nobody can
change their own roles or block themselves. MODERATOR role holders
gain no admin surface anywhere (the moderator portal remains their
only staff surface).

## Users

Search is a phone-fragment LIKE filter behind a strict
`^[+0-9]{2,16}$` schema (no query composition from browser input);
listing uses the shared microsecond-safe keyset cursor
(`created_at::text` + id, base64url, regex-validated on decode,
25/page). Block/unblock are audited commands (`USER_BLOCKED` /
`USER_UNBLOCKED` with the reason as data) that lock the user row,
are idempotent on retry, and never delete anything — a blocked user
keeps read access while `requireActiveSeller` already refuses every
mutation path (listings, payments, promotions, favorites writes).
Unblock restores ACTIVE and clears the reason.

## Listings ops & unsuspension policy

The listings view filters by status/category/public id/owner phone
server-side and reuses the accepted moderation detail projection plus
a commerce context (publications, periods, promotions, payments).
There is NO arbitrary status editor — the only listing mutation the
panel offers is the one accepted command:

`POST /api/v1/admin/listings/:id/unsuspend` — SUSPENDED only, inside
one transaction with the row locked:

- `current_expires_at > now()` → **ACTIVE** (the remaining paid time
  simply resumes; nothing is extended),
- otherwise → **EXPIRED**, joining the accepted renewal flow.

Restoration never extends paid listing or promotion time and refunds
nothing. Effects are exactly-once: SYSTEM status-history row
(`ADMIN_UNSUSPEND`), append-only audit (`LISTING_UNSUSPENDED`),
outbox event. Non-SUSPENDED listings → `MODERATION_INVALID_STATE`.
Suspension itself stays a moderator-portal command (Phase 4.14);
admins reach it there via the staff link.

## Payments

The payments view is a safe projection: type, amount, currency,
status, fulfillment status, provider, last attempt status, masked
owner, listing №. The attempt history DTO carries provider order id
and status only — `hpp_secret` (the provider's order password),
`hpp_url`, idempotency keys, Basic Auth material, and raw provider
responses never leave the server. "Provayderdə yoxla" calls
`verifyProviderPayment` — the ONE accepted Phase 4.12
verification/fulfillment path (exact amount+currency match, official
statuses only, exactly-once fulfillment); there is no second Kapital
implementation, and repeated verifies cannot double-fulfill.

**REFUND INITIATION BLOCKED — PROVIDER CONTRACT REQUIRED.** The
official Kapital documentation in the repo evidences a `Refunded`
order state but no officially confirmed refund-initiation contract
usable from our side, and third-party wrappers are not acceptable
evidence. The panel therefore shows a static notice
(`ADMIN.refundBlocked`) and offers no refund action of any kind —
no fake refunds, and no direct transition of a payment to REFUNDED.
When an official contract is obtained, refund initiation will be
designed and reviewed before implementation.

## Promotion packages (closes the Phase 4.13 checkpoint)

`PATCH /api/v1/admin/promotion-packages` updates price and/or
activation. Concurrency is optimistic: the caller must echo the
trigger-maintained `updated_at` version token; a mismatch →
`LISTING_REVISION_CONFLICT` 409 and the UI shows an explicit
conflict panel — two admins can never silently overwrite each other
(no blind last-write-wins for pricing). Activation requires a
positive approved price (the disabled placeholder seeds cannot be
switched on without one). Price changes affect only FUTURE intents:
existing payments carry their immutable amount snapshot, provider
orders were created at the snapshot amount, and fulfillment verifies
against the snapshot — regression-tested end to end (buy at 7 AZN,
raise to 9 AZN, old intent fulfills at 7, new intent pays 9).

## System settings

A typed allowlist (`ADMIN_SETTING_KEYS`) — never a generic key/value
editor: listing validity/fees/renewal/image bounds and boost
first-view slots, each integer-bounded server-side. Secrets are not
DB settings and cannot become one through this surface. Updates use
the same `updated_at` version-token concurrency and are audited
(`SETTING_UPDATED`). Setting changes never rewrite existing payment
amounts or listing periods — they apply to future resolutions only.

## Catalog

Brands/models/cities/features/options support activation toggles
only. Rows referenced by listing history are never deleted —
deactivation removes them from future seller choices while keeping
referential integrity. Toggles are audited
(`CATALOG_ACTIVATED`/`CATALOG_DEACTIVATED`).

## Reports

`listing_reports` (schema accepted in Phase 4.2, gap documented in
4.14) gains its management side: list with status filter + keyset
pagination, links into the listing ops view, and OPEN →
RESOLVED/DISMISSED single-transition commands recording
`resolved_by`/`resolved_at` and an audit row. A closed report cannot
be re-resolved (`MODERATION_INVALID_STATE`). Public intake UI remains
a later phase; notes render as escaped plain text.

## Audit explorer

Read-only over the append-only `audit_logs` (the Phase 4.2 trigger
rejects UPDATE/DELETE at the database layer — regression-tested).
Filters (action pattern, entity id, actor type) are schema-validated;
actor phones are masked; `after_data` renders as JSON text. Admin
commands write `actor_type='ADMIN'` entries via the same append-only
path.

## UI determinism

The panel reuses the Phase 4.14 staff-console patterns: every
mutation control is a deliberate two-step `ConfirmAction` (no modal
framework) that is hydration-gated (`useHydrated`), states exactly
what will change, performs a FULL document reload on success, and
surfaces version conflicts as explicit "Məlumat başqa admin
tərəfindən dəyişdirilib" recovery panels. Server components render
first pages; pagination is server-driven cursor links — the browser
never receives unbounded row sets.

## Tests

Integration (`admin-panel`, `admin-commerce`): full RBAC matrix
(anonymous/USER/MODERATOR/blocked-admin denied, ADMIN/SUPER_ADMIN
allowed, cross-origin refused) across representative routes; user
search/pagination/masking + malformed-cursor rejection; block/unblock
(audited, idempotent, self-block refused, SUPER_ADMIN-target
boundary, real seller-mutation gating); role rules (grant works
end-to-end against the moderator API, ADMIN→ADMIN refused,
SUPER_ADMIN never grantable, self-change refused); listing filters;
unsuspension both policy branches + wrong-state/unknown +
exactly-once effects; payment projection secret-absence, reused
verification with exactly-once fulfillment; package price/activation
rules, stale-version 409, repeated two-admin concurrent-edit rounds
(exactly one winner each), future-intents-only pricing with snapshot
fulfillment; settings allowlist/bounds/version conflicts/concurrent
rounds and payment-amount immutability; catalog toggles; report
transitions; audit filters + append-only enforcement. E2E
(5 scenarios × 3 viewports): access control, block/unblock gating a
real seller session, SUPER_ADMIN vs ADMIN role boundary in UI and
API, package pricing snapshot round-trip through the seller checkout
+ payment verify view, and the moderator-suspend → admin-restore →
public-page round-trip. Visual review captures desktop+mobile for
every screen.
