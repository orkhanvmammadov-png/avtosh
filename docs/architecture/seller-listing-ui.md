# AVTOSH.AZ — Seller Listing Wizard & My Listings (Phase 4.11)

Date: 2026-08-25
Status: implemented (payment-provider checkout is the Phase 4.12
boundary)

The primary seller experience over the accepted Phase 4.5–4.7 owner
APIs. No listing business logic was duplicated in React: every rule
(editable states, dependent clearing, completeness, quota, image
limits) lives server-side; the UI presents server state and surfaces
server errors.

## Routes

| Route | Access | Purpose |
| --- | --- | --- |
| `/elan-yerlesdir` | active seller | Entry: continue existing editable listings, or explicitly create a draft. BLOCKED users see a safe status message. |
| `/elan-yerlesdir/{listingId}` | owner only | The wizard (DRAFT / CORRECTION_REQUIRED / REJECTED). PENDING_MODERATION and PAYMENT_REQUIRED render read-only status screens; other states redirect to My Listings. Foreign/missing ids → 404 via the owner-scoped loader. |
| `/profil/elanlar` | session | My Listings with simple status-group filters. |

Listing UUIDs appear only in authenticated owner routes — the
accepted owner-API contract. Anonymous visitors keep the accepted
`/giris?return_to=…` intent flow.

## Wizard step model

Five steps (`?addim=1..5`, refresh-stable): Nəqliyyat (category/
brand/model/year) → Məlumatlar (price/mileage/engine, city,
data-driven option groups, credit/barter, features) → Şəkillər →
Təsvir və əlaqə → Yoxla və göndər. Option groups render only when the
catalog returns options for the current category (the server already
scopes them), so CAR/MOTORCYCLE differences are data, not code.

## Draft creation

Never on page load. The entry page lists existing editable listings
("Davam et") and creates only on an explicit button with an in-flight
guard — refresh/double-click cannot mint extra drafts. Creation
touches no quota, no payment, no moderation.

## Autosave & revision (`use-listing-editor.ts`)

One serialized promise chain carries every mutation (debounced field
patches at 800 ms, immediate saves for selects/toggles, image ops,
submit), so a tab can never race itself. `expected_revision` is read
from the freshest DTO at send time; every response replaces the DTO
wholesale — server-side dependent-field clearing (category → brand/
model/options/features, brand → model) therefore propagates to the UI
automatically. Save states: dirty / saving / saved / error.

`LISTING_REVISION_CONFLICT` (another tab/window) freezes all editing
behind an explicit banner — "Elan başqa pəncərədə dəyişdirilib." —
with a reload action that adopts the server version. Local changes
are never silently pushed over newer state, and nothing auto-retries
with a fresh revision. Step navigation flushes pending edits first;
a failed flush blocks the transition (no aggressive beforeunload
prompts).

## Images

The accepted signed direct-upload contract, unchanged: upload-url →
browser PUT to the signed URL → confirm → processed DTO. At most 2
parallel uploads; per-file states (Yüklənir / Emal olunur / error
text) announced via `aria-live`. `accept` lists exactly
`image/jpeg,image/png,image/webp` — HEIC is not advertised (explicit
future checkpoint) and unsupported files get a clear Azerbaijani
message client-side, with the confirm-time server validation as the
authority. Reorder = accessible move-left/right buttons persisting
through the order API; explicit primary selection; delete. After
every image mutation the full DTO is refetched so server-side sort
compaction and primary promotion are always reflected. Minimum 3 is a
submission rule only; the 20 maximum surfaces via server errors.

### Local storage driver (dev/E2E)

`STORAGE_DRIVER=local` (refused in production builds) activates a
filesystem provider + `/api/dev-storage/upload|object` routes with
HMAC-signed, expiring URLs and hard path-segment validation, so the
real browser upload pipeline runs in development and Playwright
without Supabase credentials. Production continues to use the
Supabase provider; no service-role material ever reaches the client
in either mode.

## Completeness, preview, quota

The preview step derives an advisory checklist from the DTO
(brand/model/year/price/mileage/city/contact + ≥3 images with a
primary) with jump-links to the owning step; the submit endpoint
remains authoritative and its `LISTING_INCOMPLETE` /
`LISTING_INSUFFICIENT_IMAGES` / `LISTING_INVALID_CATALOG_SELECTION`
errors are mapped to field labels. The preview renders authenticated
owner data (signed owner image URLs) — the public endpoint is never
called for a draft. `GET /me/listing-quota` feeds an advisory banner
("pulsuz" remaining vs "2 AZN"); the client never decides FREE/PAID.

## Submission & results

Submit/resubmit send `{ expected_revision }` with the button disabled
in flight (server idempotency remains the authority). FREE →
`PENDING_MODERATION` success screen. PAID → `PAYMENT_REQUIRED` screen
with "Onlayn ödəniş tezliklə aktiv olacaq" — no checkout UI, no
simulated success; the payment CTA is Phase 4.12. Money is entered as
whole AZN and converted to minor units at the form boundary (integer
math only).

### Fee display authority (BEFORE vs AFTER submit)

- **BEFORE SUBMIT** — advisory only: `GET /me/listing-quota` (current
  system settings) feeds the preview banner ("2 AZN" / free
  remaining).
- **AFTER PAID SUBMIT** — the CREATED `LISTING_FEE` intent is the
  immutable snapshot of the seller's debt. Every PAYMENT_REQUIRED
  surface (submit result and revisit/status screen alike) renders the
  intent's `amount/currency/status`, resolved through the immutable
  `listing_publications.payment_id` relationship — never an arbitrary
  "latest payment", never the current fee setting. A later change to
  `listing.publication_fee_minor` cannot change an existing debt
  (regression-tested at 200→300 minor). If the intent is missing
  (inconsistent data), the UI fails safe and shows no amount rather
  than presenting current settings as the debt.

The owner detail API exposes this as `payment_required:
{ type, amountMinor, currency, status }` (null for FREE listings) —
no payment UUID, provider fields, idempotency keys, or webhook/event
internals.

## My Listings

`GET /api/v1/me/listings` (new, minimal): owner-scoped read model —
never public search — with status-group filters (all / active /
moderation / draft / correction), `updated_at DESC`, capped at 200,
DELETED excluded per the accepted owner-visibility rule. Cards show
signed primary image, title, price, status chip (Azerbaijani labels
for every lifecycle state — raw enums never render), image count, and
a context action (Davam et / Düzəliş et / Redaktə et / Ətraflı /
Elana bax). Authenticated navigation now includes Elanlarım
(header ≥ lg, drawer below, profile shell).

## Correction / rejected editing & moderator feedback

CORRECTION_REQUIRED and REJECTED open the same wizard (the accepted
Phase 4.7 editable states) with a feedback banner, and submit becomes
the resubmit endpoint — no new listing, publication, ordinal, or fee.
Seller-safe feedback is a dedicated projection (decision, controlled
reason code with Azerbaijani labels, plain-text note, time) of the
latest review, exposed only while the listing is in a
moderator-returned state — moderator identity, claims, and internal
review ids are never serialized. It rides on `GET /me/listings` items
and as `moderation_feedback` on the owner detail response.

## Responsive & accessibility

Mobile-first: photo controls verified usable at 360/390; explicit
E2E overflow checks; 48px touch targets throughout; labelled
controls with error association (`role="alert"`, `aria-invalid`,
`aria-describedby`); `aria-current="step"` navigation; focus moves to
the step heading on transitions; upload states are text, not color.

## Backend/API additions (the identified minimal gaps)

1. `GET /api/v1/me/listings` — owner list read model.
2. `moderation_feedback` seller-safe projection (list + detail).
3. Local dev/E2E storage driver (`STORAGE_DRIVER=local`).
No database migrations; no new dependencies.

## Open checkpoints

- Phase 4.12: real payment checkout for `PAYMENT_REQUIRED` (CTA slot
  exists on the status/result screens).
- HEIC ingestion remains an explicit product decision.
- ACTIVE-listing risk-based editing is deliberately out of scope.
- Upload progress percentages (XHR) deferred; state chips only.
