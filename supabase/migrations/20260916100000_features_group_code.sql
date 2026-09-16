-- O.11 — Vehicle Equipment Catalog Expansion (Stage A).
--
-- One additive column: stable grouping metadata for equipment options.
-- Azerbaijani group labels stay in the frontend label constants (the
-- established localization pattern) — the database stores only the
-- stable group code (e.g. SAFETY, COMFORT).
--
-- Deliberately NULLABLE and WITHOUT a CHECK constraint limited to the
-- current seven CAR groups: legacy/dev features remain NULL ("Digər"
-- fallback in presentation), and a future MOTORCYCLE taxonomy must not
-- require another schema migration. No rows are touched: feature UUIDs,
-- listing_features relations, and all existing data stay as they are.
alter table features
  add column group_code text;
