import { getSql, withTransaction } from "@/lib/server/db/client";
import { startJobRun } from "@/lib/jobs/log";
import { listingImageConfig } from "@/lib/config/listing-images";
import { getStorageProvider } from "@/providers/storage/factory";
import {
  claimCleanupEvents,
  claimDueNotifications,
  deferNotification,
  expireListingsBatch,
  markNotificationCancelled,
  markNotificationFailed,
  markNotificationSent,
  promotionHousekeepingBatch,
  isImagePathReferenced,
  markCleanupEventFailed,
  markCleanupEventProcessed,
  markCleanupEventRetry,
  reminderEligibility,
  scheduleExpiryReminders,
  scheduleNotificationRetry,
} from "@/repositories/lifecycle-jobs";
import { getWhatsAppNotificationProvider } from "@/providers/whatsapp/notification-factory";
import { WhatsAppNotificationError } from "@/providers/whatsapp/notification-types";
import { reconcileProviderPayments } from "@/services/payment-checkout";

/**
 * Phase 4.16 background workers. All idempotent, all safe under
 * overlapping executions (DB-level claiming), all bounded — a worker
 * never loads the full backlog into memory. Public visibility never
 * waits for these jobs (the time-window read conditions are the
 * authority); they synchronize DURABLE state and deliver side
 * channels.
 */

const EXPIRY_BATCH = 100;
const EXPIRY_MAX_BATCHES = 20;
const PROMOTION_BATCH = 200;
const PROMOTION_MAX_BATCHES = 10;
const NOTIFICATION_BATCH = 50;
const NOTIFICATION_MAX_ATTEMPTS = 5;
const NOTIFICATION_RETRY_BASE_SECONDS = 300;
const SUSPENDED_DEFER_SECONDS = 3600;

export interface ExpiryRunSummary {
  expired: number;
  batches: number;
}

/** ACTIVE + current_expires_at <= now() → EXPIRED, exactly once each. */
export async function runListingExpiry(): Promise<ExpiryRunSummary> {
  const log = startJobRun("expire-listings");
  const started = Date.now();
  let expired = 0;
  let batches = 0;
  for (; batches < EXPIRY_MAX_BATCHES; batches += 1) {
    const ids = await withTransaction(async (tx) => expireListingsBatch(tx, EXPIRY_BATCH));
    expired += ids.length;
    if (ids.length < EXPIRY_BATCH) {
      batches += 1;
      break;
    }
  }
  log.event("finished", { expired, batches, duration_ms: Date.now() - started });
  return { expired, batches };
}

export interface PromotionHousekeepingSummary {
  activated: number;
  expired: number;
}

/** Durable SCHEDULED→ACTIVE→EXPIRED promotion status sync. */
export async function runPromotionHousekeeping(): Promise<PromotionHousekeepingSummary> {
  const log = startJobRun("promotion-housekeeping");
  const started = Date.now();
  const summary: PromotionHousekeepingSummary = { activated: 0, expired: 0 };
  for (let i = 0; i < PROMOTION_MAX_BATCHES; i += 1) {
    const batch = await withTransaction(async (tx) =>
      promotionHousekeepingBatch(tx, PROMOTION_BATCH),
    );
    summary.activated += batch.activated;
    summary.expired += batch.expired;
    if (batch.activated < PROMOTION_BATCH && batch.expired < PROMOTION_BATCH) {
      break;
    }
  }
  log.event("finished", { ...summary, duration_ms: Date.now() - started });
  return summary;
}

export interface ReminderRunSummary {
  providerConfigured: boolean;
  scheduled: number;
  claimed: number;
  sent: number;
  cancelled: number;
  deferred: number;
  retried: number;
  failed: number;
  rowErrors: number;
}

/**
 * Expiry-reminder pass: (1) idempotently schedule the 7/5/3/1-day
 * rows for periods entering the horizon, then (2) claim + deliver due
 * rows. Without a configured provider the job schedules but sends
 * NOTHING — rows stay safely SCHEDULED; delivery is never fabricated.
 */
export async function runExpiryReminders(): Promise<ReminderRunSummary> {
  const log = startJobRun("send-reminders");
  const started = Date.now();
  const sql = getSql();
  const summary: ReminderRunSummary = {
    providerConfigured: false,
    scheduled: 0,
    claimed: 0,
    sent: 0,
    cancelled: 0,
    deferred: 0,
    retried: 0,
    failed: 0,
    rowErrors: 0,
  };

  summary.scheduled = await scheduleExpiryReminders(sql);

  const provider = getWhatsAppNotificationProvider();
  if (provider === null) {
    log.event("provider_unconfigured", { scheduled: summary.scheduled });
    log.event("finished", { ...flat(summary), duration_ms: Date.now() - started });
    return summary;
  }
  summary.providerConfigured = true;

  // Claiming loops until a batch comes back short.
  for (;;) {
    const claimed = await withTransaction(async (tx) =>
      claimDueNotifications(tx, NOTIFICATION_BATCH),
    );
    summary.claimed += claimed.length;
    for (const notification of claimed) {
      // Row-level isolation: one malformed row must not sink the batch.
      try {
        const eligibility = await reminderEligibility(sql, notification);
        if (eligibility === "CANCEL") {
          await markNotificationCancelled(sql, notification.id, "NO_LONGER_ELIGIBLE");
          summary.cancelled += 1;
          continue;
        }
        if (eligibility === "DEFER") {
          await deferNotification(
            sql,
            notification.id,
            new Date(Date.now() + SUSPENDED_DEFER_SECONDS * 1000),
          );
          summary.deferred += 1;
          continue;
        }
        const { providerMessageId } = await provider.sendTemplate({
          phoneE164: notification.recipient_phone,
          templateCode: notification.template_code,
          languageCode: "az",
          params: templateParams(notification.payload),
        });
        await markNotificationSent(sql, notification.id, providerMessageId);
        summary.sent += 1;
      } catch (error) {
        const permanent =
          error instanceof WhatsAppNotificationError && error.kind === "PERMANENT";
        const exhausted = notification.attempt_count >= NOTIFICATION_MAX_ATTEMPTS;
        try {
          if (permanent || exhausted) {
            await markNotificationFailed(
              sql,
              notification.id,
              permanent ? "PROVIDER_PERMANENT" : "RETRIES_EXHAUSTED",
            );
            summary.failed += 1;
          } else {
            // exponential backoff under the SAME dedupe identity
            const backoffSeconds =
              NOTIFICATION_RETRY_BASE_SECONDS * 2 ** Math.max(notification.attempt_count - 1, 0);
            await scheduleNotificationRetry(sql, notification.id, {
              retryAt: new Date(Date.now() + backoffSeconds * 1000),
              errorCode: "PROVIDER_TRANSIENT",
            });
            summary.retried += 1;
          }
        } catch {
          summary.rowErrors += 1; // finalization itself failed — lease recovery will reclaim
        }
        log.event("notification_attempt_failed", {
          notification_id: notification.id,
          permanent,
          attempt: notification.attempt_count,
        });
      }
    }
    if (claimed.length < NOTIFICATION_BATCH) {
      break;
    }
  }
  log.event("finished", { ...flat(summary), duration_ms: Date.now() - started });
  return summary;
}

function templateParams(payload: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of ["listing_public_id", "days_left", "expires_on", "listing_title"]) {
    const value = payload[key];
    if (value !== undefined && value !== null) {
      params[key] = String(value);
    }
  }
  return params;
}

function flat(summary: ReminderRunSummary): Record<string, number | boolean> {
  return { ...summary };
}

/** Scheduled wrapper for the accepted Phase 4.12 reconciliation. */
export async function runPaymentReconciliation(): Promise<
  Awaited<ReturnType<typeof reconcileProviderPayments>>
> {
  const log = startJobRun("reconcile-payments");
  const started = Date.now();
  const summary = await reconcileProviderPayments({
    olderThanSeconds: envInt("PAYMENT_RECONCILE_OLDER_THAN_SECONDS", 300),
    limit: envInt("PAYMENT_RECONCILE_BATCH_LIMIT", 50),
  });
  log.event("finished", { ...summary, duration_ms: Date.now() - started });
  return summary;
}

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// --- O.12 image orphan cleanup ----------------------------------------------

const CLEANUP_BATCH = 25;
const CLEANUP_MAX_BATCHES = 8;
const CLEANUP_MAX_ATTEMPTS = 5;
const CLEANUP_RETRY_BASE_SECONDS = 600;

export interface ImageCleanupSummary {
  events: number;
  deleted: number;
  retained: number;
  retried: number;
  failed: number;
}

/**
 * O.12 reference-checking storage-orphan cleanup. Candidates arrive as
 * outbox events from cancel / seller staged-image removal / approval
 * gallery replacement — they are HINTS only. An object is deleted only
 * when, AT EXECUTION TIME, it is referenced by neither listing_images
 * nor listing_edit_images (retained history rows are genuine
 * references) AND the grace interval has passed. Deletion failure
 * never touches business data: the event returns to PENDING with
 * backoff (FAILED after the attempt budget). Idempotent under
 * duplicated events and overlapping runs (skip-locked claiming +
 * re-check + idempotent provider deletes).
 */
export async function runImageCleanup(
  options: { graceSeconds?: number } = {},
): Promise<ImageCleanupSummary> {
  const log = startJobRun("cleanup-images");
  const started = Date.now();
  const graceSeconds =
    options.graceSeconds ?? envInt("IMAGE_CLEANUP_GRACE_SECONDS", 86_400);
  const config = listingImageConfig();
  const storage = getStorageProvider();
  const sql = getSql();
  const summary: ImageCleanupSummary = { events: 0, deleted: 0, retained: 0, retried: 0, failed: 0 };

  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch += 1) {
    const events = await withTransaction(async (tx) =>
      claimCleanupEvents(tx, { limit: CLEANUP_BATCH, graceSeconds }),
    );
    if (events.length === 0) break;
    for (const event of events) {
      summary.events += 1;
      const paths = (event.payload.cleanup_candidate_paths ?? "")
        .split(",")
        .map((path) => path.trim())
        .filter((path) => path.length > 0);
      let failure: string | null = null;
      for (const path of paths) {
        // authoritative re-check NOW — never trust the event payload alone
        if (await isImagePathReferenced(sql, path)) {
          summary.retained += 1;
          log.event("candidate_retained", { event_id: event.id, path });
          continue;
        }
        try {
          await storage.deleteObject(config.imagesBucket, path);
          summary.deleted += 1;
          log.event("object_deleted", { event_id: event.id, path });
        } catch (error) {
          failure = error instanceof Error ? error.message : "storage delete failed";
          log.event("delete_failed", { event_id: event.id, path, error: failure });
        }
      }
      if (failure === null) {
        await markCleanupEventProcessed(sql, event.id);
      } else if (event.attempt_count >= CLEANUP_MAX_ATTEMPTS) {
        summary.failed += 1;
        await markCleanupEventFailed(sql, { id: event.id, error: failure });
      } else {
        summary.retried += 1;
        await markCleanupEventRetry(sql, {
          id: event.id,
          retryAt: new Date(
            Date.now() + CLEANUP_RETRY_BASE_SECONDS * 1000 * event.attempt_count,
          ),
          error: failure,
        });
      }
    }
    if (events.length < CLEANUP_BATCH) break;
  }

  log.event("finished", { ...summary, duration_ms: Date.now() - started });
  return summary;
}
