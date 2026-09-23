-- O.14 — Owner-approved Premium/Boost package pricing (DATA ONLY).
--
-- Closes the Phase 4.13 "pricing unapproved / all disabled" production
-- checkpoint: the Owner-approved matrix ships ACTIVE, so deployment
-- alone makes exactly these packages purchasable — no manual
-- production activation step.
--
--   PREMIUM  1 gün  300   |  BOOST  3 gün  400
--   PREMIUM 10 gün 1199   |  BOOST  7 gün  800
--   PREMIUM 21 gün 2199   |  BOOST 10 gün 1100
--   PREMIUM 30 gün 3099   |  BOOST 15 gün 1300
--
-- Retired identities (PREMIUM 3/7, BOOST 1) keep their rows, names and
-- ids — historical stability for O.9 intent preferences and any
-- referencing payments — and are deactivated EXPLICITLY by identity,
-- never by a "not in today's matrix" rule that could disable a
-- legitimate future package on replay.
--
-- Safe by construction: package price/duration changes affect NEW
-- checkout resolution only — existing payments and listing_promotions
-- carry purchase-time snapshots and are never read back from this
-- catalog. promotion_packages has no (type, duration_days) uniqueness,
-- so every insert is NOT EXISTS-guarded; every statement is
-- re-runnable.

-- 1) Reprice the two surviving BOOST placeholders (never sellable in
--    production — the rows shipped is_active = false).
update promotion_packages set price_minor = 400
  where type = 'BOOST' and duration_days = 3;
update promotion_packages set price_minor = 800
  where type = 'BOOST' and duration_days = 7;

-- 2) New durations (existing naming convention; duplicate-guarded —
--    there is no (type, duration_days) unique constraint to rely on).
insert into promotion_packages (type, name, duration_days, price_minor, currency, is_active, sort_order)
select v.type::promotion_type, v.name, v.duration_days, v.price_minor, 'AZN', true, v.sort_order
from (values
  ('PREMIUM', 'Premium 10 gün', 10, 1199::bigint, 20),
  ('PREMIUM', 'Premium 21 gün', 21, 2199::bigint, 30),
  ('PREMIUM', 'Premium 30 gün', 30, 3099::bigint, 40),
  ('BOOST',   'Boost 10 gün',   10, 1100::bigint, 30),
  ('BOOST',   'Boost 15 gün',   15, 1300::bigint, 40)
) as v(type, name, duration_days, price_minor, sort_order)
where not exists (
  select 1 from promotion_packages p
  where p.type = v.type::promotion_type and p.duration_days = v.duration_days
);

-- 3) Activate exactly the Owner-approved matrix (idempotent when the
--    inserts above already created rows active).
update promotion_packages set is_active = true
  where ((type = 'PREMIUM' and duration_days in (1, 10, 21, 30))
      or (type = 'BOOST' and duration_days in (3, 7, 10, 15)))
    and not is_active;

-- 4) Retire the known legacy identities — explicit, by identity.
update promotion_packages set is_active = false
  where ((type = 'PREMIUM' and duration_days in (3, 7))
      or (type = 'BOOST' and duration_days = 1))
    and is_active;

-- 5) Deterministic per-type seller ordering (duration ascending);
--    retired rows sort after active ones within their type.
update promotion_packages set sort_order = 10 where type = 'PREMIUM' and duration_days = 1  and sort_order <> 10;
update promotion_packages set sort_order = 20 where type = 'PREMIUM' and duration_days = 10 and sort_order <> 20;
update promotion_packages set sort_order = 30 where type = 'PREMIUM' and duration_days = 21 and sort_order <> 30;
update promotion_packages set sort_order = 40 where type = 'PREMIUM' and duration_days = 30 and sort_order <> 40;
update promotion_packages set sort_order = 10 where type = 'BOOST' and duration_days = 3  and sort_order <> 10;
update promotion_packages set sort_order = 20 where type = 'BOOST' and duration_days = 7  and sort_order <> 20;
update promotion_packages set sort_order = 30 where type = 'BOOST' and duration_days = 10 and sort_order <> 30;
update promotion_packages set sort_order = 40 where type = 'BOOST' and duration_days = 15 and sort_order <> 40;
update promotion_packages set sort_order = 110 where type = 'PREMIUM' and duration_days = 3 and sort_order <> 110;
update promotion_packages set sort_order = 120 where type = 'PREMIUM' and duration_days = 7 and sort_order <> 120;
update promotion_packages set sort_order = 110 where type = 'BOOST' and duration_days = 1 and sort_order <> 110;
