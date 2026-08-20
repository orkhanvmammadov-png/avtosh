-- 005 — Moderation domain: moderation_reviews, listing_status_history,
-- moderation_claims, listing_reports.

-- Every moderation decision is recorded against the listing revision
-- it reviewed, preventing stale approvals.
create table moderation_reviews (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete restrict,
  moderator_id uuid not null references users (id) on delete restrict,
  listing_revision integer not null
    constraint moderation_reviews_revision_positive check (listing_revision > 0),
  decision moderation_decision not null,
  reason_code text,
  note text,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Status transition history. listings.status remains the current
-- state; this table is history only. actor_user_id is NULL for
-- SYSTEM transitions (e.g. expiry job).
create table listing_status_history (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete restrict,
  from_status listing_status,
  to_status listing_status not null,
  actor_user_id uuid references users (id) on delete set null,
  actor_type actor_type not null,
  reason_code text,
  notes text,
  created_at timestamptz not null default now()
);

-- Transient soft claim/lock so two moderators do not review the same
-- listing simultaneously. Deliberately separate from listing business
-- state. Claim logic (expiry, takeover) is future service code.
create table moderation_claims (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete cascade,
  moderator_id uuid not null references users (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  constraint moderation_claims_valid_expiry check (expires_at > claimed_at)
);

-- At most one unreleased claim per listing.
create unique index moderation_claims_one_active_per_listing
  on moderation_claims (listing_id)
  where released_at is null;

-- Listing reports; anonymous reporting supported. Raw IP addresses
-- are deliberately NOT stored here — IP-level abuse protection lives
-- in the rate-limiting layer, not in report rows.
create table listing_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete restrict,
  reporter_user_id uuid references users (id) on delete set null,
  anonymous_session_id text,
  reason_code text not null,
  note text,
  status report_status not null default 'OPEN',
  resolved_by uuid references users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
