-- Phase 4.17O.9 — AXIN seller flow draft fields (additive only).
--
-- seller_name: listing-level public seller display name. Nullable so
-- drafts save progressively; submission/resubmission REQUIRE it
-- (enforced in the service layer). Public detail resolves
-- listing.seller_name -> users.display_name -> "Satıcı"; legacy rows
-- stay NULL on purpose (no backfill).
--
-- *_intent_package_id: the seller's creation-time promotion
-- PREFERENCE per type. Pure UX data — never a payment source of
-- truth: checkout still re-resolves a currently ACTIVE package with
-- server-side pricing and requires listing = ACTIVE. ON DELETE SET
-- NULL because a preference must never block package management,
-- unlike the restrictive FKs on historical payments/periods.

alter table listings
  add column seller_name varchar(100),
  add column premium_intent_package_id uuid
    references promotion_packages (id) on delete set null,
  add column boost_intent_package_id uuid
    references promotion_packages (id) on delete set null;
