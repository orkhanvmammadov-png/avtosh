-- O.16 — Complimentary Premium campaign (time-limited enrollment).
-- ADDITIVE ONLY and grants NOTHING by itself: campaign activation and
-- the backfill are explicit owner-run operations (scripts/campaign/
-- premium-campaign.mts), never a deployment side effect.

create table premium_campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  grant_days integer not null
    constraint premium_campaigns_grant_days_positive check (grant_days > 0),
  -- Business-facing dates are Asia/Baku; storage is timestamptz.
  -- The enrollment window is EXACTLY grant-window hours (activation
  -- script computes ends = starts + 30*24h); a listing approved at
  -- the final minute still receives its FULL grant_days — the window
  -- bounds enrollment, never the benefit.
  enrollment_starts_at timestamptz not null,
  enrollment_ends_at timestamptz not null,
  -- Lifecycle: DRAFT (prepared; dry-runs allowed, NO grants possible)
  -- → ENROLLING (the one explicit opening operation; grants require
  -- this status AND now within the window, checked FOR SHARE inside
  -- every grant transaction) → STOPPED (terminal; issued grants
  -- untouched).
  status text not null default 'DRAFT'
    constraint premium_campaigns_status_allowed check (status in ('DRAFT', 'ENROLLING', 'STOPPED')),
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  stopped_at timestamptz,
  constraint premium_campaigns_window_valid
    check (enrollment_ends_at > enrollment_starts_at)
);

-- Complimentary periods live in listing_promotions so every existing
-- surface (badge, Premium feed, owner "premium until", housekeeping,
-- the no-same-type-overlap exclusion) applies unchanged. The source
-- discriminator makes the paid invariant STRONGER than before:
-- a PAID row must carry its payment and never a campaign; a CAMPAIGN
-- row must carry its campaign and never a payment. Existing rows are
-- all PAID (default) and already satisfy it.
alter table listing_promotions
  alter column payment_id drop not null;
alter table listing_promotions
  add column source text not null default 'PAID'
    constraint listing_promotions_source_allowed check (source in ('PAID', 'CAMPAIGN'));
alter table listing_promotions
  add column campaign_id uuid references premium_campaigns (id) on delete restrict;
alter table listing_promotions
  add constraint listing_promotions_source_integrity check (
    (source = 'PAID' and payment_id is not null and campaign_id is null)
    or
    (source = 'CAMPAIGN' and payment_id is null and campaign_id is not null)
  );

-- One complimentary grant per listing per campaign — the idempotency
-- backbone for backfill re-runs, repeated moderation callbacks and
-- concurrent requests.
create unique index listing_promotions_one_campaign_grant
  on listing_promotions (listing_id, campaign_id)
  where campaign_id is not null;
