import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  createMemoryStorageProvider,
  type MemoryStorageProvider,
} from "@/providers/storage/memory-provider";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import { publicDetail } from "@/services/marketplace";
import { createTestUserSession } from "./helpers/session";
import { api } from "./helpers/listing";
import { POST as suspendRoute } from "@/app/api/v1/moderator/listings/[listingId]/suspend/route";

const suspendUrl = (id: string) =>
  `http://localhost/api/v1/moderator/listings/${id}/suspend`;

let storage: MemoryStorageProvider;
let seller: { userId: string; cookie: string };
let moderator: { userId: string; cookie: string };
let admin: { userId: string; cookie: string };
let blockedModerator: { userId: string; cookie: string };
let plainUser: { userId: string; cookie: string };
let carCat = "";

async function insertActiveListing(options: { promoted?: boolean } = {}) {
  const sql = getSql();
  const [row] = await sql<{ id: string; public_id: string; revision: number }[]>`
    insert into listings (owner_id, category_id, status, published_at, current_expires_at)
    values (${seller.userId}, ${carCat}, 'ACTIVE', now() - interval '1 day', now() + interval '20 days')
    returning id, public_id::text as public_id, revision
  `;
  if (options.promoted === true) {
    const [payment] = await sql<{ id: string }[]>`
      insert into payments (user_id, listing_id, type, amount_minor, currency, idempotency_key, status, provider)
      values (${seller.userId}, ${row.id}, 'PREMIUM', 100, 'AZN', ${`susp:${randomUUID()}`}, 'SUCCESS', 'KAPITAL')
      returning id
    `;
    await sql`
      insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status,
        purchased_duration_days, purchased_price_minor)
      values (${row.id}, 'PREMIUM', ${payment.id}, now() - interval '1 hour', now() + interval '3 days', 'ACTIVE', 3, 100)
    `;
  }
  return row;
}

async function suspend(listingId: string, body: unknown, cookie?: string) {
  return api(suspendRoute, "POST", suspendUrl(listingId), {
    cookie,
    params: { listingId },
    body,
  });
}

async function effects(listingId: string) {
  const sql = getSql();
  const [row] = await sql<Record<string, string>[]>`
    select
      (select status::text from listings where id = ${listingId}) as status,
      (select count(*)::text from listing_status_history
        where listing_id = ${listingId} and to_status = 'SUSPENDED') as history,
      (select count(*)::text from audit_logs
        where entity_id = ${listingId} and action = 'LISTING_SUSPENDED') as audit,
      (select count(*)::text from outbox_events
        where aggregate_id = ${listingId} and event_type = 'LISTING_SUSPENDED') as outbox
  `;
  return {
    status: row.status,
    history: Number(row.history),
    audit: Number(row.audit),
    outbox: Number(row.outbox),
  };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  seller = await createTestUserSession("+994522000001");
  moderator = await createTestUserSession("+994522000002", { roles: ["MODERATOR"] });
  admin = await createTestUserSession("+994522000003", { roles: ["ADMIN"] });
  blockedModerator = await createTestUserSession("+994522000004", {
    roles: ["MODERATOR"],
    blocked: true,
  });
  plainUser = await createTestUserSession("+994522000005");
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("suspension — RBAC", () => {
  it("only unblocked staff may suspend", async () => {
    const listing = await insertActiveListing();
    const body = { expected_revision: listing.revision, reason_code: "PROHIBITED_ITEM" };
    expect((await suspend(listing.id, body)).status).toBe(401);
    const user = await suspend(listing.id, body, plainUser.cookie);
    expect(user.status).toBe(403);
    expect(user.body.error?.code).toBe("STAFF_ROLE_REQUIRED");
    const blocked = await suspend(listing.id, body, blockedModerator.cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error?.code).toBe("USER_BLOCKED");
    expect((await effects(listing.id)).status).toBe("ACTIVE");
    // moderator and admin both succeed (on separate listings)
    const ok = await suspend(listing.id, body, moderator.cookie);
    expect(ok.status).toBe(200);
    const second = await insertActiveListing();
    const okAdmin = await suspend(
      second.id,
      { expected_revision: second.revision, reason_code: "OTHER" },
      admin.cookie,
    );
    expect(okAdmin.status).toBe(200);
  });
});

describe("suspension — effects and safety", () => {
  it("hides the listing publicly and writes history + append-only audit + outbox exactly once", async () => {
    const listing = await insertActiveListing({ promoted: true });
    expect((await publicDetail(Number(listing.public_id))).listing.status).toBe("ACTIVE");
    const r = await suspend(
      listing.id,
      { expected_revision: listing.revision, reason_code: "MISLEADING_INFO", note: "Yanlış məlumat" },
      moderator.cookie,
    );
    expect(r.status).toBe(200);
    expect((r.body.data?.listing as { status: string }).status).toBe("SUSPENDED");
    const after = await effects(listing.id);
    expect(after).toEqual({ status: "SUSPENDED", history: 1, audit: 1, outbox: 1 });
    // hidden from the public read model entirely
    await expect(publicDetail(Number(listing.public_id))).rejects.toMatchObject({
      code: "LISTING_NOT_FOUND",
    });
    // paid promotion time untouched — no refunds, no period mutation
    const sql = getSql();
    const [promo] = await sql<{ status: string; ends_at: string }[]>`
      select status::text as status, ends_at::text as ends_at
      from listing_promotions where listing_id = ${listing.id}
    `;
    expect(promo.status).toBe("ACTIVE");
    // idempotent retry: current state, no duplicate side effects
    const again = await suspend(
      listing.id,
      { expected_revision: listing.revision, reason_code: "MISLEADING_INFO" },
      moderator.cookie,
    );
    expect(again.status).toBe(200);
    expect(await effects(listing.id)).toEqual({ status: "SUSPENDED", history: 1, audit: 1, outbox: 1 });
  });

  it("rejects non-ACTIVE listings, stale revisions, and unknown ids safely", async () => {
    const sql = getSql();
    const [pending] = await sql<{ id: string; revision: number }[]>`
      insert into listings (owner_id, category_id, status, submitted_at)
      values (${seller.userId}, ${carCat}, 'PENDING_MODERATION', now())
      returning id, revision
    `;
    const wrongState = await suspend(
      pending.id,
      { expected_revision: pending.revision, reason_code: "OTHER" },
      moderator.cookie,
    );
    expect(wrongState.status).toBe(409);
    expect(wrongState.body.error?.code).toBe("MODERATION_INVALID_STATE");

    const active = await insertActiveListing();
    const stale = await suspend(
      active.id,
      { expected_revision: active.revision + 5, reason_code: "OTHER" },
      moderator.cookie,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("LISTING_REVISION_CONFLICT");
    expect((await effects(active.id)).status).toBe("ACTIVE");

    const unknown = await suspend(
      randomUUID(),
      { expected_revision: 1, reason_code: "OTHER" },
      moderator.cookie,
    );
    expect(unknown.status).toBe(404);
  });

  it("stores staff notes verbatim as plain text (no interpretation)", async () => {
    const listing = await insertActiveListing();
    const hostile = "<script>alert(1)</script> & <img src=x onerror=y>";
    const r = await suspend(
      listing.id,
      { expected_revision: listing.revision, reason_code: "OTHER", note: hostile },
      moderator.cookie,
    );
    expect(r.status).toBe(200);
    const sql = getSql();
    const [audit] = await sql<{ after_data: { note: string } }[]>`
      select after_data from audit_logs
      where entity_id = ${listing.id} and action = 'LISTING_SUSPENDED'
    `;
    expect(audit.after_data.note).toBe(hostile); // stored as data, rendered escaped
  });
});
