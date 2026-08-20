-- 003 — Catalog domain: categories, brands, brand_categories, models,
-- cities, features, reference_groups, reference_options.
--
-- Catalog rows are deactivated with is_active, not deleted, in normal
-- operation. Referencing FKs therefore use ON DELETE RESTRICT.

create table categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_az text not null,
  slug text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger categories_set_updated_at
  before update on categories
  for each row execute function set_updated_at();

create table brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index brands_name_unique on brands (lower(name));

create trigger brands_set_updated_at
  before update on brands
  for each row execute function set_updated_at();

-- A brand can be relevant to more than one category (e.g. BMW builds
-- both cars and motorcycles).
create table brand_categories (
  brand_id uuid not null references brands (id) on delete cascade,
  category_id uuid not null references categories (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (brand_id, category_id)
);

create table models (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete restrict,
  category_id uuid not null references categories (id) on delete restrict,
  name text not null,
  slug text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint models_slug_unique_per_brand_category
    unique (brand_id, category_id, slug)
);

-- No duplicate model names within the same brand/category combination.
create unique index models_name_unique_per_brand_category
  on models (brand_id, category_id, lower(name));

create trigger models_set_updated_at
  before update on models
  for each row execute function set_updated_at();

create table cities (
  id uuid primary key default gen_random_uuid(),
  name_az text not null unique,
  slug text not null unique,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger cities_set_updated_at
  before update on cities
  for each row execute function set_updated_at();

-- Listing features (equipment/options). category_id NULL means the
-- feature applies to any category.
create table features (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_az text not null,
  category_id uuid references categories (id) on delete restrict,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger features_set_updated_at
  before update on features
  for each row execute function set_updated_at();

-- Controlled generic reference data for manageable groups
-- (FUEL_TYPE, TRANSMISSION, BODY_TYPE, DRIVE_TYPE, MOTORCYCLE_TYPE,
-- COLOR). New groups are inserted as data — no migration needed —
-- but this is NOT a generic replacement for real domain tables.
create table reference_groups (
  code text primary key,
  description text,
  created_at timestamptz not null default now()
);

create table reference_options (
  id uuid primary key default gen_random_uuid(),
  group_code text not null references reference_groups (code) on delete restrict,
  code text not null,
  name_az text not null,
  category_id uuid references categories (id) on delete restrict,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_options_code_unique_per_group unique (group_code, code)
);

create trigger reference_options_set_updated_at
  before update on reference_options
  for each row execute function set_updated_at();
