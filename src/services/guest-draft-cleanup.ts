import { listingImageConfig } from "@/lib/config/listing-images";
import { startJobRun } from "@/lib/jobs/log";
import { getSql, withTransaction } from "@/lib/server/db/client";
import { getStorageProvider } from "@/providers/storage/factory";
import {
  GUEST_DRAFT_DELETED_EVENT,
  claimGuestCleanupEvents,
  condemnExpiredGuestListing,
  deleteExpiredGuestSessions,
  isUploadPathReferenced,
  listExpiredGuestListings,
  markAbandonedGuestCleanupEventsFailed,
  markGuestCleanupEventFailed,
  markGuestCleanupEventProcessed,
  markGuestCleanupEventRetry,
} from "@/repositories/guest-drafts";
import { isImagePathReferenced } from "@/repositories/lifecycle-jobs";
import { insertOutboxEvent } from "@/repositories/listing-publications";

/**
 * Expired guest-draft cleanup (deferred-login PR A; prepared, NOT yet
 * scheduled as a Production cron). Two phases, mirroring the sealed
 * O.12 storage-cleanup doctrine (durable candidates + execution-time
 * re-check + backoff), because database cascades never reach private
 * storage and a transaction must never span a storage network call:
 *
 * 1. CONDEMN (transaction, no network): per candidate listing,
 *    condemnExpiredGuestListing locks the listings row, re-checks
 *    under the lock that it is still an unclaimed guest draft past
 *    the grace window, enumerates finals/temps, deletes the row, and
 *    — in the SAME transaction — records a GUEST_DRAFT_DELETED outbox
 *    event carrying the bucket-separated paths. The row lock is the
 *    exclusion protocol with verify-and-claim (PR C): a claim is a
 *    single guarded transaction on the same listings row, so either
 *    the claim wins and the condemn re-check skips (storage never
 *    touched), or the condemn wins and the claim's guarded write
 *    matches zero rows. A successful claim can therefore never lose
 *    storage objects, regardless of which operation starts first.
 *
 * 2. STORAGE (no transaction): claimed events (skip-locked) drive the
 *    deletes — processed finals from imagesBucket, temp objects from
 *    uploadsBucket — each path behind an execution-time reference
 *    re-check. A storage failure returns the event to PENDING with
 *    backoff (FAILED after the attempt budget), so deletion stays
 *    retryable without ever resurrecting business rows. Claims carry a
 *    LEASE (available_at pushed forward): a worker that dies after
 *    claiming leaves PROCESSING + a lapsing lease, which a later run
 *    reclaims — object deletion is idempotent and reference-checked,
 *    so at-least-once delivery is safe; abandoned events past the
 *    attempt budget are retired as FAILED.
 *
 * Sessions are removed last, only once they own no listings. Every
 * step is bounded and safe to run concurrently with itself.
 */

const CLEANUP_BATCH = 25;
const CLEANUP_MAX_BATCHES = 20;
const CLEANUP_MAX_ATTEMPTS = 5;
const CLEANUP_RETRY_BASE_SECONDS = 600;
/** Worker lease per claimed event — generously above one event's
    storage work; a crashed worker's events reopen after this. */
const CLEANUP_LEASE_SECONDS = 600;

function graceSecondsFromEnv(): number {
  const parsed = Number.parseInt(
    process.env.GUEST_DRAFT_CLEANUP_GRACE_SECONDS ?? "",
    10,
  );
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 86_400;
}

export interface GuestDraftCleanupSummary {
  listingsDeleted: number;
  events: number;
  objectsDeleted: number;
  retained: number;
  retried: number;
  failed: number;
  sessionsDeleted: number;
}

function splitPaths(csv: string | undefined): string[] {
  return (csv ?? "")
    .split(",")
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
}

export async function runGuestDraftCleanup(
  options: { graceSeconds?: number } = {},
): Promise<GuestDraftCleanupSummary> {
  const log = startJobRun("cleanup-guest-drafts");
  const started = Date.now();
  const graceSeconds = options.graceSeconds ?? graceSecondsFromEnv();
  const config = listingImageConfig();
  const storage = getStorageProvider();
  const sql = getSql();
  const summary: GuestDraftCleanupSummary = {
    listingsDeleted: 0,
    events: 0,
    objectsDeleted: 0,
    retained: 0,
    retried: 0,
    failed: 0,
    sessionsDeleted: 0,
  };

  // Phase 1 — condemn: row deletion + durable storage record, atomic.
  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch += 1) {
    const expired = await listExpiredGuestListings(sql, graceSeconds, CLEANUP_BATCH);
    if (expired.length === 0) break;
    let progressed = 0;
    for (const row of expired) {
      const condemned = await withTransaction(async (tx) => {
        const result = await condemnExpiredGuestListing(tx, row.id, graceSeconds);
        if (!result.condemned) {
          return false;
        }
        if (result.imagePaths.length > 0 || result.uploadPaths.length > 0) {
          await insertOutboxEvent(tx, {
            eventType: GUEST_DRAFT_DELETED_EVENT,
            aggregateId: row.id,
            payload: {
              listing_id: row.id,
              cleanup_image_paths: result.imagePaths.join(","),
              cleanup_upload_paths: result.uploadPaths.join(","),
            },
          });
        }
        return true;
      });
      if (condemned) {
        summary.listingsDeleted += 1;
        progressed += 1;
      }
    }
    // Nothing progressed (claims/races won everywhere): stop instead
    // of re-selecting the same rows for CLEANUP_MAX_BATCHES loops.
    if (progressed === 0) break;
  }

  // Phase 2 — storage: bucket-correct deletes from the durable record.
  // First retire budget-exhausted events (PENDING or PROCESSING with a
  // lapsed available_at) into a terminal, visible FAILED state.
  summary.failed += await markAbandonedGuestCleanupEventsFailed(sql, {
    maxAttempts: CLEANUP_MAX_ATTEMPTS,
    limit: CLEANUP_BATCH,
  });
  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch += 1) {
    const events = await claimGuestCleanupEvents(sql, {
      limit: CLEANUP_BATCH,
      leaseSeconds: CLEANUP_LEASE_SECONDS,
      maxAttempts: CLEANUP_MAX_ATTEMPTS,
    });
    if (events.length === 0) break;
    for (const event of events) {
      summary.events += 1;
      let failure: string | null = null;
      const targets: { bucket: string; path: string; kind: "image" | "upload" }[] = [
        ...splitPaths(event.payload.cleanup_image_paths).map((path) => ({
          bucket: config.imagesBucket,
          path,
          kind: "image" as const,
        })),
        ...splitPaths(event.payload.cleanup_upload_paths).map((path) => ({
          bucket: config.uploadsBucket,
          path,
          kind: "upload" as const,
        })),
      ];
      for (const target of targets) {
        // Authoritative re-check AT EXECUTION TIME — never trust the
        // event payload alone (O.12 doctrine).
        const referenced =
          target.kind === "image"
            ? await isImagePathReferenced(sql, target.path)
            : await isUploadPathReferenced(sql, target.path);
        if (referenced) {
          summary.retained += 1;
          log.event("candidate_retained", { event_id: event.id, path: target.path });
          continue;
        }
        try {
          await storage.deleteObject(target.bucket, target.path);
          summary.objectsDeleted += 1;
        } catch (error) {
          failure = error instanceof Error ? error.message : "storage delete failed";
          log.event("delete_failed", { event_id: event.id, path: target.path });
          break; // retry the whole event later (deletes are idempotent)
        }
      }
      // Marks are FENCED to this worker's claim generation
      // (attempt_count at claim): if the lease was outrun and another
      // run reclaimed the event, every mark below matches zero rows —
      // a stale worker can never move the current holder's claim.
      if (failure === null) {
        const marked = await markGuestCleanupEventProcessed(sql, {
          id: event.id,
          claimAttempt: event.attempt_count,
        });
        if (!marked) log.event("mark_fenced_out", { event_id: event.id });
      } else if (event.attempt_count >= CLEANUP_MAX_ATTEMPTS) {
        summary.failed += 1;
        await markGuestCleanupEventFailed(sql, {
          id: event.id,
          claimAttempt: event.attempt_count,
          error: failure,
        });
      } else {
        summary.retried += 1;
        await markGuestCleanupEventRetry(sql, {
          id: event.id,
          claimAttempt: event.attempt_count,
          retryAt: new Date(
            Date.now() + CLEANUP_RETRY_BASE_SECONDS * 1000 * event.attempt_count,
          ),
          error: failure,
        });
      }
    }
    if (events.length < CLEANUP_BATCH) break;
  }

  // Phase 3 — sessions that no longer own anything.
  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch += 1) {
    const deleted = await deleteExpiredGuestSessions(sql, graceSeconds, CLEANUP_BATCH);
    summary.sessionsDeleted += deleted;
    if (deleted < CLEANUP_BATCH) break;
  }

  log.event("finished", { ...summary, duration_ms: Date.now() - started });
  return summary;
}
