-- 015 — Public search default-sort index (Phase 4.8).
--
-- Query: the most common marketplace query is "category + NEWEST":
--   WHERE status = 'ACTIVE' AND current_expires_at > now()
--     AND category_id = $1
--   ORDER BY published_at DESC, id DESC LIMIT n
-- The accepted listings_active_search index leads with
-- (category_id, brand_id, model_id, published_at), so without brand/
-- model it cannot deliver published_at order and EXPLAIN ANALYZE at
-- 20k rows showed Seq Scan + top-N sort. This partial index matches
-- the sort exactly, so LIMIT stops after n index entries.
create index listings_active_category_newest
  on listings (category_id, published_at desc, id desc)
  where status = 'ACTIVE';
