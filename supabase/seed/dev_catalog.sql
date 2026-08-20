-- =========================================================================
-- DEVELOPMENT-ONLY catalog sample data.
--
-- This is NOT the official AVTOSH.AZ catalog. It exists so local
-- development and manual testing have a small, realistic dataset.
-- Production brand/model/city/feature data must be imported from
-- verified sources via the importer (see data/catalog/README.md).
--
-- Idempotent: safe to apply repeatedly. Never applied by migrations.
--
-- Usage against a local development database:
--   psql "$DATABASE_URL" -f supabase/seed/dev_catalog.sql
-- =========================================================================

insert into brands (name, slug, sort_order) values
  ('Toyota', 'toyota', 1),
  ('Hyundai', 'hyundai', 2),
  ('BMW', 'bmw', 3),
  ('Honda', 'honda', 4),
  ('Yamaha', 'yamaha', 5)
on conflict (slug) do nothing;

insert into brand_categories (brand_id, category_id)
select b.id, c.id
from (values
  ('toyota', 'CAR'),
  ('hyundai', 'CAR'),
  ('bmw', 'CAR'),
  ('bmw', 'MOTORCYCLE'),
  ('honda', 'CAR'),
  ('honda', 'MOTORCYCLE'),
  ('yamaha', 'MOTORCYCLE')
) as link (brand_slug, category_code)
join brands b on b.slug = link.brand_slug
join categories c on c.code = link.category_code
on conflict do nothing;

insert into models (brand_id, category_id, name, slug, sort_order)
select b.id, c.id, m.name, m.slug, m.sort_order
from (values
  ('toyota', 'CAR', 'Corolla', 'corolla', 1),
  ('toyota', 'CAR', 'Camry', 'camry', 2),
  ('toyota', 'CAR', 'Prius', 'prius', 3),
  ('hyundai', 'CAR', 'Elantra', 'elantra', 1),
  ('hyundai', 'CAR', 'Sonata', 'sonata', 2),
  ('bmw', 'CAR', '3 Series', '3-series', 1),
  ('bmw', 'CAR', 'X5', 'x5', 2),
  ('bmw', 'MOTORCYCLE', 'R 1250 GS', 'r-1250-gs', 1),
  ('honda', 'CAR', 'Civic', 'civic', 1),
  ('honda', 'MOTORCYCLE', 'CBR600RR', 'cbr600rr', 1),
  ('yamaha', 'MOTORCYCLE', 'YZF-R6', 'yzf-r6', 1),
  ('yamaha', 'MOTORCYCLE', 'MT-07', 'mt-07', 2)
) as m (brand_slug, category_code, name, slug, sort_order)
join brands b on b.slug = m.brand_slug
join categories c on c.code = m.category_code
on conflict (brand_id, category_id, slug) do nothing;

insert into cities (name_az, slug, sort_order) values
  ('Bakı', 'baki', 1),
  ('Gəncə', 'gence', 2),
  ('Sumqayıt', 'sumqayit', 3)
on conflict (slug) do nothing;

insert into features (code, name_az, category_id, sort_order) values
  ('AIR_CONDITIONING', 'Kondisioner', (select id from categories where code = 'CAR'), 1),
  ('LEATHER_SEATS', 'Dəri salon', (select id from categories where code = 'CAR'), 2),
  ('PARKING_SENSOR', 'Park radarı', (select id from categories where code = 'CAR'), 3),
  ('REAR_CAMERA', 'Arxa görüntü kamerası', (select id from categories where code = 'CAR'), 4),
  ('ABS', 'ABS', null, 5)
on conflict (code) do nothing;
