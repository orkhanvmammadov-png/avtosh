import type { Sql } from "@/lib/server/db/client";

/**
 * Checkout/verification persistence for LISTING_FEE payments.
 * Attempts are append-only audit rows; the partial unique index
 * (one non-terminal attempt per payment) is the DB-level concurrency
 * authority. Lock order inside payment flows: payments → listings
 * (the submission path locks users → listings and only INSERTS
 * payments, so the orders cannot deadlock).
 */

export interface CheckoutPaymentRow {
  payment_id: string;
  payment_user_id: string;
  payment_status: string;
  payment_type: string;
  amount_minor: string;
  currency: string;
  provider: string | null;
  listing_id: string;
  listing_status: string;
  listing_public_id: string;
}

/** Owner-scoped: listing → its initial PAID publication → the intent. */
export async function findListingFeePayment(
  sql: Sql,
  listingId: string,
  ownerId: string,
): Promise<CheckoutPaymentRow | undefined> {
  const rows = await sql<CheckoutPaymentRow[]>`
    select
      p.id as payment_id, p.user_id as payment_user_id,
      p.status::text as payment_status, p.type::text as payment_type,
      p.amount_minor::text as amount_minor, p.currency, p.provider,
      l.id as listing_id, l.status::text as listing_status,
      l.public_id::text as listing_public_id
    from listings l
    join listing_publications pub on pub.listing_id = l.id and pub.billing_type = 'PAID'
    join payments p on p.id = pub.payment_id
    where l.id = ${listingId} and l.owner_id = ${ownerId}
  `;
  return rows[0];
}

export interface LockedPaymentRow {
  id: string;
  user_id: string;
  listing_id: string | null;
  type: string;
  amount_minor: string;
  currency: string;
  status: string;
  provider: string | null;
  promotion_package_id: string | null;
  package_duration_days: number | null;
  renewal_duration_days: number | null;
}

export async function lockPayment(
  sql: Sql,
  paymentId: string,
): Promise<LockedPaymentRow | undefined> {
  const rows = await sql<LockedPaymentRow[]>`
    select id, user_id, listing_id, type::text as type,
           amount_minor::text as amount_minor, currency, status::text as status, provider,
           promotion_package_id, package_duration_days, renewal_duration_days
    from payments where id = ${paymentId}
    for update
  `;
  return rows[0];
}

export interface AttemptRow {
  id: string;
  payment_id: string;
  provider: string;
  /** NULL while the attempt is an initiation claim (no order yet). */
  provider_order_id: string | null;
  hpp_url: string | null;
  hpp_secret: string | null;
  provider_status: string;
  is_terminal: boolean;
  succeeded: boolean;
  created_at: Date;
}

export async function findActiveAttempt(
  sql: Sql,
  paymentId: string,
): Promise<AttemptRow | undefined> {
  const rows = await sql<AttemptRow[]>`
    select id, payment_id, provider, provider_order_id, hpp_url, hpp_secret,
           provider_status, is_terminal, succeeded, created_at
    from payment_provider_attempts
    where payment_id = ${paymentId} and not is_terminal
  `;
  return rows[0];
}

/**
 * The checkout-initiation CLAIM: inserted BEFORE the external
 * POST /order, in the INITIATING state (no provider order id). The
 * one-active partial unique index makes this atomic — exactly one
 * concurrent request obtains the claim and may perform the provider
 * side effect; every other request sees an existing attempt. Returns
 * null when a live attempt (claim or active checkout) already exists.
 */
export async function claimInitiation(
  sql: Sql,
  paymentId: string,
  provider: string,
): Promise<AttemptRow | null> {
  const rows = await sql<AttemptRow[]>`
    insert into payment_provider_attempts (payment_id, provider)
    values (${paymentId}, ${provider})
    on conflict do nothing
    returning id, payment_id, provider, provider_order_id, hpp_url, hpp_secret,
              provider_status, is_terminal, succeeded, created_at
  `;
  return rows[0] ?? null;
}

/** Fills the claim with the created provider order (claim → active). */
export async function completeInitiation(
  sql: Sql,
  attemptId: string,
  input: {
    providerOrderId: string;
    hppUrl: string;
    hppSecret: string;
    providerStatus: string;
  },
): Promise<void> {
  await sql`
    update payment_provider_attempts
    set provider_order_id = ${input.providerOrderId}, hpp_url = ${input.hppUrl},
        hpp_secret = ${input.hppSecret}, provider_status = ${input.providerStatus},
        updated_at = now()
    where id = ${attemptId} and provider_order_id is null
  `;
}

export async function findAttemptByProviderOrder(
  sql: Sql,
  provider: string,
  providerOrderId: string,
): Promise<AttemptRow | undefined> {
  const rows = await sql<AttemptRow[]>`
    select id, payment_id, provider, provider_order_id, hpp_url, hpp_secret,
           provider_status, is_terminal, succeeded, created_at
    from payment_provider_attempts
    where provider = ${provider} and provider_order_id = ${providerOrderId}
  `;
  return rows[0];
}

/** Records a verification observation on a still-active attempt. */
export async function recordAttemptStatus(
  sql: Sql,
  attemptId: string,
  providerStatus: string,
): Promise<void> {
  await sql`
    update payment_provider_attempts
    set provider_status = ${providerStatus}, verified_at = now(), updated_at = now()
    where id = ${attemptId}
  `;
}

/** Terminalizes an attempt; the HPP secret is cleared immediately. */
export async function terminalizeAttempt(
  sql: Sql,
  attemptId: string,
  input: { providerStatus: string; succeeded: boolean },
): Promise<void> {
  await sql`
    update payment_provider_attempts
    set provider_status = ${input.providerStatus}, is_terminal = true,
        succeeded = ${input.succeeded}, hpp_secret = null,
        verified_at = now(), updated_at = now()
    where id = ${attemptId}
  `;
}

/** Payment gains an active provider checkout. */
export async function markPaymentPending(
  sql: Sql,
  paymentId: string,
  provider: string,
  providerOrderId: string,
): Promise<void> {
  await sql`
    update payments
    set status = 'PENDING', provider = ${provider}, provider_order_id = ${providerOrderId}
    where id = ${paymentId}
  `;
}

/** Verified success: terminal, fulfillment recorded on the intent row. */
export async function markPaymentSucceeded(
  sql: Sql,
  paymentId: string,
  providerTransactionId: string | null,
): Promise<void> {
  await sql`
    update payments
    set status = 'SUCCESS', paid_at = now(), fulfillment_status = 'FULFILLED',
        provider_transaction_id = coalesce(${providerTransactionId}, provider_transaction_id)
    where id = ${paymentId}
  `;
}

export async function markPaymentRefunded(sql: Sql, paymentId: string): Promise<void> {
  await sql`
    update payments set status = 'REFUNDED', refunded_at = now()
    where id = ${paymentId}
  `;
}

/** Listing transition on verified payment success. */
export async function transitionListingPaymentCompleted(
  sql: Sql,
  listingId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update listings
    set status = 'PENDING_MODERATION', submitted_at = now()
    where id = ${listingId} and status = 'PAYMENT_REQUIRED'
    returning id
  `;
  return rows.length > 0;
}

/** SYSTEM-actor history rows (provider verification is the actor). */
export async function insertSystemStatusHistory(
  sql: Sql,
  input: { listingId: string; fromStatus: string; toStatus: string; reasonCode: string },
): Promise<void> {
  await sql`
    insert into listing_status_history
      (listing_id, from_status, to_status, actor_user_id, actor_type, reason_code)
    values
      (${input.listingId}, ${input.fromStatus}::listing_status,
       ${input.toStatus}::listing_status, null, 'SYSTEM', ${input.reasonCode})
  `;
}

/** Reconciliation scan: stale pending provider payments, oldest first. */
export async function listStalePendingPayments(
  sql: Sql,
  provider: string,
  olderThanSeconds: number,
  limit: number,
): Promise<{ id: string }[]> {
  return sql<{ id: string }[]>`
    select p.id
    from payments p
    where p.status = 'PENDING' and p.provider = ${provider}
      and p.created_at < now() - (${olderThanSeconds} || ' seconds')::interval
    order by p.created_at asc
    limit ${limit}
  `;
}

export interface PaymentSummaryRow {
  id: string;
  user_id: string;
  type: string;
  status: string;
  amount_minor: string;
  currency: string;
  listing_id: string | null;
  listing_public_id: string | null;
  listing_status: string | null;
}

export async function getPaymentSummary(
  sql: Sql,
  paymentId: string,
): Promise<PaymentSummaryRow | undefined> {
  const rows = await sql<PaymentSummaryRow[]>`
    select p.id, p.user_id, p.type::text as type, p.status::text as status,
           p.amount_minor::text as amount_minor, p.currency,
           l.id as listing_id, l.public_id::text as listing_public_id,
           l.status::text as listing_status
    from payments p
    left join listings l on l.id = p.listing_id
    where p.id = ${paymentId}
  `;
  return rows[0];
}
