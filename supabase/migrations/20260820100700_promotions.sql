-- 007 — Promotion domain: promotion_packages, listing_promotions.
--
-- Each purchase creates its own listing_promotions row (separate
-- purchase/promotion history — never one mutable row). A listing may
-- hold PREMIUM and BOOST simultaneously; same-type periods must not
-- overlap because a repurchase queues after existing active/scheduled
-- time (enforced by an exclusion constraint via btree_gist).

create table promotion_packages (
  id uuid primary key default gen_random_uuid(),
  type promotion_type not null,
  name text not null,
  duration_days integer not null
    constraint promotion_packages_duration_positive check (duration_days > 0),
  price_minor bigint not null
    constraint promotion_packages_price_nonnegative check (price_minor >= 0),
  currency char(3) not null default 'AZN'
    constraint promotion_packages_currency_shape check (currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger promotion_packages_set_updated_at
  before update on promotion_packages
  for each row execute function set_updated_at();

create table listing_promotions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete restrict,
  type promotion_type not null,
  package_id uuid references promotion_packages (id) on delete restrict,
  payment_id uuid not null references payments (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status promotion_status not null default 'SCHEDULED',
  -- Purchase-time snapshots: package rows are mutable, history is not.
  purchased_duration_days integer not null
    constraint listing_promotions_duration_positive
      check (purchased_duration_days > 0),
  purchased_price_minor bigint not null
    constraint listing_promotions_price_nonnegative
      check (purchased_price_minor >= 0),
  created_at timestamptz not null default now(),
  constraint listing_promotions_valid_range check (ends_at > starts_at),
  -- No overlapping SCHEDULED/ACTIVE periods of the same type on one
  -- listing. '[)' bounds let a queued period start exactly when the
  -- previous one ends.
  constraint listing_promotions_no_same_type_overlap
    exclude using gist (
      listing_id with =,
      type with =,
      tstzrange(starts_at, ends_at, '[)') with &&
    ) where (status in ('SCHEDULED', 'ACTIVE'))
);

-- Deferred FK from 006: a payment may reference the purchased package.
alter table payments
  add column promotion_package_id uuid
    references promotion_packages (id) on delete restrict;
