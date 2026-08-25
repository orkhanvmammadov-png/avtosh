import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  createMemoryStorageProvider,
  type MemoryStorageProvider,
} from "@/providers/storage/memory-provider";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import { createTestUserSession } from "./helpers/session";
import { api } from "./helpers/listing";
import { GET as listRoute } from "@/app/api/v1/me/listings/route";
import { GET as detailRoute } from "@/app/api/v1/me/listings/[listingId]/route";

const LIST = "http://localhost/api/v1/me/listings";
const detail = (id: string) => `http://localhost/api/v1/me/listings/${id}`;

let storage: MemoryStorageProvider;
let seller: { userId: string; cookie: string };
let otherSeller: { userId: string; cookie: string };
let moderatorId = "";
let carCat = "";
let brandId = "";
let modelId = "";
let cityId = "";
let paymentId = "";
let foreignPaymentId = "";
const created: Record<string, string> = {};

async function insertListing(
  key: string,
  status: string,
  options: { ownerId?: string; image?: boolean; withCatalog?: boolean } = {},
) {
  const sql = getSql();
  const owner = options.ownerId ?? seller.userId;
  const withCatalog = options.withCatalog ?? true;
  const submitted = ["PENDING_MODERATION", "CORRECTION_REQUIRED", "REJECTED", "ACTIVE", "SOLD", "EXPIRED", "SUSPENDED"].includes(status);
  const published = ["ACTIVE", "SOLD", "EXPIRED", "SUSPENDED"].includes(status);
  const [row] = await sql<{ id: string }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year,
      price_minor, mileage, description, contact_phone_e164, status,
      submitted_at, published_at, current_expires_at, sold_at, deleted_at)
    values (${owner}, ${carCat},
      ${withCatalog ? brandId : null}, ${withCatalog ? modelId : null}, ${withCatalog ? cityId : null},
      2020, 1800000, 90000, 'Təsvir', '+994501234567', ${status}::listing_status,
      ${submitted ? sql`now()` : null},
      ${published ? sql`now() - interval '1 day'` : null},
      ${status === "EXPIRED" ? sql`now() - interval '1 hour'` : published ? sql`now() + interval '20 days'` : null},
      ${status === "SOLD" ? sql`now()` : null},
      ${status === "DELETED" ? sql`now()` : null})
    returning id
  `;
  if (options.image !== false) {
    await sql`
      insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
      values (${row.id}, ${`listings/${randomUUID()}.webp`}, 0, true, 'image/webp', 1000, 1600, 900)
    `;
  }
  created[key] = row.id;
  return row.id;
}

async function attachPaidIntent(listingId: string, ownerId: string, amountMinor: number) {
  const sql = getSql();
  const [payment] = await sql<{ id: string }[]>`
    insert into payments (user_id, listing_id, type, amount_minor, currency, idempotency_key, status)
    values (${ownerId}, ${listingId}, 'LISTING_FEE', ${amountMinor}, 'AZN',
      ${`listing_fee:initial:${listingId}`}, 'CREATED')
    returning id
  `;
  await sql`
    insert into listing_publications (listing_id, user_id, publication_number, billing_type, payment_id)
    values (${listingId}, ${ownerId},
      (select coalesce(max(publication_number), 0) + 1 from listing_publications where user_id = ${ownerId}),
      'PAID', ${payment.id})
  `;
  return payment.id;
}

async function insertReview(
  listingId: string,
  decision: string,
  reasonCode: string | null,
  note: string | null,
  revision = 1,
) {
  const sql = getSql();
  await sql`
    insert into moderation_reviews (listing_id, moderator_id, listing_revision, decision, reason_code, note)
    values (${listingId}, ${moderatorId}, ${revision}, ${decision}::moderation_decision, ${reasonCode}, ${note})
  `;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  seller = await createTestUserSession("+994518000001");
  otherSeller = await createTestUserSession("+994518000002");
  moderatorId = (await createTestUserSession("+994518000003", { roles: ["MODERATOR"] })).userId;
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  brandId = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('MlKia', 'ml-kia') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brandId}, ${carCat})`;
  modelId = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brandId}, ${carCat}, 'MlRio', 'ml-rio') returning id`)[0].id;
  cityId = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('MlSumqayıt', 'ml-sumqayit', 96) returning id`)[0].id;

  await insertListing("draft", "DRAFT", { image: false, withCatalog: false });
  await insertListing("pending", "PENDING_MODERATION");
  await insertListing("paymentRequired", "PAYMENT_REQUIRED");
  await insertListing("active", "ACTIVE");
  await insertListing("correction", "CORRECTION_REQUIRED");
  await insertListing("rejected", "REJECTED");
  await insertListing("sold", "SOLD");
  await insertListing("expired", "EXPIRED");
  await insertListing("suspended", "SUSPENDED");
  await insertListing("deleted", "DELETED");
  await insertListing("foreign", "ACTIVE", { ownerId: otherSeller.userId });
  await insertListing("paidIntent", "PAYMENT_REQUIRED");
  await insertListing("foreignPaid", "PAYMENT_REQUIRED", { ownerId: otherSeller.userId });

  await insertReview(created.correction, "CORRECTION_REQUESTED", "INVALID_PHOTOS", "Şəkillər aydın deyil.");
  await insertReview(created.rejected, "REJECTED", "PROHIBITED_ITEM", "Qadağan olunmuş məhsul.");
  await insertReview(created.active, "APPROVED", null, null); // approval detail must never surface
  paymentId = await attachPaidIntent(created.paidIntent, seller.userId, 200);
  foreignPaymentId = await attachPaidIntent(created.foreignPaid, otherSeller.userId, 500);
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("my listings — access", () => {
  it("requires authentication", async () => {
    const r = await api(listRoute, "GET", LIST);
    expect(r.status).toBe(401);
    expect(r.body.error?.code).toBe("AUTH_REQUIRED");
  });

  it("never includes another user's listings", async () => {
    const r = await api(listRoute, "GET", LIST, { cookie: seller.cookie });
    expect(r.status).toBe(200);
    const ids = (r.body.data?.items as { id: string }[]).map((i) => i.id);
    expect(ids).not.toContain(created.foreign);
    const other = await api(listRoute, "GET", LIST, { cookie: otherSeller.cookie });
    const otherIds = (other.body.data?.items as { id: string }[]).map((i) => i.id);
    expect([...otherIds].sort()).toEqual([created.foreign, created.foreignPaid].sort());
    expect(otherIds).not.toContain(created.active);
  });
});

describe("my listings — status coverage and filters", () => {
  it("lists all lifecycle states except DELETED", async () => {
    const r = await api(listRoute, "GET", LIST, { cookie: seller.cookie });
    const items = r.body.data?.items as { id: string; status: string }[];
    const ids = items.map((i) => i.id);
    for (const key of ["draft", "pending", "paymentRequired", "active", "correction", "rejected", "sold", "expired", "suspended"]) {
      expect(ids).toContain(created[key]);
    }
    expect(ids).not.toContain(created.deleted);
    expect(r.response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    ["draft", ["draft"]],
    ["active", ["active"]],
    ["moderation", ["pending"]],
    ["correction", ["correction", "rejected"]],
  ] as const)("filter=%s returns exactly the matching statuses", async (filter, keys) => {
    const r = await api(listRoute, "GET", `${LIST}?filter=${filter}`);
    expect(r.status).toBe(401); // sanity: filter never bypasses auth
    const authed = await api(listRoute, "GET", `${LIST}?filter=${filter}`, { cookie: seller.cookie });
    const ids = (authed.body.data?.items as { id: string }[]).map((i) => i.id);
    expect([...ids].sort()).toEqual(keys.map((k) => created[k]).sort());
  });

  it("rejects unknown filters", async () => {
    const r = await api(listRoute, "GET", `${LIST}?filter=everything`, { cookie: seller.cookie });
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("orders by most recently updated first", async () => {
    const sql = getSql();
    await sql`update listings set updated_at = now() + interval '1 minute' where id = ${created.sold}`;
    const r = await api(listRoute, "GET", LIST, { cookie: seller.cookie });
    const ids = (r.body.data?.items as { id: string }[]).map((i) => i.id);
    expect(ids[0]).toBe(created.sold);
  });
});

describe("my listings — DTO safety and moderation feedback", () => {
  it("cards carry owner-useful fields and a signed primary image", async () => {
    const r = await api(listRoute, "GET", LIST, { cookie: seller.cookie });
    const card = (r.body.data?.items as Record<string, unknown>[]).find((i) => i.id === created.active)!;
    expect(card.brand).toBe("MlKia");
    expect(card.model).toBe("MlRio");
    expect(card.priceMinor).toBe(1800000);
    expect(card.imageCount).toBe(1);
    expect(typeof card.primaryImageUrl).toBe("string");
    expect(typeof card.revision).toBe("number");
    expect(card.publishedAt).not.toBeNull();
  });

  it("exposes seller-safe feedback ONLY for moderator-returned states", async () => {
    const r = await api(listRoute, "GET", LIST, { cookie: seller.cookie });
    const items = r.body.data?.items as Record<string, unknown>[];
    const correction = items.find((i) => i.id === created.correction)!;
    const rejected = items.find((i) => i.id === created.rejected)!;
    const active = items.find((i) => i.id === created.active)!;
    expect(correction.moderationFeedback).toMatchObject({
      decision: "CORRECTION_REQUESTED",
      reasonCode: "INVALID_PHOTOS",
      note: "Şəkillər aydın deyil.",
    });
    expect(rejected.moderationFeedback).toMatchObject({
      decision: "REJECTED",
      reasonCode: "PROHIBITED_ITEM",
    });
    expect(active.moderationFeedback).toBeNull();
    // moderator identity / internal review ids never leak
    const serialized = JSON.stringify(r.body);
    expect(serialized).not.toContain(moderatorId);
    expect(serialized).not.toContain("moderator");
  });

  it("owner detail returns the same seller-safe projection", async () => {
    const r = await api(detailRoute, "GET", detail(created.correction), {
      cookie: seller.cookie,
      params: { listingId: created.correction },
    });
    expect(r.status).toBe(200);
    const feedback = r.body.data?.moderation_feedback as Record<string, unknown>;
    expect(feedback.reasonCode).toBe("INVALID_PHOTOS");
    expect(feedback.note).toBe("Şəkillər aydın deyil.");
    expect(Object.keys(feedback).sort()).toEqual(["decision", "note", "reasonCode", "reviewedAt"]);
    const draft = await api(detailRoute, "GET", detail(created.draft), {
      cookie: seller.cookie,
      params: { listingId: created.draft },
    });
    expect(draft.body.data?.moderation_feedback).toBeNull();
  });

  it("detail feedback is unreachable for foreign listings", async () => {
    const r = await api(detailRoute, "GET", detail(created.correction), {
      cookie: otherSeller.cookie,
      params: { listingId: created.correction },
    });
    expect(r.status).toBe(404);
    expect(r.body.error?.code).toBe("LISTING_NOT_FOUND");
  });
});

describe("my listings — PAYMENT_REQUIRED intent snapshot", () => {
  it("detail exposes the intent snapshot, immune to later fee-setting changes", async () => {
    const sql = getSql();
    const restore = () =>
      sql`update system_settings set value = '200'::jsonb where key = 'listing.publication_fee_minor'`;
    try {
      // intent created at 200 minor; the system fee then rises to 300
      await sql`update system_settings set value = '300'::jsonb where key = 'listing.publication_fee_minor'`;
      const r = await api(detailRoute, "GET", detail(created.paidIntent), {
        cookie: seller.cookie,
        params: { listingId: created.paidIntent },
      });
      expect(r.status).toBe(200);
      const snapshot = r.body.data?.payment_required as Record<string, unknown>;
      expect(snapshot).toEqual({
        type: "LISTING_FEE",
        amountMinor: 200, // the immutable intent, NOT the current 300 setting
        currency: "AZN",
        status: "CREATED",
      });
    } finally {
      await restore();
    }
  });

  it("exposes no payment internals — no UUIDs, provider data, or idempotency keys", async () => {
    const r = await api(detailRoute, "GET", detail(created.paidIntent), {
      cookie: seller.cookie,
      params: { listingId: created.paidIntent },
    });
    const snapshot = r.body.data?.payment_required as Record<string, unknown>;
    expect(Object.keys(snapshot).sort()).toEqual(["amountMinor", "currency", "status", "type"]);
    const serialized = JSON.stringify(r.body);
    expect(serialized).not.toContain(paymentId);
    expect(serialized).not.toContain("idempotency");
    expect(serialized).not.toContain("provider");
    expect(serialized).not.toContain("listing_fee:initial");
  });

  it("non-paid listings expose no snapshot", async () => {
    for (const key of ["draft", "active", "pending"]) {
      const r = await api(detailRoute, "GET", detail(created[key]), {
        cookie: seller.cookie,
        params: { listingId: created[key] },
      });
      expect(r.status).toBe(200);
      expect(r.body.data?.payment_required).toBeNull();
    }
  });

  it("fails safe on inconsistent data: PAYMENT_REQUIRED without an intent shows null, never the current setting", async () => {
    const r = await api(detailRoute, "GET", detail(created.paymentRequired), {
      cookie: seller.cookie,
      params: { listingId: created.paymentRequired },
    });
    expect(r.status).toBe(200);
    expect(r.body.data?.payment_required).toBeNull();
  });

  it("another user's paid intent is unreachable", async () => {
    const r = await api(detailRoute, "GET", detail(created.foreignPaid), {
      cookie: seller.cookie,
      params: { listingId: created.foreignPaid },
    });
    expect(r.status).toBe(404);
    const serialized = JSON.stringify(r.body);
    expect(serialized).not.toContain(foreignPaymentId);
    expect(serialized).not.toContain("500");
  });
});
