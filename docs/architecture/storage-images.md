# Listing Image Storage & Processing (Phase 4.5)

Date: 2026-08-20
Status: implemented against the storage abstraction; real Supabase
Storage smoke test still pending (see checkpoints).

## Signed direct-to-storage upload flow

```
1  seller  → POST /me/listings/:id/images/upload-url
2  server  : auth + not-blocked + owner + DRAFT + limits
3  server  : creates listing_image_uploads row (PENDING, expires_at)
             with a server-generated temp path
4  server  : returns signed upload URL/token (+ upload_id)
5  browser → uploads bytes directly to storage
6  seller  → POST /me/listings/:id/images/confirm {upload_id}
7  server  : re-checks auth/owner/DRAFT/expiry, DOWNLOADS the actual
             object, validates & processes the real bytes
8  server  : writes processed WebP to the final path
9  server  : one DB transaction — listing row locked, image-limit
             re-check, listing_images insert, upload COMPLETED,
             revision + 1
10 server  : deletes the temporary original (best effort)
11 response: image DTO with a signed read URL
```

Client claims (filename, MIME, size) are hints only — every decision
is made from the actual bytes. `listing_images` rows are only ever
created from server-processed objects.

## Buckets & paths

| Bucket (config, default) | Purpose | Privacy |
| --- | --- | --- |
| `listing-uploads` | temporary originals | private |
| `listing-images` | processed WebP | private in this phase |

Paths are 100% server-generated — the client only ever holds an
opaque `upload_id`:

- temp (private/internal): `uploads/{user_id}/{listing_id}/{upload_id}`
- final (opaque, since Phase 4.8 hardening): `listings/{image_id}.webp`

The final object key carries **no owner, listing, phone, or seller
identifier** — public signed URLs therefore reveal nothing internal.
Authorization always comes from PostgreSQL (`listing_images` is the
authoritative mapping, owner/state checks on every read), never from
path secrecy. `image_id` equals `upload_id`, so a retried/concurrent
confirm overwrites the same final object deterministically. No client
string ever reaches a path. (The pre-launch `listings/{user}/
{listing}/{image}.webp` convention was replaced before any production
inventory existed; rows always resolve through `storage_path`, so no
compatibility shim is needed.)

## Pending uploads (`listing_image_uploads`, migration 013)

PENDING → COMPLETED (sets `image_id` exactly once — the idempotency
anchor) / FAILED (bad bytes, provider failure) / EXPIRED (window
passed). Confirmation always checks `expires_at` directly; the status
is bookkeeping. Signed-upload window: **300 s** (configurable) —
Supabase's own signed-upload validity is longer (~2 h) and is NOT
relied upon; `expires_at` governs, so a late physical upload can
never be confirmed.

**Issuance concurrency**: the upload-url transaction takes
`SELECT … FOR UPDATE` on the listing row, then counts persisted
images and live pending uploads (`status='PENDING' AND expires_at >
now()`), enforces `images + pending < max` and `pending < 5`, and
inserts — so concurrent requests serialize on the row lock and each
sees the committed effect of the previous one (regression-tested with
4 pending + 10 parallel requests → exactly 1 success). The provider
call happens only after commit; if it fails the row is marked FAILED
so it consumes no live slot.

## Validation & processing (sharp)

- Formats: **JPEG, PNG, WebP** only — decided by decoding, never by
  extension/Content-Type. SVG, GIF, and HEIC are rejected (HEIC is
  not advertised because the pipeline hasn't proven it).
- Size: original ≤ **12 MB** (checked at issuance on the declared
  hint AND at confirm on actual bytes). The application cannot stop
  an oversized direct upload from being *attempted* — the temporary
  bucket MUST carry a storage-side `file_size_limit` of 12582912
  bytes (required in the runbook); bucket MIME restrictions are
  defense in depth only.
- Decompression-bomb guard: 50-megapixel decode cap.
- Pipeline: auto-orient → resize longest edge to **1600 px**
  (`fit: inside`, no upscaling) → **WebP q80**. All EXIF/GPS metadata
  is stripped (sharp discards metadata unless explicitly kept —
  asserted by test). Real width/height/bytes are recorded.
- AVIF and responsive variants are deliberate future optimizations.

## Image count & ordering

Maximum per listing comes from the accepted `listing.image_max`
system setting (fallback 20), re-read inside the confirm transaction
with the listing row locked — concurrent confirms cannot exceed it
(tested). Minimum 3 is a **submission** rule (Phase 4.6), not a draft
rule. First confirmed image becomes primary; deleting the primary
promotes the next by `sort_order`; reorder takes the exact image-id
permutation and writes contiguous orders; explicit primary selection
flips inside one transaction under the partial unique index.

## Privacy

Draft images are private seller content: both buckets stay private
and owner APIs return **short-lived signed read URLs (600 s)** — no
public objects, no reliance on UUID obscurity. Public delivery for
ACTIVE listings (CDN/cache strategy) is designed when the public
marketplace ships.

## DB / storage consistency (no fake atomicity)

- Confirm: process → write final object → DB transaction → temp
  cleanup. If the DB step fails, the final object is deleted
  (compensation). If cleanup fails, a temp orphan remains — harmless,
  swept later.
- Delete: DB row first (source of truth), then best-effort storage
  delete; failures leave an unreferenced object, never a dangling DB
  row.
- Cleanup job (future): sweep `listing_image_uploads` where
  `status = 'PENDING' AND expires_at < now()` (index provided), mark
  EXPIRED, delete temp objects; plus an orphan sweep of unreferenced
  storage objects. Security/correctness never depends on it.

## Production checkpoints

1. Create buckets + privacy settings per
   `../runbooks/supabase-storage.md`, then run the staging smoke test
   (signed upload → confirm → signed read) against real Supabase
   Storage — **not yet performed**; all current tests use the
   in-memory provider.
2. Confirm browser CORS behavior for direct uploads.
3. Decide the public-delivery/CDN strategy before the public
   marketplace phase.
