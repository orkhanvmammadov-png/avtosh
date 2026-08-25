# Owner Listing API Contract (v1) — Drafts & Images

Authenticated seller endpoints (session cookie). Standard envelope
and `X-Request-ID` apply. All mutations enforce same-origin and
reject BLOCKED users (`USER_BLOCKED` 403). Ownership is absolute:
missing and foreign listings both answer `LISTING_NOT_FOUND` 404.
Design: `../architecture/listing-drafts.md`, `storage-images.md`.

## POST /api/v1/me/listings

`{ "category": "CAR" }` → `201` `{ "data": { "listing": <DTO> } }` —
a sparse DRAFT (revision 1) owned by the session user.

## GET /api/v1/me/listings (Phase 4.11)

Owner "My Listings" read model (never public search). Query:
`filter` ∈ `all | active | moderation | draft | correction`
(default `all`; `correction` = CORRECTION_REQUIRED + REJECTED).
Returns `{ items: OwnerCardDto[] }` ordered `updated_at DESC`
(cap 200, DELETED excluded, `no-store`). Cards carry id, publicId,
status, revision, title fields, priceMinor, imageCount, signed
primary-image URL, timestamps, and `moderationFeedback`
(see below) — no owner phone, no moderator identity.

## GET /api/v1/me/listings/:id

Owner-only listing DTO with ordered images (signed read URLs, 600 s).
Since Phase 4.11 the response also carries `moderation_feedback`: for
CORRECTION_REQUIRED/REJECTED listings, the latest review as a
seller-safe projection `{ decision, reasonCode, note, reviewedAt }`
(controlled reason enum, plain-text note; never moderator identity,
claims, or review ids); `null` otherwise.

## PATCH /api/v1/me/listings/:id — autosave

Body: `expected_revision` (required) + any subset of:
`category`, `brand_id`, `model_id`, `year`, `price_minor` (minor
units), `mileage`, `engine_cc`, `fuel_type_id`, `transmission_id`,
`body_type_id`, `drive_type_id`, `motorcycle_type_id`, `color_id`,
`city_id`, `credit_available`, `barter_available`, `description`,
`contact_phone`, `feature_ids` (full replacement). Unknown fields →
`VALIDATION_ERROR` (strict). Nullable fields accept `null` to clear.

Returns the fresh DTO (revision +1). Category change clears
dependent fields (brand/model/body_type/motorcycle_type +
incompatible features); brand change clears the model.

Errors: `LISTING_REVISION_CONFLICT` 409 (details carry
`current_revision`) · `LISTING_NOT_EDITABLE` 409 ·
`LISTING_INVALID_CATALOG_SELECTION` 400 · `VALIDATION_ERROR` 400.

## POST /api/v1/me/listings/:id/images/upload-url

`{ "filename"?, "declared_mime_type": "image/jpeg|png|webp",
"declared_size_bytes": n }` (hints — real validation happens at
confirm). `200`:

```json
{ "data": { "upload_id": "<uuid>", "upload_url": "...", "upload_token": "...", "expires_in_seconds": 300, "max_size_bytes": 12582912 } }
```

Browser uploads the file directly to `upload_url` within the window.
Errors: `LISTING_IMAGE_LIMIT_REACHED` 409 ·
`IMAGE_UPLOAD_RATE_LIMITED` 429 (≤5 pending per listing) ·
`IMAGE_TOO_LARGE` 413 · `IMAGE_INVALID_FORMAT` 400.

## POST /api/v1/me/listings/:id/images/confirm

`{ "upload_id": "<uuid>" }` → server downloads, decodes, validates,
strips EXIF, resizes (longest edge 1600), re-encodes WebP, persists.
`201` `{ "data": { "image": <ImageDto>, "revision": n } }`.
**Idempotent** — repeating returns the same image.

ImageDto: `{ id, sortOrder, isPrimary, width, height, mimeType,
url }` (url = signed read URL; storage paths never exposed).

Errors: `IMAGE_UPLOAD_NOT_FOUND` 404 (unknown upload / nothing
uploaded) · `IMAGE_UPLOAD_EXPIRED` 410 · `IMAGE_INVALID_FORMAT` 400
(incl. SVG/HEIC/corrupt/fake-MIME) · `IMAGE_TOO_LARGE` 413 ·
`IMAGE_PROCESSING_FAILED` 422 · `LISTING_IMAGE_LIMIT_REACHED` 409.

## DELETE /api/v1/me/listings/:id/images/:imageId

`200` `{ "data": { "deleted": true, "revision": n } }`. Deleting the
primary promotes the next image by sort order.

## PATCH /api/v1/me/listings/:id/images/order

`{ "image_ids": [ ...uuid ] }` — must be exactly the listing's image
set (no duplicates, no foreign IDs) → contiguous new order.
`200` `{ "data": { "reordered": true, "revision": n } }`.

## PATCH /api/v1/me/listings/:id/images/:imageId/primary

`200` `{ "data": { "primary": true, "revision": n } }` — exactly one
primary per listing (DB-enforced).

## Notes

- Every image mutation increments the listing revision.
- Draft minimum image count (3) is enforced at submission
  (Phase 4.6), not while drafting; maximum comes from the
  `listing.image_max` setting (20).

## GET /api/v1/me/listing-quota (Phase 4.6)

Advisory only. `200`:

```json
{ "data": { "quota": { "freeLimit": 3, "lifetimePublications": 2, "freeUsed": 2, "freeRemaining": 1, "nextPublicationNumber": 3, "nextPublicationIsPaid": false, "listingFeeMinor": 200, "currency": "AZN" } } }
```

BLOCKED users may read it. `LISTING_PAYMENT_CONFIGURATION_ERROR` 500 if settings are missing.

## POST /api/v1/me/listings/:id/submit (Phase 4.6)

`{ "expected_revision": 7 }` — nothing else is accepted. Requires a
complete DRAFT (see `../architecture/listing-submission.md`).

FREE result (`200`):
```json
{ "data": { "listing": { "id": "…", "status": "PENDING_MODERATION", "revision": 7 }, "publication": { "number": 3, "billingType": "FREE" }, "payment": null, "nextAction": "MODERATION" } }
```
PAID result (`200`):
```json
{ "data": { "listing": { "id": "…", "status": "PAYMENT_REQUIRED", "revision": 7 }, "publication": { "number": 4, "billingType": "PAID" }, "payment": { "id": "…", "type": "LISTING_FEE", "amountMinor": 200, "currency": "AZN", "status": "CREATED" }, "nextAction": "PAYMENT" } }
```
No checkout data exists yet. Retrying returns the same result.

Errors: `LISTING_REVISION_CONFLICT` 409 · `LISTING_NOT_EDITABLE` 409
· `LISTING_INCOMPLETE` 400 (`details.missing`) ·
`LISTING_INSUFFICIENT_IMAGES` 400 (`details.required/confirmed/primary`)
· `LISTING_INVALID_CATALOG_SELECTION` 400 (`details.field`) ·
`LISTING_PAYMENT_CONFIGURATION_ERROR` 500 · `USER_BLOCKED` 403 ·
`LISTING_NOT_FOUND` 404.

## POST /api/v1/me/listings/:id/resubmit (Phase 4.7)

`{ "expected_revision": n }` from CORRECTION_REQUIRED / REJECTED.
Same completeness/catalog rules as submit; returns
`{ listing: { id, status: "PENDING_MODERATION", revision }, publication: { number, billingType }, nextAction: "MODERATION" }`.
Never creates a new publication/ordinal/payment. Idempotent.
Errors: `LISTING_NOT_EDITABLE` 409 · `LISTING_REVISION_CONFLICT` 409 ·
`LISTING_INCOMPLETE` · `LISTING_INSUFFICIENT_IMAGES` ·
`LISTING_INVALID_CATALOG_SELECTION` · `USER_BLOCKED` 403.

Seller field/image mutation endpoints now also accept listings in
`CORRECTION_REQUIRED` and `REJECTED` (same rules as DRAFT).
