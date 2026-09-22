-- O.13 Stage B — moderator adjustment foundation (sealed O.13.2
-- architecture, ChatGPT corrections A–H).
--
-- ONE private working snapshot per moderation pass. Moderator edits
-- NEVER mutate seller artifacts (listings content, listing_features,
-- listing_images, listing_edit_revisions.data, listing_edit_images):
-- the seller submission is frozen here as immutable evidence at the
-- FIRST moderator save (submitted_data + submitted_images), and the
-- moderator's working copy lives in adjusted_data + image_plan.
--
-- Additive only. No backfill: pre-O.13 moderation history has no
-- adjustments and no snapshots are fabricated for it.

create type moderation_adjustment_status as enum ('OPEN', 'DISCARDED', 'APPLIED');

create table moderation_adjustments (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings (id) on delete cascade,
  -- LISTING_EDIT subject only; null = NEW_LISTING subject
  edit_revision_id uuid references listing_edit_revisions (id) on delete cascade,
  status moderation_adjustment_status not null default 'OPEN',
  -- moderation-subject identity at freeze time: an adjustment can
  -- never silently attach to a later seller pass
  submitted_listing_revision integer not null,
  submitted_edit_revision_no integer,
  -- frozen seller evidence (first-save snapshot; never updated after)
  submitted_data jsonb not null,
  submitted_images jsonb not null,
  -- moderator working copy (same seller field space; private)
  adjusted_data jsonb not null,
  image_plan jsonb not null,
  -- CURRENT saved-state author (full lineage lives in append-only
  -- audit_logs — correction G; this is never the only attribution)
  moderator_id uuid not null references users (id),
  -- the adjustment's OWN optimistic counter (correction F)
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  discarded_at timestamptz,
  applied_at timestamptz,
  constraint moderation_adjustments_edit_subject_consistent check (
    (edit_revision_id is null) = (submitted_edit_revision_no is null)
  ),
  constraint moderation_adjustments_terminal_timestamps check (
    (status = 'DISCARDED') = (discarded_at is not null)
    and (status = 'APPLIED') = (applied_at is not null)
  )
);

-- at most ONE OPEN adjustment per listing: moderation subjects are
-- already serialized per listing (one claim, one pending pass), and
-- the partial unique index arbitrates concurrent first saves
create unique index moderation_adjustments_one_open
  on moderation_adjustments (listing_id)
  where status = 'OPEN';

create index moderation_adjustments_listing_created_idx
  on moderation_adjustments (listing_id, created_at desc);

create index moderation_adjustments_edit_revision_idx
  on moderation_adjustments (edit_revision_id)
  where edit_revision_id is not null;
