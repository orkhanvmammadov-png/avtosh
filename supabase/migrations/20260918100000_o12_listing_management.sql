-- O.12 — Seller Listing Management (Stage A foundation).
--
-- 1) Seller visibility dimension: two nullable timestamps on listings.
--    NO new listing_status — visibility is orthogonal to lifecycle, so
--    expiry/renewal/suspension/moderation keep operating on status
--    unchanged. seller_reactivation_requested_at records the seller's
--    explicit "activate" intent; ONLY the central reactivation
--    finalizer may clear seller_deactivated_at.
alter table listings
  add column seller_deactivated_at timestamptz,
  add column seller_reactivation_requested_at timestamptz;

-- 2) Edit revision lifecycle. Terminal states (APPROVED / REJECTED /
--    CANCELLED) never block a later new edit (partial index below).
create type edit_revision_status as enum (
  'EDIT_DRAFT',
  'PENDING_MODERATION',
  'CORRECTION_REQUIRED',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

-- 3) One FULL editable-content snapshot per revision. `data` carries
--    exactly the seller draft-PATCH field space (incl. feature_ids;
--    promotion-intent fields excluded per the sealed O.12 scope) — the
--    same Zod contract validates it, and approval re-validates against
--    live catalog before any copy into listings. It is NOT a diff,
--    payment object, publication period, or audit substitute.
--    `revision` is the edit's OWN optimistic counter, independent from
--    listings.revision so listing-level visibility writes never create
--    false edit conflicts.
create table listing_edit_revisions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete restrict,
  status edit_revision_status not null default 'EDIT_DRAFT',
  data jsonb not null default '{}',
  revision integer not null default 1
    constraint listing_edit_revisions_revision_positive check (revision > 0),
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger listing_edit_revisions_set_updated_at
  before update on listing_edit_revisions
  for each row execute function set_updated_at();

-- At most ONE open edit revision per listing, enforced in-database so
-- concurrent create-or-get can never race into duplicates.
create unique index listing_edit_revisions_one_open_per_listing
  on listing_edit_revisions (listing_id)
  where status in ('EDIT_DRAFT', 'PENDING_MODERATION', 'CORRECTION_REQUIRED');

-- Future edit-moderation queue reads (Stage D).
create index listing_edit_revisions_status_submitted
  on listing_edit_revisions (status, submitted_at);

-- 4) Staged edit gallery. Rows reference storage paths (shared with
--    the approved gallery on snapshot — objects are NEVER copied); the
--    public gallery stays entirely listing_images-backed, so staged
--    changes cannot leak. Mirrors listing_images metadata columns.
create table listing_edit_images (
  id uuid primary key default gen_random_uuid(),
  edit_revision_id uuid not null references listing_edit_revisions (id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  width integer
    constraint listing_edit_images_width_positive check (width is null or width > 0),
  height integer
    constraint listing_edit_images_height_positive check (height is null or height > 0),
  mime_type text not null,
  file_size_bytes bigint not null
    constraint listing_edit_images_file_size_positive check (file_size_bytes > 0),
  created_at timestamptz not null default now()
);

create unique index listing_edit_images_one_primary_per_revision
  on listing_edit_images (edit_revision_id)
  where is_primary;

-- 5) Edit decisions (Stage D) record WHICH revision was decided and
--    that revision's own counter at decision time. The existing
--    listing_revision column keeps its original meaning (the LISTING
--    row's revision — for edits, the approved base reviewed against)
--    and is deliberately not overloaded.
alter table moderation_reviews
  add column edit_revision_id uuid references listing_edit_revisions (id) on delete restrict,
  add column edit_revision_no integer
    constraint moderation_reviews_edit_revision_no_positive
      check (edit_revision_no is null or edit_revision_no > 0);
