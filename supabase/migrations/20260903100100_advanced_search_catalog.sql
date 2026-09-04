-- Phase 4.17O.2 — owner-approved fuel/transmission/color catalog
-- (reference data only; no schema change, no listing-data rewrite).
--
-- Rules honored here:
--  * existing stable ids/codes are NEVER re-keyed or deleted;
--  * label renames change display only (listing FKs untouched);
--  * AUTOMATIC is interpreted as the conventional AT category per the
--    explicit owner decision (ROBOT and CVT were always separate
--    codes, so the remaining generic AUTOMATIC maps to AT);
--  * color swatch hexes are PRESENTATION metadata (metadata.swatch),
--    never part of catalog identity.

-- --- FUEL_TYPE ------------------------------------------------------
update reference_options set name_az = 'Elektro', sort_order = 5
  where group_code = 'FUEL_TYPE' and code = 'ELECTRIC';
update reference_options set sort_order = 1 where group_code = 'FUEL_TYPE' and code = 'PETROL';
update reference_options set sort_order = 2 where group_code = 'FUEL_TYPE' and code = 'DIESEL';
update reference_options set sort_order = 3 where group_code = 'FUEL_TYPE' and code = 'GAS';
update reference_options set sort_order = 6 where group_code = 'FUEL_TYPE' and code = 'HYBRID';

insert into reference_options (group_code, code, name_az, sort_order) values
  ('FUEL_TYPE', 'HYDROGEN', 'Hidrogen', 4),
  ('FUEL_TYPE', 'PLUGIN_HYBRID', 'Plug-İn Hibrid', 7),
  ('FUEL_TYPE', 'DIESEL_HYBRID', 'Dizel-Hibrid', 8)
on conflict (group_code, code) do nothing;

-- --- TRANSMISSION ---------------------------------------------------
update reference_options set name_az = 'Avtomat (AT)', sort_order = 2
  where group_code = 'TRANSMISSION' and code = 'AUTOMATIC';
update reference_options set name_az = 'Avtomatik (Robot)', sort_order = 3
  where group_code = 'TRANSMISSION' and code = 'ROBOT';
update reference_options set name_az = 'Mexaniki (MT)', sort_order = 5
  where group_code = 'TRANSMISSION' and code = 'MANUAL';
update reference_options set name_az = 'Avtomat (Variator)', sort_order = 6
  where group_code = 'TRANSMISSION' and code = 'CVT';

insert into reference_options (group_code, code, name_az, sort_order) values
  ('TRANSMISSION', 'DHT', 'Avtomat (DHT)', 1),
  ('TRANSMISSION', 'REDUCER', 'Avtomat (Reduktor)', 4)
on conflict (group_code, code) do nothing;

-- --- COLOR ----------------------------------------------------------
-- Owner-approved order (1..20) + presentation swatches.
insert into reference_options (group_code, code, name_az, sort_order) values
  ('COLOR', 'ASPHALT_GREEN', 'Yaşıl Asfalt', 2),
  ('COLOR', 'DARK_RED', 'Tünd qırmızı', 7),
  ('COLOR', 'PINK', 'Çəhrayı', 9),
  ('COLOR', 'GOLD', 'Qızılı', 11),
  ('COLOR', 'KHAKI', 'Xaki', 13),
  ('COLOR', 'DARK_GREEN', 'Tünd yaşıl', 14),
  ('COLOR', 'LIGHT_GREEN', 'Açıq Yaşıl', 16),
  ('COLOR', 'LIGHT_BLUE', 'Mavi', 17)
on conflict (group_code, code) do nothing;

update reference_options set sort_order = v.sort_order,
  metadata = metadata || jsonb_build_object('swatch', v.swatch)
from (values
  ('BLACK',         1, '#1B1E24'),
  ('ASPHALT_GREEN', 2, '#3D4A43'),
  ('GRAY',          3, '#8A8F98'),
  ('SILVER',        4, '#C9CDD2'),
  ('WHITE',         5, '#FFFFFF'),
  ('BEIGE',         6, '#E4D5BC'),
  ('DARK_RED',      7, '#7C1E1E'),
  ('RED',           8, '#C62828'),
  ('PINK',          9, '#E06C9F'),
  ('ORANGE',       10, '#E8702A'),
  ('GOLD',         11, '#C9A24B'),
  ('YELLOW',       12, '#F2C230'),
  ('KHAKI',        13, '#8A7D4A'),
  ('DARK_GREEN',   14, '#14532D'),
  ('GREEN',        15, '#2E7D32'),
  ('LIGHT_GREEN',  16, '#A3CC5A'),
  ('LIGHT_BLUE',   17, '#5AA7E0'),
  ('BLUE',         18, '#1E4FBF'),
  ('PURPLE',       19, '#7B3FA0'),
  ('BROWN',        20, '#6D4C33')
) as v(code, sort_order, swatch)
where reference_options.group_code = 'COLOR' and reference_options.code = v.code;
