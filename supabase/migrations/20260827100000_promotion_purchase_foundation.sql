-- 018 — Promotion purchases (Phase 4.13, additive only).
--
-- 1) Seed the MVP promotion package DEFINITIONS (durations/ordering).
--    promotion_packages rows are the configurable pricing source of
--    truth. The seeded price_minor values are UNAPPROVED placeholders,
--    so every package ships DISABLED (is_active = false): nothing is
--    sellable until the product owner approves pricing and activates
--    the rows explicitly. Server-side package eligibility (is_active)
--    is authoritative — there is no frontend exception. Prices are
--    integer minor units (AZN qəpik).
insert into promotion_packages (type, name, duration_days, price_minor, sort_order, is_active) values
  ('PREMIUM', 'Premium 1 gün', 1, 300, 10, false),
  ('PREMIUM', 'Premium 3 gün', 3, 700, 20, false),
  ('PREMIUM', 'Premium 7 gün', 7, 1200, 30, false),
  ('BOOST', 'Boost 1 gün', 1, 200, 40, false),
  ('BOOST', 'Boost 3 gün', 3, 500, 50, false),
  ('BOOST', 'Boost 7 gün', 7, 900, 60, false);

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
