-- Guest draft foundation (deferred-login listing project, PR A).
--
-- Server-owned guest capabilities: an anonymous visitor's drafts are
-- bound to an opaque guest_draft_sessions row (the browser holds only
-- the random token; the hash lives here — same discipline as
-- sessions.token_hash). Additive and fail-closed: nothing reads these
-- tables unless GUEST_DRAFTS_ENABLED=true.
--
-- Ownership invariants (database-enforced, not application-trusted):
--   * every listing has EXACTLY ONE owner: a real user XOR a guest
--     draft session;
--   * a guest-owned listing can only ever be a DRAFT — submission,
--     payment, moderation and every public surface therefore keep the
--     guarantee that a non-DRAFT listing always has a real user owner.
-- Existing owner-scoped queries (owner_id = $user) are NULL-safe by
-- SQL semantics: a guest row (owner_id IS NULL) never matches.

create table guest_draft_sessions (
  id uuid primary key default gen_random_uuid(),
  -- hex SHA-256 of the opaque token, never the token itself
  token_hash varchar(128) not null unique,
  -- hashed client IP (same pepper/shape as otp_challenges.ip_hash)
  ip_hash varchar(128),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- fixed lifetime set at issuance; validity is checked at query time
  expires_at timestamptz not null
);

create index guest_draft_sessions_expires_idx
  on guest_draft_sessions (expires_at);
create index guest_draft_sessions_ip_created_idx
  on guest_draft_sessions (ip_hash, created_at)
  where ip_hash is not null;

alter table listings
  alter column owner_id drop not null;

alter table listings
  add column guest_session_id uuid
    references guest_draft_sessions (id) on delete restrict;

-- Exactly one owner, always.
alter table listings
  add constraint listings_exactly_one_owner check (
    (owner_id is not null and guest_session_id is null)
    or (owner_id is null and guest_session_id is not null)
  );

-- A guest-owned listing is a DRAFT and nothing else — claiming (PR C)
-- sets owner_id and clears guest_session_id before any submission.
alter table listings
  add constraint listings_guest_only_draft check (
    guest_session_id is null or status = 'DRAFT'
  );

create index listings_guest_session_idx
  on listings (guest_session_id)
  where guest_session_id is not null;
