import { listingImageConfig } from "@/lib/config/listing-images";
import { startJobRun } from "@/lib/jobs/log";
import { getSql, withTransaction } from "@/lib/server/db/client";
import { getStorageProvider } from "@/providers/storage/factory";
import {
  deleteExpiredGuestListing,
  deleteExpiredGuestSessions,
  listExpiredGuestListings,
  listListingStoragePaths,
} from "@/repositories/guest-drafts";

/**
 * Expired guest-draft cleanup (deferred-login PR A; prepared, NOT yet
 * scheduled as a Production cron).
 *
 * Database cascades do NOT delete private-storage objects, so the
 * order per listing is: enumerate the listing's storage paths from
 * the authoritative rows (processed finals in listing_images, temps
 * in listing_image_uploads — defensive for the later guest-image PR;
 * guests cannot upload today) → delete each object (idempotent:
 * providers treat a missing object as success) → ONLY on full storage
 * success, delete the listing row inside a transaction that re-checks
 * under lock that it is STILL an unclaimed guest draft whose session
 * expired past the grace window. A storage failure leaves the row in
 * place, so the next run retries — objects can never be orphaned by a
 * row deleted first. Sessions are removed last, only once they own no
 * listings. Every step is bounded and safe to run concurrently with
 * itself (the guarded DELETE makes double-processing a no-op).
 */

const CLEANUP_BATCH = 25;
const CLEANUP_MAX_BATCHES = 20;

function graceSecondsFromEnv(): number {
  const parsed = Number.parseInt(
    process.env.GUEST_DRAFT_CLEANUP_GRACE_SECONDS ?? "",
    10,
  );
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 86_400;
}

export interface GuestDraftCleanupSummary {
  listingsDeleted: number;
  objectsDeleted: number;
  sessionsDeleted: number;
  failed: number;
}

export async function runGuestDraftCleanup(
  options: { graceSeconds?: number } = {},
): Promise<GuestDraftCleanupSummary> {
  const log = startJobRun("cleanup-guest-drafts");
  const started = Date.now();
  const graceSeconds = options.graceSeconds ?? graceSecondsFromEnv();
  const bucket = listingImageConfig().imagesBucket;
  const storage = getStorageProvider();
  const sql = getSql();
  const summary: GuestDraftCleanupSummary = {
    listingsDeleted: 0,
    objectsDeleted: 0,
    sessionsDeleted: 0,
    failed: 0,
  };

  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch += 1) {
    const expired = await listExpiredGuestListings(sql, graceSeconds, CLEANUP_BATCH);
    if (expired.length === 0) break;
    let progressed = 0;
    for (const row of expired) {
      const paths = await listListingStoragePaths(sql, row.id);
      let storageOk = true;
      for (const path of paths) {
        try {
          await storage.deleteObject(bucket, path);
          summary.objectsDeleted += 1;
        } catch {
          storageOk = false;
          summary.failed += 1;
          log.event("storage_delete_failed", { listing_id: row.id });
          break; // retry this listing on a later run
        }
      }
      if (!storageOk) continue;
      const deleted = await withTransaction(async (tx) =>
        deleteExpiredGuestListing(tx, row.id, graceSeconds),
      );
      if (deleted) {
        summary.listingsDeleted += 1;
        progressed += 1;
      }
    }
    // Nothing progressed (all failures/races): stop instead of
    // re-selecting the same rows for CLEANUP_MAX_BATCHES loops.
    if (progressed === 0) break;
  }

  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch += 1) {
    const deleted = await deleteExpiredGuestSessions(sql, graceSeconds, CLEANUP_BATCH);
    summary.sessionsDeleted += deleted;
    if (deleted < CLEANUP_BATCH) break;
  }

  log.event("finished", { ...summary, duration_ms: Date.now() - started });
  return summary;
}
