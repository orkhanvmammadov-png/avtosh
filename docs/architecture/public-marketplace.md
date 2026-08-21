# Public Marketplace Read Model (Phase 4.8)

Date: 2026-08-21
Status: implemented (backend/read APIs; the responsive UI is Phase 4.9)

Anonymous, read-only marketplace APIs over PostgreSQL (the MVP search
engine). No auth is consulted on public routes, so a present session
can never leak private data.

## Visibility invariant (single definition)

`publicVisible()` in `src/repositories/marketplace.ts`:
`l.status = 'ACTIVE' AND l.current_expires_at > now()` — applied to
search, Boost candidates, Premium feed, the Home count, and detail
contactability. Time is checked at query time; the future expiry
worker is never a correctness dependency. Promotion validity is
likewise time-based: `starts_at <= now() < ends_at AND status IN
(SCHEDULED, ACTIVE)` — a lagging status flip can neither hide a paid
promotion nor extend an ended one.

## Search — `GET /api/v1/listings`

- `category` is **required** (browsing is always CAR or MOTORCYCLE —
  this also grounds the Boost "category always applies" rule).
- Filters: `brand_id`, `model_id` (requires brand), `city_id`,
  `price_min/max`, `year_min/max`, `mileage_max`, `fuel_type_id`,
  `transmission_id`, `body_type_id`, `drive_type_id`,
  `motorcycle_type_id`, `color_id`, `credit`, `barter`, `feature_ids`
  (comma list, listing must have ALL). Zod validates shapes/ranges;
  the service validates relationships against current catalog data
  with the catalog repository (brand∈category, model∈brand+category,
  option group+category scope, features) → existing
  `CATALOG_INVALID_*` / `VALIDATION_ERROR`. CAR-only BODY_TYPE on
  MOTORCYCLE or MOTORCYCLE_TYPE on CAR is rejected, not ignored.
- Sort allowlist (closed server-side fragment map): `NEWEST`
  (`published_at DESC, id DESC`, default), `PRICE_ASC`, `PRICE_DESC`,
  `YEAR_DESC` — each with `id` tie-break.
- Keyset cursor `base64url("v1|<sort>|<value>|<id>")`: versioned,
  bound to the sort, value shape validated (timestamps kept as
  full-precision text — a Date-typed cursor would silently lose
  microseconds and repeat boundary rows), uuid validated. Invalid →
  `VALIDATION_ERROR`. Page size 24 (max 48).
- Response `data: { promoted, items }`, `meta: { next_cursor,
  has_more }`.

## Boost (read side)

Candidates = the **same visibility + filter fragment as organic
search** joined to a currently valid BOOST promotion, so a Boost can
never bypass the user's filters. Shown only on the first page.
Capacity = max of the `boost.first_view_slots_*` settings (4 by
default — the API returns enough for the widest device; the UI slices
to 4/3/2). **Fair rotation (write-free, deterministic)**:
`key = sha256(searchSignature | hourBucket)`, `score(listing) =
sha256(key | listing_id)`, lowest scores win. Stable within an hour
for a given search (pagination/refresh agree), rotates hourly, no
listing is permanently favored, zero DB writes. Promoted ids are
excluded from the organic first page (`l.id <> ALL(...)`).

## Premium (read side) — `GET /api/v1/listings/premium`

All currently valid Premium listings, no slot cap, cursor-paginated
(24/page). Driven from `listing_promotions` (indexed by
`(type, status, ends_at)`), `MAX(starts_at)` per listing collapses
adjacent/historical records to one row. Order: newest current
Premium activation first, `id` tie-break. Zero Premium → empty page.

## Home — `GET /api/v1/home`

`newListingsLast24h` = publicly visible listings with `published_at`
in the last 24 hours (first public activation — the marketplace
meaning of "Son 24 saatda N yeni elan yerləşdirilib"), category
bootstrap, and the first Premium page. No generic "New listings" feed
and no "Popular brands" section (not part of the accepted design).

## Detail — `GET /api/v1/listings/:publicId`

Lookup by `public_id` only (UUIDs 404). States:

| Persisted state | Public result |
| --- | --- |
| ACTIVE and `current_expires_at > now()` | full DTO, `contactable: true`, all ordered images, features, masked contact phone |
| ACTIVE but time-expired, or EXPIRED | limited DTO (`status: "EXPIRED"`, title fields, primary image only, `contactable: false`, no seller/description) |
| SOLD | limited DTO (`status: "SOLD"`, same shape) |
| SUSPENDED, DELETED, DRAFT, PAYMENT_REQUIRED/COMPLETED, PENDING_MODERATION, CORRECTION_REQUIRED, REJECTED | 404 `LISTING_NOT_FOUND` |

View count: best-effort `listing_stats` upsert on contactable views;
failures are swallowed (never required for serving); no raw view rows.

## Contact information

Detail exposes `seller.contactPhoneMasked` (listing contact phone,
masked) and `displayName` — never the account phone, never a full
number, never in search cards. **Gap (explicit)**: an abuse-protected
phone-reveal / contact-action endpoint does not exist yet and was
deliberately not improvised; it is a focused follow-up.

## Images

Existing `StorageProvider`; buckets stay private. Cards sign only the
primary image; detail signs all images (limited views: primary
only). Public signed-URL TTL **3600 s** (`LISTING_IMAGE_PUBLIC_READ_TTL_SECONDS`).
Signing failure → `null` URL on that card (graceful, provider text
never exposed), the page still serves.

**Checkpoint**: signed URLs embed the Phase 4.5 storage path
`listings/{owner_uuid}/{listing_uuid}/{image_id}.webp`, so public
image URLs carry owner/listing UUIDs (seller correlation). The
accepted path scheme was designed for private access; before/with the
public-CDN strategy, adopt opaque public object paths (or a
path-rewriting delivery layer). Tracked as an open risk.

## Caching

Public read responses send `Cache-Control: public, max-age=30,
s-maxage=60, stale-while-revalidate=30` (configurable). Bounded well
inside the 1 h image-URL TTL; the time-checked invariant means a
listing can be served at most ~90 s past expiry/promotion end.
Owner/moderator routes send no cache headers.

## Query shape & indexes

One query per list (cards join labels; per-row subselects for primary
image path and promotion badges; no per-listing queries); per-card
URL signing is provider-bound. `pnpm db:explain` seeds 20k synthetic
ACTIVE listings and prints EXPLAIN ANALYZE for the key shapes:

| Shape | Plan (20k rows) |
| --- | --- |
| category + newest | Index Scan `listings_active_category_newest` (new, migration 015) — 0.02 ms (was Seq Scan + sort, 3.8 ms) |
| category + brand + model + newest | Index Scan `listings_active_search` |
| price range + price sort | Index Scan `listings_active_price` |
| year / city + newest | Bitmap scans on the partial indexes + top-N sort |
| Premium read | driven from `listing_promotions` — ~1 ms (was 8.9 ms lateral over all listings) |
| Boost read | promotions index, sub-ms |

## Checkpoints

Real Supabase Storage delivery (Phase 4.5 smoke test) still pending;
public CDN / opaque-path strategy; production catalog data;
phone-reveal endpoint; rate limiting for anonymous search at the
platform/WAF layer (queries are bounded: max 48 rows, 50 Boost
candidates, validated filters).
