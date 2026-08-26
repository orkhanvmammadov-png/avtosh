-- 018 — Promotion purchases (Phase 4.13, additive only).
--
-- 1) Seed the MVP promotion packages. promotion_packages rows are the
--    configurable pricing source of truth (admin-editable later);
--    these defaults are launch placeholders — see
--    docs/architecture/promotion-purchases.md. Prices are integer
--    minor units (AZN qəpik).
insert into promotion_packages (type, name, duration_days, price_minor, sort_order) values
  ('PREMIUM', 'Premium 1 gün', 1, 300, 10),
  ('PREMIUM', 'Premium 3 gün', 3, 700, 20),
  ('PREMIUM', 'Premium 7 gün', 7, 1200, 30),
  ('BOOST', 'Boost 1 gün', 1, 200, 40),
  ('BOOST', 'Boost 3 gün', 3, 500, 50),
  ('BOOST', 'Boost 7 gün', 7, 900, 60);

-- 2) Purchase-intent idempotency: at most ONE open (CREATED or
--    PENDING) promotion intent per listing and promotion type.
--    Double clicks, repeated POSTs, and concurrent purchase requests
--    all converge on the single open intent; a new same-type purchase
--    becomes possible the moment the previous one reaches a terminal
--    state (SUCCESS/CANCELLED/...), so legitimate sequential
--    purchases are never blocked. This also makes same-type
--    concurrent unpaid intents structurally impossible — the first of
--    three layers (open-intent index → listing row lock → GiST
--    exclusion) protecting paid duration from lost updates.
create unique index payments_open_promotion_intent
  on payments (listing_id, type)
  where status in ('CREATED', 'PENDING') and type in ('PREMIUM', 'BOOST');
