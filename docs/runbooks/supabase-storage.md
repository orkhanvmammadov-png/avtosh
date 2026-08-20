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

Recommended bucket settings:
- `listing-uploads`: file size limit 12 MB (matches
  `LISTING_IMAGE_MAX_UPLOAD_BYTES`); allowed MIME types image/jpeg,
  image/png, image/webp (defense in depth — the app re-validates by
  decoding).
- `listing-images`: written only by the server (processed WebP).

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
