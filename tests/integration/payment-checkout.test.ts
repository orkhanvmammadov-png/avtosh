import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { setPaymentProviderForTesting } from "@/providers/payments/factory";
import {
  PaymentProviderError,
  type CreateOrderInput,
  type PaymentProviderClient,
  type ProviderOrderDetails,
} from "@/providers/payments/types";
import {
  reconcileProviderPayments,
  verifyKapitalReturn,
  verifyProviderPayment,
} from "@/services/payment-checkout";
import { createTestUserSession } from "./helpers/session";
import { api } from "./helpers/listing";
import { POST as checkoutRoute } from "@/app/api/v1/me/listings/[listingId]/payment/checkout/route";

const checkoutUrl = (id: string) =>
  `http://localhost/api/v1/me/listings/${id}/payment/checkout`;

/**
 * Deterministic in-memory Kapital double implementing the provider
 * abstraction. Orders are controllable per test (status, amount,
 * currency, failure injection) so every provider-truth scenario is
 * exact and offline.
 */
interface FakeOrder {
  id: string;
  amountMajor: string;
  currency: string;
  status: string;
  actionId: string | null;
}

function createFakeKapital() {
  const orders = new Map<string, FakeOrder>();
  let counter = 0;
  const state = {
    failCreate: null as PaymentProviderError | null,
    failGet: null as PaymentProviderError | null,
    createCalls: 0,
    getCalls: 0,
  };
  const client: PaymentProviderClient = {
    async createOrder(input: CreateOrderInput) {
      state.createCalls += 1;
      if (state.failCreate !== null) throw state.failCreate;
      counter += 1;
      const id = `fk-${counter}-${randomUUID().slice(0, 8)}`;
      orders.set(id, {
        id,
        amountMajor: input.amountMajor,
        currency: input.currency,
        status: "Preparing",
        actionId: null,
      });
      return {
        providerOrderId: id,
        hppUrl: "https://fake-kapital.test/flex",
        hppSecret: `pw-${id}`,
        status: "Preparing",
      };
    },
    async getOrderDetails(providerOrderId: string): Promise<ProviderOrderDetails> {
      state.getCalls += 1;
      if (state.failGet !== null) throw state.failGet;
      const order = orders.get(providerOrderId);
      if (order === undefined) {
        throw new PaymentProviderError("CONTRACT", "OrderNotFound");
      }
      const cents = order.amountMajor.includes(".")
        ? Number(order.amountMajor.replace(".", ""))
        : Number(order.amountMajor) * 100;
      return {
        providerOrderId: order.id,
        status: order.status,
        amountMinor: cents,
        currency: order.currency,
        providerTransactionId: order.actionId,
      };
    },
  };
  return { client, orders, state };
}

let fake = createFakeKapital();
let seller: { userId: string; cookie: string };
let otherSeller: { userId: string; cookie: string };
let blockedSeller: { userId: string; cookie: string };
let carCat = "";

async function insertPaidListing(
  ownerId: string,
  options: { amountMinor?: number; listingStatus?: string } = {},
): Promise<{ listingId: string; paymentId: string }> {
  const sql = getSql();
  const status = options.listingStatus ?? "PAYMENT_REQUIRED";
  const [listing] = await sql<{ id: string }[]>`
    insert into listings (owner_id, category_id, status, published_at, current_expires_at)
    values (${ownerId}, ${carCat}, ${status}::listing_status,
      ${status === "ACTIVE" ? sql`now()` : null},
      ${status === "ACTIVE" ? sql`now() + interval '20 days'` : null})
    returning id
  `;
  const [payment] = await sql<{ id: string }[]>`
    insert into payments (user_id, listing_id, type, amount_minor, currency, idempotency_key, status)
    values (${ownerId}, ${listing.id}, 'LISTING_FEE', ${options.amountMinor ?? 200}, 'AZN',
      ${`listing_fee:initial:${listing.id}`}, 'CREATED')
    returning id
  `;
  await sql`
    insert into listing_publications (listing_id, user_id, publication_number, billing_type, payment_id)
    values (${listing.id}, ${ownerId},
      (select coalesce(max(publication_number), 0) + 1 from listing_publications where user_id = ${ownerId}),
      'PAID', ${payment.id})
  `;
  return { listingId: listing.id, paymentId: payment.id };
}

async function insertFreeListing(ownerId: string): Promise<string> {
  const sql = getSql();
  const [listing] = await sql<{ id: string }[]>`
    insert into listings (owner_id, category_id, status, submitted_at)
    values (${ownerId}, ${carCat}, 'PENDING_MODERATION', now())
    returning id
  `;
  await sql`
    insert into listing_publications (listing_id, user_id, publication_number, billing_type)
    values (${listing.id}, ${ownerId},
      (select coalesce(max(publication_number), 0) + 1 from listing_publications where user_id = ${ownerId}),
      'FREE')
  `;
  return listing.id;
}

async function checkout(listingId: string, cookie?: string) {
  return api(checkoutRoute, "POST", checkoutUrl(listingId), {
    cookie,
    params: { listingId },
  });
}

interface DbCounts {
  paymentStatus: string;
  listingStatus: string;
  attempts: number;
  activeAttempts: number;
  historyRows: number;
  outboxModeration: number;
  outboxPaymentSuccess: number;
}

async function counts(listingId: string, paymentId: string): Promise<DbCounts> {
  const sql = getSql();
  const [row] = await sql<Record<string, string>[]>`
    select
      (select status::text from payments where id = ${paymentId}) as payment_status,
      (select status::text from listings where id = ${listingId}) as listing_status,
      (select count(*)::text from payment_provider_attempts where payment_id = ${paymentId}) as attempts,
      (select count(*)::text from payment_provider_attempts where payment_id = ${paymentId} and not is_terminal) as active_attempts,
      (select count(*)::text from listing_status_history where listing_id = ${listingId}) as history_rows,
      (select count(*)::text from outbox_events where aggregate_id = ${listingId} and event_type = 'LISTING_ENTERED_MODERATION') as outbox_moderation,
      (select count(*)::text from outbox_events where aggregate_id = ${listingId} and event_type = 'PAYMENT_SUCCEEDED') as outbox_payment
  `;
  return {
    paymentStatus: row.payment_status,
    listingStatus: row.listing_status,
    attempts: Number(row.attempts),
    activeAttempts: Number(row.active_attempts),
    historyRows: Number(row.history_rows),
    outboxModeration: Number(row.outbox_moderation),
    outboxPaymentSuccess: Number(row.outbox_payment),
  };
}

function makeAuth(userId: string): import("@/auth/current-user").AuthContext {
  return {
    sessionId: "test",
    user: { id: userId, phone_e164: "+994510000000", display_name: null, status: "ACTIVE" },
    roles: ["USER"],
  } as import("@/auth/current-user").AuthContext;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  const sql = getSql();
  seller = await createTestUserSession("+994519000001");
  otherSeller = await createTestUserSession("+994519000002");
  blockedSeller = await createTestUserSession("+994519000003", { blocked: true });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
});

afterEach(() => {
  setPaymentProviderForTesting(null);
});

afterAll(async () => {
  await closeSql();
});

function installFake() {
  fake = createFakeKapital();
  setPaymentProviderForTesting(fake.client);
  return fake;
}

describe("checkout — authorization and eligibility", () => {
  it("requires an authenticated, unblocked owner", async () => {
    installFake();
    const { listingId } = await insertPaidListing(seller.userId);
    const anonymous = await checkout(listingId);
    expect(anonymous.status).toBe(401);
    const foreign = await checkout(listingId, otherSeller.cookie);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error?.code).toBe("LISTING_NOT_FOUND");
    const blocked = await checkout(listingId, blockedSeller.cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error?.code).toBe("USER_BLOCKED");
    expect(fake.state.createCalls).toBe(0);
  });

  it("rejects non-PAYMENT_REQUIRED listings and FREE publications", async () => {
    installFake();
    const active = await insertPaidListing(seller.userId, { listingStatus: "ACTIVE" });
    const r1 = await checkout(active.listingId, seller.cookie);
    expect(r1.status).toBe(409);
    expect(r1.body.error?.code).toBe("PAYMENT_NOT_REQUIRED");
    const freeListing = await insertFreeListing(seller.userId);
    const r2 = await checkout(freeListing, seller.cookie);
    expect(r2.status).toBe(404);
    expect(fake.state.createCalls).toBe(0);
  });
});

describe("checkout — provider order creation", () => {
  it("creates the order from the immutable snapshot, immune to fee-setting changes", async () => {
    const provider = installFake();
    const { listingId, paymentId } = await insertPaidListing(seller.userId, { amountMinor: 200 });
    const sql = getSql();
    try {
      await sql`update system_settings set value = '300'::jsonb where key = 'listing.publication_fee_minor'`;
      const r = await checkout(listingId, seller.cookie);
      expect(r.status).toBe(200);
      const url = r.body.data?.checkout_url as string;
      expect(url).toContain("https://fake-kapital.test/flex?id=");
      const order = [...provider.orders.values()][0];
      expect(order.amountMajor).toBe("2.00"); // snapshot, not the 3.00 setting
      expect(order.currency).toBe("AZN");
      const after = await counts(listingId, paymentId);
      expect(after.paymentStatus).toBe("PENDING");
      expect(after.attempts).toBe(1);
      expect(after.activeAttempts).toBe(1);
      const [payment] = await sql<{ provider: string; provider_order_id: string }[]>`
        select provider, provider_order_id from payments where id = ${paymentId}
      `;
      expect(payment.provider).toBe("KAPITAL");
      expect(payment.provider_order_id).toBe(order.id);
    } finally {
      await sql`update system_settings set value = '200'::jsonb where key = 'listing.publication_fee_minor'`;
    }
  });

  it("is idempotent: repeat clicks reuse the active checkout", async () => {
    const provider = installFake();
    const { listingId } = await insertPaidListing(seller.userId);
    const first = await checkout(listingId, seller.cookie);
    const second = await checkout(listingId, seller.cookie);
    expect(second.body.data?.checkout_url).toBe(first.body.data?.checkout_url);
    expect(provider.state.createCalls).toBe(1);
  });

  it("simultaneous checkouts settle on exactly one authoritative attempt", async () => {
    const provider = installFake();
    const { listingId, paymentId } = await insertPaidListing(seller.userId);
    const [a, b] = await Promise.all([
      checkout(listingId, seller.cookie),
      checkout(listingId, seller.cookie),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data?.checkout_url).toBe(b.body.data?.checkout_url);
    const after = await counts(listingId, paymentId);
    expect(after.activeAttempts).toBe(1);
    expect(provider.state.createCalls).toBeLessThanOrEqual(2); // loser's order is an orphan, never authoritative
  });

  it("provider outage returns a safe 503 and leaves the intent untouched", async () => {
    const provider = installFake();
    provider.state.failCreate = new PaymentProviderError("NETWORK", "down");
    const { listingId, paymentId } = await insertPaidListing(seller.userId);
    const r = await checkout(listingId, seller.cookie);
    expect(r.status).toBe(503);
    expect(r.body.error?.code).toBe("PAYMENT_CHECKOUT_UNAVAILABLE");
    const after = await counts(listingId, paymentId);
    expect(after.paymentStatus).toBe("CREATED");
    expect(after.attempts).toBe(0);
  });

  it("never leaks the provider secret outside the checkout URL", async () => {
    installFake();
    const { listingId } = await insertPaidListing(seller.userId);
    const r = await checkout(listingId, seller.cookie);
    expect(Object.keys(r.body.data ?? {})).toEqual(["checkout_url"]);
  });
});

describe("verification — provider truth only", () => {
  async function checkedOut(amountMinor = 200) {
    const provider = installFake();
    const created = await insertPaidListing(seller.userId, { amountMinor });
    const r = await checkout(created.listingId, seller.cookie);
    expect(r.status).toBe(200);
    const orderId = [...provider.orders.keys()][0];
    return { ...created, provider, orderId };
  }

  it("callback STATUS carries no authority — a Preparing order stays pending", async () => {
    const { provider, paymentId, listingId, orderId } = await checkedOut();
    // the untrusted browser query said FullyPaid; the service ignores it
    const outcome = await verifyKapitalReturn(makeAuth(seller.userId), orderId);
    expect(provider.state.getCalls).toBe(1); // server-to-server GET is mandatory
    expect(outcome.outcome.state).toBe("PENDING");
    const after = await counts(listingId, paymentId);
    expect(after.paymentStatus).toBe("PENDING");
    expect(after.listingStatus).toBe("PAYMENT_REQUIRED");
    expect(after.outboxModeration).toBe(0);
  });

  it("verified FullyPaid with exact amount+currency fulfills exactly once", async () => {
    const { provider, paymentId, listingId, orderId } = await checkedOut();
    const order = provider.orders.get(orderId)!;
    order.status = "FullyPaid";
    order.actionId = "tran-777";
    const outcome = await verifyProviderPayment(paymentId);
    expect(outcome.state).toBe("SUCCESS");
    const after = await counts(listingId, paymentId);
    expect(after.paymentStatus).toBe("SUCCESS");
    expect(after.listingStatus).toBe("PENDING_MODERATION");
    expect(after.activeAttempts).toBe(0);
    expect(after.historyRows).toBe(2); // PAYMENT_REQUIRED→PAYMENT_COMPLETED→PENDING_MODERATION
    expect(after.outboxModeration).toBe(1);
    expect(after.outboxPaymentSuccess).toBe(1);
    const sql = getSql();
    const [payment] = await sql<Record<string, string | null>[]>`
      select paid_at::text as paid_at, fulfillment_status::text as fulfillment_status,
             provider_transaction_id,
             (select hpp_secret from payment_provider_attempts where payment_id = ${paymentId}) as secret
      from payments where id = ${paymentId}
    `;
    expect(payment.paid_at).not.toBeNull();
    expect(payment.fulfillment_status).toBe("FULFILLED");
    expect(payment.provider_transaction_id).toBe("tran-777");
    expect(payment.secret).toBeNull(); // HPP password cleared at terminal state
    const [listing] = await sql<{ submitted_at: string | null }[]>`
      select submitted_at::text as submitted_at from listings where id = ${listingId}
    `;
    expect(listing.submitted_at).not.toBeNull();
  });

  it.each([
    ["amount", { amountMajor: "3.00" }],
    ["currency", { currency: "USD" }],
  ])("FullyPaid with a %s mismatch NEVER fulfills", async (_label, patch) => {
    const { provider, paymentId, listingId, orderId } = await checkedOut();
    Object.assign(provider.orders.get(orderId)!, { status: "FullyPaid", ...patch });
    const outcome = await verifyProviderPayment(paymentId);
    expect(outcome.state).toBe("MISMATCH");
    const after = await counts(listingId, paymentId);
    expect(after.paymentStatus).toBe("PENDING"); // held for operations, not SUCCESS
    expect(after.listingStatus).toBe("PAYMENT_REQUIRED");
    expect(after.outboxModeration).toBe(0);
    expect(after.outboxPaymentSuccess).toBe(0);
  });

  it("unknown provider statuses are recorded and never become SUCCESS", async () => {
    const { provider, paymentId, listingId, orderId } = await checkedOut();
    provider.orders.get(orderId)!.status = "SomethingNew";
    const outcome = await verifyProviderPayment(paymentId);
    expect(outcome.state).toBe("PENDING");
    const after = await counts(listingId, paymentId);
    expect(after.paymentStatus).toBe("PENDING");
    const sql = getSql();
    const [attempt] = await sql<{ provider_status: string }[]>`
      select provider_status from payment_provider_attempts where payment_id = ${paymentId}
    `;
    expect(attempt.provider_status).toBe("SomethingNew");
  });

  it("repeated and concurrent verification produce exactly one fulfillment", async () => {
    const { provider, paymentId, listingId, orderId } = await checkedOut();
    provider.orders.get(orderId)!.status = "FullyPaid";
    const [first, second] = await Promise.all([
      verifyProviderPayment(paymentId),
      verifyProviderPayment(paymentId),
    ]);
    expect(first.state).toBe("SUCCESS");
    expect(second.state).toBe("SUCCESS");
    const third = await verifyProviderPayment(paymentId); // callback refresh
    expect(third.state).toBe("SUCCESS");
    const after = await counts(listingId, paymentId);
    expect(after.historyRows).toBe(2);
    expect(after.outboxModeration).toBe(1);
    expect(after.outboxPaymentSuccess).toBe(1);
  });

  it("declined/cancelled/expired attempts re-arm the intent for a fresh checkout", async () => {
    const { provider, paymentId, listingId, orderId } = await checkedOut();
    provider.orders.get(orderId)!.status = "Declined";
    const outcome = await verifyProviderPayment(paymentId);
    expect(outcome.state).toBe("RETRYABLE");
    let after = await counts(listingId, paymentId);
    expect(after.paymentStatus).toBe("CREATED");
    expect(after.activeAttempts).toBe(0);
    expect(after.attempts).toBe(1); // audit preserved
    // fresh checkout → a NEW provider order, previous attempt untouched
    const retry = await checkout(listingId, seller.cookie);
    expect(retry.status).toBe(200);
    after = await counts(listingId, paymentId);
    expect(after.attempts).toBe(2);
    expect(after.activeAttempts).toBe(1);
    expect(provider.state.createCalls).toBe(2);
  });

  it("Refunded maps to REFUNDED without fulfillment", async () => {
    const { provider, paymentId, listingId, orderId } = await checkedOut();
    provider.orders.get(orderId)!.status = "Refunded";
    const outcome = await verifyProviderPayment(paymentId);
    expect(outcome.state).toBe("REFUNDED");
    const after = await counts(listingId, paymentId);
    expect(after.paymentStatus).toBe("REFUNDED");
    expect(after.listingStatus).toBe("PAYMENT_REQUIRED");
    expect(after.outboxModeration).toBe(0);
  });

  it("verification outage moves nothing", async () => {
    const { provider, paymentId, listingId } = await checkedOut();
    provider.state.failGet = new PaymentProviderError("NETWORK", "down");
    const outcome = await verifyProviderPayment(paymentId);
    expect(outcome.state).toBe("CHECK_FAILED");
    const after = await counts(listingId, paymentId);
    expect(after.paymentStatus).toBe("PENDING");
    expect(after.listingStatus).toBe("PAYMENT_REQUIRED");
  });
});

describe("callback mapping — privacy", () => {
  it("unknown, malformed, and foreign provider orders all get the same generic answer", async () => {
    const { provider, orderId } = await (async () => {
      const p = installFake();
      const created = await insertPaidListing(seller.userId);
      await checkout(created.listingId, seller.cookie);
      return { provider: p, orderId: [...p.orders.keys()][0] };
    })();
    const before = provider.state.getCalls;
    for (const probe of ["does-not-exist", "../../etc", "", undefined]) {
      const r = await verifyKapitalReturn(makeAuth(otherSeller.userId), probe as string | undefined);
      expect(r.outcome.state).toBe("UNKNOWN_ORDER");
      expect(r.listingId).toBeNull();
    }
    // a REAL order id of another user: same generic answer, no provider call
    const foreign = await verifyKapitalReturn(makeAuth(otherSeller.userId), orderId);
    expect(foreign.outcome.state).toBe("UNKNOWN_ORDER");
    expect(foreign.listingId).toBeNull();
    expect(provider.state.getCalls).toBe(before); // never became a probing oracle
  });
});

describe("reconciliation", () => {
  it("applies the same verification path to stale pending payments", async () => {
    const provider = installFake();
    const paid = await insertPaidListing(seller.userId);
    const pending = await insertPaidListing(seller.userId);
    await checkout(paid.listingId, seller.cookie);
    await checkout(pending.listingId, seller.cookie);
    const [paidOrder, pendingOrder] = [...provider.orders.keys()];
    provider.orders.get(paidOrder)!.status = "FullyPaid";
    provider.orders.get(pendingOrder)!.status = "Preparing";
    const sql = getSql();
    await sql`update payments set created_at = now() - interval '1 hour'
      where id in ${sql([paid.paymentId, pending.paymentId])}`;
    const summary = await reconcileProviderPayments({ olderThanSeconds: 60 });
    expect(summary.checked).toBeGreaterThanOrEqual(2);
    expect(summary.succeeded).toBeGreaterThanOrEqual(1);
    const paidAfter = await counts(paid.listingId, paid.paymentId);
    expect(paidAfter.paymentStatus).toBe("SUCCESS");
    expect(paidAfter.listingStatus).toBe("PENDING_MODERATION");
    const pendingAfter = await counts(pending.listingId, pending.paymentId);
    expect(pendingAfter.paymentStatus).toBe("PENDING");
    // re-running reconciliation cannot double-fulfill
    await reconcileProviderPayments({ olderThanSeconds: 60 });
    const again = await counts(paid.listingId, paid.paymentId);
    expect(again.outboxModeration).toBe(1);
    expect(again.historyRows).toBe(2);
  });
});
