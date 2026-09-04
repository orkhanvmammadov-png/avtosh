-- Phase 4.17O.2 — seller vehicle-condition claims (additive only).
--
-- Semantics:
--   TRUE  = the seller explicitly makes the positive claim
--           ("Vuruğu yoxdur" / "Rənglənməyib").
--   NULL  = no positive claim / unknown — including every historical
--           listing. Historical rows are NOT backfilled or inferred.
--   FALSE = never required by the product; the application does not
--           write or depend on FALSE for this feature.
--
-- Search filters match only explicit TRUE.

alter table listings
  add column no_accident boolean,
  add column not_repainted boolean;

comment on column listings.no_accident is
  'Seller positive claim "Vuruğu yoxdur"; NULL = no claim/unknown (never inferred).';
comment on column listings.not_repainted is
  'Seller positive claim "Rənglənməyib"; NULL = no claim/unknown (never inferred).';
