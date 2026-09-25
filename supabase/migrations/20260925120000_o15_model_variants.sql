-- O.15 — Model variant ("Alt model") level under model families.
--
-- A model row stays the family; a model_variants row is one Alt
-- model inside that family. Families without variants simply have no
-- rows here. listings.model_variant_id is NULLABLE: legacy listings
-- and zero-variant families store NULL, and the application enforces
-- the conditional requirement (CAR family with active variants =>
-- variant required) — the schema only guarantees integrity.

create table model_variants (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references models (id) on delete restrict,
  name text not null,
  slug text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint model_variants_slug_unique_per_model unique (model_id, slug)
);

-- No duplicate variant names within one family.
create unique index model_variants_name_unique_per_model
  on model_variants (model_id, lower(name));

create trigger model_variants_set_updated_at
  before update on model_variants
  for each row execute function set_updated_at();

alter table listings
  add column model_variant_id uuid references model_variants (id) on delete restrict;

-- A chosen variant must belong to the chosen model. Enforced with a
-- composite FK so a listing can never pair variant X with model Y.
alter table model_variants
  add constraint model_variants_id_model_unique unique (id, model_id);

alter table listings
  add constraint listings_variant_belongs_to_model
    foreign key (model_variant_id, model_id)
    references model_variants (id, model_id);

-- MATCH SIMPLE skips the composite FK when either column is NULL, so
-- rule out a variant without its model explicitly.
alter table listings
  add constraint listings_variant_requires_model
    check (model_variant_id is null or model_id is not null);

-- Search filtering: only listings that actually carry a variant.
create index listings_model_variant_idx
  on listings (model_variant_id)
  where model_variant_id is not null;

-- Variant pickers: active variants of a family, in display order.
create index model_variants_model_active_idx
  on model_variants (model_id, is_active, sort_order, name);
