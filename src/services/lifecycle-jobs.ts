import { getSql, withTransaction } from "@/lib/server/db/client";
import { startJobRun } from "@/lib/jobs/log";
import {
  claimDueNotifications,
  deferNotification,
  expireListingsBatch,
  markNotificationCancelled,
  markNotificationFailed,
  markNotificationSent,
  promotionHousekeepingBatch,
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
