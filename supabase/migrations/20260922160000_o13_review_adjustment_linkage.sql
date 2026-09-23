-- O.13 Stage C — review ↔ adjustment linkage.
--
-- A moderation decision made over a saved moderator adjustment must
-- record EXACTLY which adjustment version it decided (id + the
-- adjustment's own revision counter at decision time) — never only a
-- mutable pointer. Additive, nullable, no backfill: every pre-O.13
-- review simply has no adjustment.
alter table moderation_reviews
  add column adjustment_id uuid references moderation_adjustments (id),
  add column adjustment_revision integer;

alter table moderation_reviews
  add constraint moderation_reviews_adjustment_consistent check (
    (adjustment_id is null) = (adjustment_revision is null)
  );
