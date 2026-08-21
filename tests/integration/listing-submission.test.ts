import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  createMemoryStorageProvider,
  type MemoryStorageProvider,
} from "@/providers/storage/memory-provider";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import { createTestUserSession } from "./helpers/session";
import {
  api,
  createDraftVia,
  LISTINGS_BASE,
  uploadAndConfirmVia,
  type ListingRoutes,
} from "./helpers/listing";
import { POST as createListingRoute } from "@/app/api/v1/me/listings/route";
import { PATCH as patchListingRoute } from "@/app/api/v1/me/listings/[listingId]/route";
import { POST as uploadUrlRoute } from "@/app/api/v1/me/listings/[listingId]/images/upload-url/route";
import { POST as confirmRoute } from "@/app/api/v1/me/listings/[listingId]/images/confirm/route";
import { DELETE as deleteImageRoute } from "@/app/api/v1/me/listings/[listingId]/images/[imageId]/route";
import { POST as submitRoute } from "@/app/api/v1/me/listings/[listingId]/submit/route";
import { GET as quotaRoute } from "@/app/api/v1/me/listing-quota/route";

const QUOTA_URL = "http://localhost/api/v1/me/listing-quota";

let storage: MemoryStorageProvider;
let routes: ListingRoutes;
let phoneCounter = 4_000_000;
let carBrandId = "";
let carModelId = "";
let motoModelId = "";
let cityId = "";

type Session = { userId: string; cookie: string };

async function newSeller(blocked = false): Promise<Session> {
  phoneCounter += 1;
  return createTestUserSession(`+99451${phoneCounter}`, { blocked });
}

/** Creates a submit-ready draft: required fields + 3 confirmed images. */
async function completeDraft(cookie: string): Promise<{ id: string; revision: number }> {
  const draft = await createDraftVia(routes, cookie);
  const patch = await api(routes.patch, "PATCH", `${LISTINGS_BASE}/${draft.id}`, {
    body: {
      expected_revision: draft.revision,
      brand_id: carBrandId,
      model_id: carModelId,
      year: 2020,
      price_minor: 1500000,
      mileage: 80000,
      city_id: cityId,
      contact_phone: "+994501234567",
    },
    cookie,
    params: { listingId: draft.id },
  });
  expect(patch.status).toBe(200);
  let revision = (patch.body.data?.listing as { revision: number }).revision;
  for (let i = 0; i < 3; i += 1) {
    revision = (await uploadAndConfirmVia(routes, storage, cookie, draft.id)).revision;
  }
  return { id: draft.id, revision };
}

async function submit(
  cookie: string,
  listingId: string,
  revision: number,
  extra: Record<string, unknown> = {},
  origin?: string,
) {
  return api(submitRoute, "POST", `${LISTINGS_BASE}/${listingId}/submit`, {
    body: { expected_revision: revision, ...extra },
    cookie,
    params: { listingId },
    origin,
  });
}

async function quota(cookie: string) {
  const { status, body } = await api(quotaRoute, "GET", QUOTA_URL, { cookie });
  expect(status).toBe(200);
  return body.data?.quota as Record<string, unknown>;
}

async function setSetting(key: string, value: string | null, fallback: string): Promise<void> {
  const sql = getSql();
  await sql`
    update system_settings set value = ${value ?? fallback}::jsonb where key = ${key}
  `;
}

async function countRows(table: "listing_publications" | "payments" | "listing_status_history" | "outbox_events" | "listing_periods" | "moderation_reviews" | "moderation_claims", column: string, id: string): Promise<number> {
  const sql = getSql();
  // Table/column come from the typed literal unions above — never from
  // test data — and the id is a bound parameter.
  const rows = await sql.unsafe<{ count: string }[]>(
    `select count(*)::text as count from ${table} where ${column} = $1`,
    [id],
  );
  return Number(rows[0].count);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  routes = {
    create: createListingRoute,
    patch: patchListingRoute,
    uploadUrl: uploadUrlRoute,
    confirm: confirmRoute,
  };
  const sql = getSql();
  const [brand] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('LsHyundai', 'ls-hyundai') returning id
  `;
  carBrandId = brand.id;
  const [motoBrand] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('LsDucati', 'ls-ducati') returning id
  `;
  await sql`
    insert into brand_categories (brand_id, category_id)
    select b.id, c.id from brands b, categories c
    where (b.slug, c.code) in (('ls-hyundai', 'CAR'), ('ls-ducati', 'MOTORCYCLE'))
  `;
  const [model] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    select ${carBrandId}, id, 'LsElantra', 'ls-elantra' from categories where code = 'CAR'
    returning id
  `;
  carModelId = model.id;
  const [motoModel] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    select ${motoBrand.id}, id, 'LsMonster', 'ls-monster' from categories where code = 'MOTORCYCLE'
    returning id
  `;
  motoModelId = motoModel.id;
  const [city] = await sql<{ id: string }[]>`
    insert into cities (name_az, slug, sort_order) values ('LsSumqayıt', 'ls-sumqayit', 95) returning id
  `;
  cityId = city.id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("GET /me/listing-quota", () => {
  it("reflects lifetime publications against the configured limit", async () => {
    const seller = await newSeller();
    let q = await quota(seller.cookie);
    expect(q).toMatchObject({
      freeLimit: 3, lifetimePublications: 0, freeUsed: 0, freeRemaining: 3,
      nextPublicationNumber: 1, nextPublicationIsPaid: false, listingFeeMinor: 200, currency: "AZN",
    });
    for (let i = 1; i <= 4; i += 1) {
      const draft = await completeDraft(seller.cookie);
      expect((await submit(seller.cookie, draft.id, draft.revision)).status).toBe(200);
      q = await quota(seller.cookie);
      expect(q.lifetimePublications).toBe(i);
      expect(q.nextPublicationNumber).toBe(i + 1);
      expect(q.freeUsed).toBe(Math.min(i, 3));
      expect(q.freeRemaining).toBe(Math.max(0, 3 - i));
      expect(q.nextPublicationIsPaid).toBe(i + 1 > 3);
    }
  });

  it("uses the configured free limit rather than a hard-coded 3", async () => {
    await setSetting("listing.free_publication_limit", "1", "3");
    try {
      const seller = await newSeller();
      expect((await quota(seller.cookie)).freeLimit).toBe(1);
      const first = await completeDraft(seller.cookie);
      const r1 = await submit(seller.cookie, first.id, first.revision);
      expect((r1.body.data?.publication as { billingType: string }).billingType).toBe("FREE");
      const second = await completeDraft(seller.cookie);
      const r2 = await submit(seller.cookie, second.id, second.revision);
      expect((r2.body.data?.publication as { billingType: string }).billingType).toBe("PAID");
      expect((await quota(seller.cookie)).nextPublicationIsPaid).toBe(true);
    } finally {
      await setSetting("listing.free_publication_limit", null, "3");
    }
  });

  it("is readable by blocked users and requires auth", async () => {
    const blocked = await newSeller(true);
    expect((await quota(blocked.cookie)).freeRemaining).toBe(3);
    const anon = await api(quotaRoute, "GET", QUOTA_URL);
    expect(anon.status).toBe(401);
  });
});

describe("POST /me/listings/:id/submit — validation", () => {
  it("rejects unauthenticated, blocked, foreign, and cross-origin requests", async () => {
    const seller = await newSeller();
    const draft = await completeDraft(seller.cookie);
    const anon = await api(submitRoute, "POST", `${LISTINGS_BASE}/${draft.id}/submit`, {
      body: { expected_revision: draft.revision },
      params: { listingId: draft.id },
    });
    expect(anon.status).toBe(401);
    const blocked = await newSeller(true);
    expect((await submit(blocked.cookie, draft.id, draft.revision)).body.error?.code).toBe("USER_BLOCKED");
    const other = await newSeller();
    const foreign = await submit(other.cookie, draft.id, draft.revision);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error?.code).toBe("LISTING_NOT_FOUND");
    const xo = await submit(seller.cookie, draft.id, draft.revision, {}, "https://evil.example");
    expect(xo.status).toBe(403);
    expect(await countRows("listing_publications", "listing_id", draft.id)).toBe(0);
  });

  it("rejects a stale expected_revision", async () => {
    const seller = await newSeller();
    const draft = await completeDraft(seller.cookie);
    const stale = await submit(seller.cookie, draft.id, draft.revision - 1);
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("LISTING_REVISION_CONFLICT");
  });

  it("rejects client-supplied pricing/publication fields", async () => {
    const seller = await newSeller();
    const draft = await completeDraft(seller.cookie);
    for (const extra of [{ amount_minor: 1 }, { publication_number: 1 }, { billing_type: "FREE" }]) {
      const r = await submit(seller.cookie, draft.id, draft.revision, extra);
      expect(r.status).toBe(400);
      expect(r.body.error?.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects a sparse draft with missing field codes", async () => {
    const seller = await newSeller();
    const draft = await createDraftVia(routes, seller.cookie);
    const r = await submit(seller.cookie, draft.id, draft.revision);
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe("LISTING_INCOMPLETE");
    expect((r.body.error?.details as { missing: string[] }).missing).toEqual(
      expect.arrayContaining(["brand", "model", "year", "price", "mileage", "city", "contact_phone"]),
    );
  });

  it("requires the configured minimum of CONFIRMED images (pending never counts)", async () => {
    const seller = await newSeller();
    const draft = await createDraftVia(routes, seller.cookie);
    const patch = await api(routes.patch, "PATCH", `${LISTINGS_BASE}/${draft.id}`, {
      body: {
        expected_revision: 1, brand_id: carBrandId, model_id: carModelId, year: 2019,
        price_minor: 900000, mileage: 1000, city_id: cityId, contact_phone: "+994501234567",
      },
      cookie: seller.cookie,
      params: { listingId: draft.id },
    });
    let revision = (patch.body.data?.listing as { revision: number }).revision;
    revision = (await uploadAndConfirmVia(routes, storage, seller.cookie, draft.id)).revision;
    revision = (await uploadAndConfirmVia(routes, storage, seller.cookie, draft.id)).revision;
    // a third upload is issued but never confirmed
    const pending = await api(routes.uploadUrl, "POST", `${LISTINGS_BASE}/${draft.id}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 100 },
      cookie: seller.cookie,
      params: { listingId: draft.id },
    });
    expect(pending.status).toBe(200);
    const r = await submit(seller.cookie, draft.id, revision);
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe("LISTING_INSUFFICIENT_IMAGES");
    expect(r.body.error?.details).toMatchObject({ required: 3, confirmed: 2 });
  });

  it("requires a primary image", async () => {
    const seller = await newSeller();
    const draft = await completeDraft(seller.cookie);
    const sql = getSql();
    await sql`update listing_images set is_primary = false where listing_id = ${draft.id}`;
    const r = await submit(seller.cookie, draft.id, draft.revision);
    expect(r.body.error?.code).toBe("LISTING_INSUFFICIENT_IMAGES");
    expect(r.body.error?.details).toMatchObject({ primary: false });
  });

  it("revalidates catalog data: deactivated brand and cross-category model rejected", async () => {
    const seller = await newSeller();
    const sql = getSql();
    const draft = await completeDraft(seller.cookie);
    await sql`update brands set is_active = false where id = ${carBrandId}`;
    try {
      const r = await submit(seller.cookie, draft.id, draft.revision);
      expect(r.status).toBe(400);
      expect(r.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
      expect(r.body.error?.details).toMatchObject({ field: "brand" });
    } finally {
      await sql`update brands set is_active = true where id = ${carBrandId}`;
    }
    // model relation broken behind the API (simulating drift)
    await sql`update models set id = id where id = ${motoModelId}`;
    const second = await completeDraft(seller.cookie);
    await sql`update listings set model_id = ${motoModelId} where id = ${second.id}`;
    const r2 = await submit(seller.cookie, second.id, second.revision);
    expect(r2.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
    expect(r2.body.error?.details).toMatchObject({ field: "model" });
    expect(await countRows("listing_publications", "user_id", seller.userId)).toBe(0);
  });
});

describe("FREE path", () => {
  it("publications #1–#3 are FREE and enter moderation with full side-effect accounting", async () => {
    const seller = await newSeller();
    const sql = getSql();
    for (let n = 1; n <= 3; n += 1) {
      const draft = await completeDraft(seller.cookie);
      const r = await submit(seller.cookie, draft.id, draft.revision);
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({
        listing: { id: draft.id, status: "PENDING_MODERATION", revision: draft.revision },
        publication: { number: n, billingType: "FREE" },
        payment: null,
        nextAction: "MODERATION",
      });
      const [row] = await sql<Record<string, unknown>[]>`
        select status, revision, submitted_at, published_at, current_expires_at
        from listings where id = ${draft.id}
      `;
      expect(row.status).toBe("PENDING_MODERATION");
      expect(row.revision).toBe(draft.revision); // no content revision bump
      expect(row.submitted_at).not.toBeNull();
      expect(row.published_at).toBeNull();
      expect(row.current_expires_at).toBeNull();
      expect(await countRows("payments", "listing_id", draft.id)).toBe(0);
      expect(await countRows("listing_publications", "listing_id", draft.id)).toBe(1);
      expect(await countRows("listing_status_history", "listing_id", draft.id)).toBe(1);
      expect(await countRows("outbox_events", "aggregate_id", draft.id)).toBe(1);
      expect(await countRows("listing_periods", "listing_id", draft.id)).toBe(0);
      expect(await countRows("moderation_reviews", "listing_id", draft.id)).toBe(0);
      expect(await countRows("moderation_claims", "listing_id", draft.id)).toBe(0);
      const [history] = await sql<{ from_status: string; to_status: string; actor_type: string }[]>`
        select from_status, to_status, actor_type from listing_status_history where listing_id = ${draft.id}
      `;
      expect(history).toMatchObject({ from_status: "DRAFT", to_status: "PENDING_MODERATION", actor_type: "USER" });
      const [event] = await sql<{ event_type: string; status: string }[]>`
        select event_type, status from outbox_events where aggregate_id = ${draft.id}
      `;
      expect(event).toMatchObject({ event_type: "LISTING_ENTERED_MODERATION", status: "PENDING" });
    }
  });
});

describe("PAID path", () => {
  it("publication #4 is PAID with an internal LISTING_FEE intent from settings", async () => {
    const seller = await newSeller();
    const sql = getSql();
    for (let n = 1; n <= 3; n += 1) {
      const d = await completeDraft(seller.cookie);
      expect((await submit(seller.cookie, d.id, d.revision)).status).toBe(200);
    }
    const draft = await completeDraft(seller.cookie);
    const r = await submit(seller.cookie, draft.id, draft.revision);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      listing: { status: "PAYMENT_REQUIRED" },
      publication: { number: 4, billingType: "PAID" },
      payment: { type: "LISTING_FEE", amountMinor: 200, currency: "AZN", status: "CREATED" },
      nextAction: "PAYMENT",
    });
    const paymentId = (r.body.data?.payment as { id: string }).id;
    const [payment] = await sql<Record<string, unknown>[]>`
      select provider, provider_order_id, provider_transaction_id, fulfillment_status,
             idempotency_key, user_id, listing_id
      from payments where id = ${paymentId}
    `;
    expect(payment.provider).toBeNull(); // no fabricated provider
    expect(payment.provider_order_id).toBeNull();
    expect(payment.provider_transaction_id).toBeNull();
    expect(payment.fulfillment_status).toBe("PENDING");
    expect(payment.user_id).toBe(seller.userId);
    expect(payment.listing_id).toBe(draft.id);
    const [pub] = await sql<{ payment_id: string }[]>`
      select payment_id from listing_publications where listing_id = ${draft.id}
    `;
    expect(pub.payment_id).toBe(paymentId);
    const [row] = await sql<Record<string, unknown>[]>`
      select status, submitted_at, published_at, current_expires_at from listings where id = ${draft.id}
    `;
    expect(row.status).toBe("PAYMENT_REQUIRED");
    expect(row.submitted_at).toBeNull(); // queue-entry semantics
    expect(row.published_at).toBeNull();
    expect(row.current_expires_at).toBeNull();
    expect(await countRows("listing_periods", "listing_id", draft.id)).toBe(0);
    expect(await countRows("moderation_reviews", "listing_id", draft.id)).toBe(0);
    const queue = await sql`
      select 1 from listings where id = ${draft.id} and status = 'PENDING_MODERATION'
    `;
    expect(queue.length).toBe(0); // not in the moderator queue
    const [event] = await sql<{ event_type: string }[]>`
      select event_type from outbox_events where aggregate_id = ${draft.id}
    `;
    expect(event.event_type).toBe("LISTING_PAYMENT_REQUIRED");
  });

  it("reads the fee from system_settings at submit time", async () => {
    await setSetting("listing.free_publication_limit", "0", "3");
    await setSetting("listing.publication_fee_minor", "350", "200");
    try {
      const seller = await newSeller();
      const draft = await completeDraft(seller.cookie);
      const r = await submit(seller.cookie, draft.id, draft.revision);
      expect((r.body.data?.payment as { amountMinor: number }).amountMinor).toBe(350);
    } finally {
      await setSetting("listing.publication_fee_minor", null, "200");
      await setSetting("listing.free_publication_limit", null, "3");
    }
  });

  it("fails closed when monetization settings are missing", async () => {
    const sql = getSql();
    const [saved] = await sql<{ value: unknown }[]>`
      select value from system_settings where key = 'listing.publication_fee_minor'
    `;
    await sql`delete from system_settings where key = 'listing.publication_fee_minor'`;
    try {
      const seller = await newSeller();
      const q = await api(quotaRoute, "GET", QUOTA_URL, { cookie: seller.cookie });
      expect(q.status).toBe(500);
      expect(q.body.error?.code).toBe("LISTING_PAYMENT_CONFIGURATION_ERROR");
    } finally {
      await sql`
        insert into system_settings (key, value, value_type, description)
        values ('listing.publication_fee_minor', ${String(saved.value)}::jsonb, 'money_minor', 'restored')
      `;
    }
  });
});

describe("idempotency", () => {
  it("retrying a FREE submit reuses the publication without new effects", async () => {
    const seller = await newSeller();
    const draft = await completeDraft(seller.cookie);
    const first = await submit(seller.cookie, draft.id, draft.revision);
    const retry = await submit(seller.cookie, draft.id, draft.revision);
    expect(retry.status).toBe(200);
    expect(retry.body.data).toEqual(first.body.data);
    expect(await countRows("listing_publications", "listing_id", draft.id)).toBe(1);
    expect(await countRows("listing_status_history", "listing_id", draft.id)).toBe(1);
    expect(await countRows("outbox_events", "aggregate_id", draft.id)).toBe(1);
  });

  it("retrying a PAID submit reuses the publication and payment", async () => {
    await setSetting("listing.free_publication_limit", "0", "3");
    try {
      const seller = await newSeller();
      const draft = await completeDraft(seller.cookie);
      const first = await submit(seller.cookie, draft.id, draft.revision);
      const retry = await submit(seller.cookie, draft.id, draft.revision);
      expect(retry.body.data).toEqual(first.body.data);
      expect(await countRows("payments", "listing_id", draft.id)).toBe(1);
      expect(await countRows("listing_publications", "listing_id", draft.id)).toBe(1);
      expect(await countRows("listing_status_history", "listing_id", draft.id)).toBe(1);
      expect(await countRows("outbox_events", "aggregate_id", draft.id)).toBe(1);
    } finally {
      await setSetting("listing.free_publication_limit", null, "3");
    }
  });
});

describe("concurrency", () => {
  it("two drafts submitted at the free boundary get exactly #3 FREE and #4 PAID", async () => {
    const seller = await newSeller();
    for (let n = 1; n <= 2; n += 1) {
      const d = await completeDraft(seller.cookie);
      expect((await submit(seller.cookie, d.id, d.revision)).status).toBe(200);
    }
    const a = await completeDraft(seller.cookie);
    const b = await completeDraft(seller.cookie);
    const [ra, rb] = await Promise.all([
      submit(seller.cookie, a.id, a.revision),
      submit(seller.cookie, b.id, b.revision),
    ]);
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    const pubs = [ra, rb]
      .map((r) => r.body.data?.publication as { number: number; billingType: string })
      .sort((x, y) => x.number - y.number);
    expect(pubs).toEqual([
      { number: 3, billingType: "FREE" },
      { number: 4, billingType: "PAID" },
    ]);
    const sql = getSql();
    const numbers = await sql<{ publication_number: number }[]>`
      select publication_number from listing_publications where user_id = ${seller.userId} order by 1
    `;
    expect(numbers.map((n) => n.publication_number)).toEqual([1, 2, 3, 4]);
    const payments = await sql`
      select 1 from payments where user_id = ${seller.userId} and type = 'LISTING_FEE'
    `;
    expect(payments.length).toBe(1);
  });

  it("the same listing submitted concurrently never double-allocates", async () => {
    await setSetting("listing.free_publication_limit", "0", "3");
    try {
      const seller = await newSeller();
      const draft = await completeDraft(seller.cookie);
      const results = await Promise.all(
        Array.from({ length: 4 }, () => submit(seller.cookie, draft.id, draft.revision)),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      const numbers = new Set(
        results.map((r) => (r.body.data?.publication as { number: number }).number),
      );
      expect(numbers.size).toBe(1);
      expect(await countRows("listing_publications", "listing_id", draft.id)).toBe(1);
      expect(await countRows("payments", "listing_id", draft.id)).toBe(1);
      expect(await countRows("listing_status_history", "listing_id", draft.id)).toBe(1);
      expect(await countRows("outbox_events", "aggregate_id", draft.id)).toBe(1);
    } finally {
      await setSetting("listing.free_publication_limit", null, "3");
    }
  });
});

describe("post-submit state", () => {
  it("freezes drafts, rejects image mutations, and invalidates pending uploads", async () => {
    const seller = await newSeller();
    const draft = await completeDraft(seller.cookie);
    // a live pending upload that is never confirmed before submit
    const pending = await api(routes.uploadUrl, "POST", `${LISTINGS_BASE}/${draft.id}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 100 },
      cookie: seller.cookie,
      params: { listingId: draft.id },
    });
    storage.uploadViaSignedUrl(pending.body.data?.upload_url as string, Buffer.from("x"));
    expect((await submit(seller.cookie, draft.id, draft.revision)).status).toBe(200);

    const sql = getSql();
    const [upload] = await sql<{ status: string }[]>`
      select status from listing_image_uploads where id = ${pending.body.data?.upload_id as string}
    `;
    expect(upload.status).toBe("EXPIRED");

    const patch = await api(routes.patch, "PATCH", `${LISTINGS_BASE}/${draft.id}`, {
      body: { expected_revision: draft.revision, year: 2021 },
      cookie: seller.cookie,
      params: { listingId: draft.id },
    });
    expect(patch.status).toBe(409);
    expect(patch.body.error?.code).toBe("LISTING_NOT_EDITABLE");

    const uploadUrl = await api(routes.uploadUrl, "POST", `${LISTINGS_BASE}/${draft.id}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 100 },
      cookie: seller.cookie,
      params: { listingId: draft.id },
    });
    expect(uploadUrl.body.error?.code).toBe("LISTING_NOT_EDITABLE");

    const confirm = await api(routes.confirm, "POST", `${LISTINGS_BASE}/${draft.id}/images/confirm`, {
      body: { upload_id: pending.body.data?.upload_id },
      cookie: seller.cookie,
      params: { listingId: draft.id },
    });
    expect([409, 404]).toContain(confirm.status);
    expect(["LISTING_NOT_EDITABLE", "IMAGE_UPLOAD_NOT_FOUND"]).toContain(confirm.body.error?.code);

    const [image] = await sql<{ id: string }[]>`
      select id from listing_images where listing_id = ${draft.id} limit 1
    `;
    const del = await api(deleteImageRoute, "DELETE", `${LISTINGS_BASE}/${draft.id}/images/${image.id}`, {
      cookie: seller.cookie,
      params: { listingId: draft.id, imageId: image.id },
    });
    expect(del.body.error?.code).toBe("LISTING_NOT_EDITABLE");
    expect(await countRows("listing_publications", "listing_id", draft.id)).toBe(1);
  });

  it("a PAYMENT_REQUIRED listing is equally frozen", async () => {
    await setSetting("listing.free_publication_limit", "0", "3");
    try {
      const seller = await newSeller();
      const draft = await completeDraft(seller.cookie);
      const r = await submit(seller.cookie, draft.id, draft.revision);
      expect((r.body.data?.listing as { status: string }).status).toBe("PAYMENT_REQUIRED");
      const patch = await api(routes.patch, "PATCH", `${LISTINGS_BASE}/${draft.id}`, {
        body: { expected_revision: draft.revision, year: 2021 },
        cookie: seller.cookie,
        params: { listingId: draft.id },
      });
      expect(patch.body.error?.code).toBe("LISTING_NOT_EDITABLE");
    } finally {
      await setSetting("listing.free_publication_limit", null, "3");
    }
  });
});
