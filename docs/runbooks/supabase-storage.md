# Runbook — Supabase Storage Setup (Listing Images)

Applies to staging first, then production. Never run against
production without explicit approval. No credentials in this file.

## Required buckets

| Bucket | Public | Purpose |
| --- | --- | --- |
| `listing-uploads` | **No** | temporary seller uploads (originals) |
| `listing-images` | **No** (this phase) | processed WebP listing images |

Create via Supabase Dashboard → Storage (or management API). Names
are configurable through `STORAGE_LISTING_UPLOADS_BUCKET` /
`STORAGE_LISTING_IMAGES_BUCKET` if they must differ.

## REQUIRED bucket configuration (not optional)

The application enforces the 12 MB original-image limit at
authorization and again on the downloaded bytes at confirmation, but
that cannot stop a malicious client from attempting a far larger
direct upload through a valid signed URL. The storage side MUST
reject such objects itself:

| Bucket | Setting | Required value |
| --- | --- | --- |
| `listing-uploads` | Public | **off** (private) |
| `listing-uploads` | **File size limit** | **12582912 bytes (12 MiB)** — exactly `LISTING_IMAGE_MAX_UPLOAD_BYTES`; if the env value is ever changed, change the bucket limit in lockstep |
| `listing-uploads` | Allowed MIME types | `image/jpeg, image/png, image/webp` — **defense in depth only**; browser Content-Type is never a security control, server-side sharp decoding remains authoritative |
| `listing-images` | Public | **off** (private in Phase 4.5) |
| `listing-images` | File size limit | 12582912 bytes (processed WebP is always far smaller) |

In the Supabase Dashboard: Storage → bucket → Edit → "Restrict file
upload size" / "Restrict file types". Verify during the smoke test
that a 13 MB upload to a valid signed URL is rejected by Storage
with an HTTP 413-class error before any confirm is attempted.

## Signed URL validity vs application window

Supabase signed **upload** URLs carry a fixed provider-side validity
(currently 2 hours) that cannot be shortened via the SDK. The
application window is the authoritative one: `listing_image_uploads.
expires_at` = issuance + `LISTING_IMAGE_SIGNED_UPLOAD_TTL_SECONDS`
(default **300 s**), and confirmation rejects any pending upload past
`expires_at` with `IMAGE_UPLOAD_EXPIRED` **even if the object was
physically uploaded** (covered by an integration test). Late objects
are orphans for the cleanup job, never images.

## Access model

- The application talks to Storage **only** with the service-role key
  (`SUPABASE_SERVICE_ROLE_KEY`, server-only env — never shipped to
  clients, never committed).
- Browsers receive only short-lived signed upload URLs (issued
  per-upload) and signed read URLs (600 s). No anon-key storage
  access is used, so no storage RLS policies are required for MVP;
  keep both buckets private.

## CORS

Direct browser uploads PUT/POST to the signed upload URL on the
Supabase domain. Supabase Storage serves permissive CORS for signed
endpoints by default; verify from the app origin during the smoke
test and restrict at the platform level if policy requires.

## Staging smoke test (required before launch)

1. Configure staging env: `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `OTP_PEPPER`, `DATABASE_URL`.
2. Authenticate (dev OTP provider), create a draft listing.
3. `POST .../images/upload-url`, upload a real JPEG with `curl -X PUT
   --upload-file photo.jpg "<signed url>"` (include the returned
   token header if required by the SDK flow).
4. `POST .../images/confirm` — expect a 201 with a WebP image DTO.
5. Open the returned signed read URL — image renders; confirm the
   temp object is gone from `listing-uploads` and the processed
   object exists in `listing-images`.
6. Delete the image via the API — confirm the object disappears.

Record the result in `docs/architecture/storage-images.md` when done.
