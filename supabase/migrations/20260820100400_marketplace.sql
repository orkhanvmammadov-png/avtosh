-- 004 — Marketplace domain: listings, listing_images,
-- listing_features, listing_periods, listing_publications, favorites,
-- listing_stats.
--
-- FK-cycle note (documented decision): listing_periods.payment_id and
-- listing_publications.payment_id are created here WITHOUT their
-- foreign keys because the payments table (which itself references
-- listings) is created in migration 006. The FKs are added there.
--
-- Money: bigint minor units (200 = 2.00 AZN) — consistent with the
-- payment core. Never floating point.

-- Public URL identity (/elan/48291): a dedicated sequence backs the
-- user-facing numeric id. public_id is never used for internal FKs.
create sequence listing_public_id_seq start with 10001;

create table listings (
  id uuid primary key default gen_random_uuid(),
  public_id bigint not null unique default nextval('listing_public_id_seq'),
  owner_id uuid not null references users (id) on delete restrict,
  category_id uuid not null references categories (id) on delete restrict,

  -- Core searchable fields are typed relational columns. Most are
  -- nullable because listings begin life as DRAFT; completeness at
  -- submission is enforced by application validation (Zod), not here.
  brand_id uuid references brands (id) on delete restrict,
  model_id uuid references models (id) on delete restrict,
  year integer
    constraint listings_year_range check (year is null or year between 1900 and 2100),
  price_minor bigint
    constraint listings_price_positive check (price_minor is null or price_minor > 0),
  currency char(3) not null default 'AZN'
    constraint listings_currency_shape check (currency ~ '^[A-Z]{3}$'),
  mileage integer
    constraint listings_mileage_nonnegative check (mileage is null or mileage >= 0),
  engine_cc integer
    constraint listings_engine_cc_nonnegative
      check (engine_cc is null or engine_cc >= 0),
  fuel_type_id uuid references reference_options (id) on delete restrict,
  transmission_id uuid references reference_options (id) on delete restrict,
  body_type_id uuid references reference_options (id) on delete restrict,
  drive_type_id uuid references reference_options (id) on delete restrict,
  motorcycle_type_id uuid references reference_options (id) on delete restrict,
  color_id uuid references reference_options (id) on delete restrict,
  city_id uuid references cities (id) on delete restrict,
  credit_available boolean not null default false,
  barter_available boolean not null default false,
  description text,
  contact_phone_e164 varchar(16)
    constraint listings_contact_phone_shape
      check (contact_phone_e164 is null or contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),

  -- Limited escape hatch for future category-specific optional
  -- attributes. Core searchable filters must NOT move in here.
  attributes jsonb not null default '{}',

  status listing_status not null default 'DRAFT',
  revision integer not null default 1
    constraint listings_revision_positive check (revision > 0),
  needs_remoderation boolean not null default false,

  submitted_at timestamptz,
  published_at timestamptz,
  current_expires_at timestamptz,
  sold_at timestamptz,
  suspended_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger listings_set_updated_at
  before update on listings
  for each row execute function set_updated_at();

-- Images are owned children of a listing.
create table listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  width integer
    constraint listing_images_width_positive check (width is null or width > 0),
  height integer
    constraint listing_images_height_positive check (height is null or height > 0),
  mime_type text not null,
  file_size_bytes bigint not null
    constraint listing_images_file_size_positive check (file_size_bytes > 0),
  image_hash text,
  created_at timestamptz not null default now()
);

-- Exactly one primary image per listing (min/max image counts are
-- configurable application behavior, not schema).
create unique index listing_images_one_primary_per_listing
  on listing_images (listing_id)
  where is_primary;

create table listing_features (
  listing_id uuid not null references listings (id) on delete cascade,
  feature_id uuid not null references features (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (listing_id, feature_id)
);

-- 30-day publication/renewal period history. listings.current_expires_at
-- remains the authoritative convenient current value for public queries.
create table listing_periods (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete restrict,
  period_number integer not null
    constraint listing_periods_number_positive check (period_number > 0),
  source listing_period_source not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  payment_id uuid, -- FK added in migration 006 (payments)
  status listing_period_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  constraint listing_periods_valid_range check (ends_at > starts_at),
  constraint listing_periods_number_unique_per_listing
    unique (listing_id, period_number)
);

-- CRITICAL business rule (CLAUDE.md): lifetime first-3-free
-- publication accounting. This immutable history table is the source
-- of truth — NOT a decrementable users.free_listings_left counter.
--
-- * one row per listing's INITIAL publication  -> unique (listing_id)
-- * per-user lifetime ordinal                  -> unique (user_id, publication_number)
--
-- Future service code must allocate publication_number atomically:
-- take a per-user lock (pg_advisory_xact_lock on a hash of user_id,
-- or SELECT ... FOR UPDATE on the users row), read
-- max(publication_number) for the user, insert max+1, and rely on the
-- unique constraint to reject any race (retry on conflict). Deleting
-- a listing never deletes its publication row, so free quota is never
-- restored. Edits, reject/resubmit, and renewals create NO new row.
create table listing_publications (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique references listings (id) on delete restrict,
  user_id uuid not null references users (id) on delete restrict,
  publication_number integer not null
    constraint listing_publications_number_positive check (publication_number > 0),
  billing_type billing_type not null,
  payment_id uuid, -- FK added in migration 006 (payments)
  created_at timestamptz not null default now(),
  constraint listing_publications_ordinal_unique_per_user
    unique (user_id, publication_number),
  constraint listing_publications_paid_requires_payment
    check (billing_type = 'FREE' or payment_id is not null)
);

create table favorites (
  user_id uuid not null references users (id) on delete cascade,
  listing_id uuid not null references listings (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- Aggregated counters only — raw per-view analytics belong to
-- PostHog, not to core PostgreSQL rows.
create table listing_stats (
  listing_id uuid primary key references listings (id) on delete cascade,
  view_count bigint not null default 0
    constraint listing_stats_view_count_nonnegative check (view_count >= 0),
  phone_reveal_count bigint not null default 0
    constraint listing_stats_phone_reveal_nonnegative check (phone_reveal_count >= 0),
  phone_click_count bigint not null default 0
    constraint listing_stats_phone_click_nonnegative check (phone_click_count >= 0),
  whatsapp_click_count bigint not null default 0
    constraint listing_stats_whatsapp_click_nonnegative check (whatsapp_click_count >= 0),
  updated_at timestamptz not null default now()
);

create trigger listing_stats_set_updated_at
  before update on listing_stats
  for each row execute function set_updated_at();
