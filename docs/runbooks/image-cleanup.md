# O.12 image orphan cleanup worker

`GET /api/jobs/cleanup-images` (cron, every 6h; `CRON_SECRET`-guarded like
every job route) runs `runImageCleanup()`.

## What it does

O.12 edit flows never delete storage objects synchronously. Instead they
emit **cleanup candidates** on existing outbox events
(`cleanup_candidate_paths`, comma-joined) from:

- seller cancel of an edit revision (`LISTING_EDIT_CANCELLED`)
- seller removal of a staged image (`LISTING_EDIT_IMAGE_REMOVED`)
- approval gallery replacement (`LISTING_EDIT_APPROVED` — the replaced
  approved paths that left the public gallery)
- edit rejection (`LISTING_EDIT_REJECTED` — emitted for symmetry; under
  the retention policy below its candidates resolve as RETAINED)

The worker claims a bounded batch of candidate-bearing events
(`for update skip locked`, so overlapping runs are safe), and for each
path performs the **authoritative reference check at execution time**:

> deletable ⇔ not referenced by `listing_images`
> AND not referenced by `listing_edit_images`
> AND the event is older than the grace interval
> (`IMAGE_CLEANUP_GRACE_SECONDS`, default 86400 = 24h).

The event payload is never trusted on its own. Referenced paths are
logged `candidate_retained` and the event still completes (that is its
terminal, correct outcome). Storage-delete failures return the event to
`PENDING` with backoff (`FAILED` after 5 attempts) and never touch
business data — cleanup is eventual housekeeping.

## Retention policy (O.12 MVP — sealed)

- **APPROVED revisions**: `listing_edit_images` rows are retained as
  moderation/audit history. They are genuine references — objects they
  point at are never orphans. This can retain old image objects
  longer-term; accepted for MVP.
- **REJECTED / CANCELLED revisions**: staged rows are likewise retained
  (one consistent model: history rows are always references). Their
  candidate events resolve as RETAINED. Revision-only objects whose
  staged ROW was deleted by the seller during editing are the true
  orphans this worker actually deletes.
- Future storage-retention optimization (pruning terminal-revision
  history and then re-running cleanup) is explicitly deferred past
  O.12; do not add destructive pruning without a new phase decision.

## Observability

Structured job logs: `job.started` / `candidate_retained` /
`object_deleted` / `delete_failed` / `job.finished` with
`{events, deleted, retained, retried, failed}` — same conventions as the
other lifecycle jobs.
