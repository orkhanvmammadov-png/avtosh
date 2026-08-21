-- 013 — Pending listing-image uploads (Phase 4.5).
--
-- Gap: the accepted schema has no way to represent the window between
-- signed-upload-URL issuance and confirmed image persistence, which
-- is required for upload ownership checks, idempotent confirmation,
-- issuance (abuse) limits, and future orphan cleanup. listing_images
-- must only ever contain server-verified processed images, so pending
-- state needs its own additive table.

create type image_upload_status as enum (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'EXPIRED'
);

create table listing_image_uploads (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  temp_storage_path text not null,
  status image_upload_status not null default 'PENDING',
  declared_mime_type text not null,
  declared_size_bytes bigint not null
    constraint listing_image_uploads_size_positive check (declared_size_bytes > 0),
  -- Set exactly once on successful confirmation; repeated confirms
  -- return this image instead of creating another row.
  image_id uuid references listing_images (id) on delete set null,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Issuance limits: count live pending uploads per listing.
create index listing_image_uploads_listing_pending
  on listing_image_uploads (listing_id)
  where status = 'PENDING';

-- Future cleanup job: find expired pending uploads. Correctness never
-- depends on cleanup — confirmation always checks expires_at.
create index listing_image_uploads_expiry
  on listing_image_uploads (expires_at)
  where status = 'PENDING';
