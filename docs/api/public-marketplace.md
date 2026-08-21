# Public Marketplace API Contract (v1)

Anonymous, read-only. Standard envelope; list endpoints add
`meta: { next_cursor, has_more }`. Public responses carry
`Cache-Control: public, max-age=≤30, s-maxage=≤60` **bounded by the
earliest listing/promotion expiry in the response** (no
stale-while-revalidate; `no-store` when a contained deadline is
imminent). Image URLs are signed, short-lived, and opaque (no
internal identifiers). Design: `../architecture/public-marketplace.md`.

## GET /api/v1/listings

Query: `category` (required: `CAR` | `MOTORCYCLE`), `brand_id`,
`model_id` (requires `brand_id`), `city_id`, `price_min`, `price_max`,
`year_min`, `year_max`, `mileage_max`, `fuel_type_id`,
`transmission_id`, `body_type_id`, `drive_type_id`,
`motorcycle_type_id`, `color_id`, `credit=true|false`,
`barter=true|false`, `feature_ids=<uuid>,<uuid>` (all must match),
`sort=NEWEST|PRICE_ASC|PRICE_DESC|YEAR_DESC` (default NEWEST),
`limit` (1–48, default 24), `cursor`.

```json
{ "data": { "promoted": [Card], "items": [Card] }, "meta": { "next_cursor": "…|null", "has_more": true } }
```

Card: `{ publicId, category, brand, model, year, priceMinor, currency,
mileage, city, primaryImageUrl, publishedAt, badges { premium, boosted } }`.
`promoted` (Boost placement) is non-empty only on the first page and
never repeats a listing present in `items`.

Errors: `VALIDATION_ERROR` (missing category, malformed ids, bad
ranges, unknown sort, invalid cursor, incompatible features) ·
`CATALOG_INVALID_CATEGORY` · `CATALOG_INVALID_BRAND` (brand not in
category / model not in brand) · `CATALOG_INVALID_GROUP` (option not
valid for the category).

## GET /api/v1/listings/premium

`limit`, `cursor` → `{ "data": { "items": [Card] }, "meta": {...} }` —
all currently valid Premium listings, newest activation first.

## GET /api/v1/home

```json
{ "data": { "home": { "newListingsLast24h": 12, "categories": [CategoryDto], "premium": { "items": [Card], "nextCursor": "…", "hasMore": false } } } }
```

## GET /api/v1/listings/:publicId

Numeric `public_id` (e.g. `/api/v1/listings/48291`). `200` with:

```
{ publicId, status: "ACTIVE"|"SOLD"|"EXPIRED", contactable, category, brand, model,
  year, priceMinor, currency, mileage, city, publishedAt,
  images: [{ url, width, height, isPrimary }], badges,
  engineCc, fuelType, transmission, bodyType, driveType, motorcycleType, color,
  creditAvailable, barterAvailable, description, features: [{ code, name }],
  seller: { displayName, contactPhoneMasked } }
```

SOLD / EXPIRED (including ACTIVE past `current_expires_at`) return
the limited form: `contactable: false`, primary image only, detail
fields `null`, `features: []`, `seller: null`. Every other state and
unknown ids → `404 LISTING_NOT_FOUND`. No phone-reveal endpoint
exists yet (documented follow-up).

## POST /api/v1/listings/:publicId/contact (Phase 4.9)

Explicit, anonymous contact reveal. Only for publicly visible (ACTIVE
and unexpired) listings; source is the listing contact phone, never
the seller's account phone. `Cache-Control: no-store`.

```json
{ "data": { "contact": { "phone": "+994501234567", "whatsappUrl": "https://wa.me/994501234567" } } }
```

Errors: `LISTING_NOT_FOUND` 404 (unknown, SOLD, EXPIRED, or any
non-public state) · `LISTING_CONTACT_UNAVAILABLE` 409 (listing has no
contact phone). Rate limiting is a documented follow-up.
