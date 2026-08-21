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
import { POST as submitRoute } from "@/app/api/v1/me/listings/[listingId]/submit/route";
import { POST as resubmitRoute } from "@/app/api/v1/me/listings/[listingId]/resubmit/route";
import { GET as queueRoute } from "@/app/api/v1/moderator/listings/route";
import { GET as detailRoute } from "@/app/api/v1/moderator/listings/[listingId]/route";
import { POST as claimRoute } from "@/app/api/v1/moderator/listings/[listingId]/claim/route";
import { POST as approveRoute } from "@/app/api/v1/moderator/listings/[listingId]/approve/route";
import { POST as rejectRoute } from "@/app/api/v1/moderator/listings/[listingId]/reject/route";
import { POST as correctionRoute } from "@/app/api/v1/moderator/listings/[listingId]/request-correction/route";

const MOD = "http://localhost/api/v1/moderator/listings";

let storage: MemoryStorageProvider;
let routes: ListingRoutes;
let phoneCounter = 5_000_000;
let brandId = "";
let modelId = "";
let cityId = "";
type Session = { userId: string; cookie: string };

async function newUser(opts: { blocked?: boolean; roles?: string[] } = {}): Promise<Session> {
  phoneCounter += 1;
  return createTestUserSession(`+99451${phoneCounter}`, opts);
}

async function pendingListing(seller: Session): Promise<{ id: string; revision: number }> {
  const draft = await createDraftVia(routes, seller.cookie);
  const patch = await api(routes.patch, "PATCH", `${LISTINGS_BASE}/${draft.id}`, {
    body: {
      expected_revision: draft.revision, brand_id: brandId, model_id: modelId, year: 2018,
      price_minor: 1200000, mileage: 50000, city_id: cityId, contact_phone: "+994501234567",
    },
    cookie: seller.cookie, params: { listingId: draft.id },
  });
  expect(patch.status).toBe(200);
  let revision = (patch.body.data?.listing as { revision: number }).revision;
  for (let i = 0; i < 3; i += 1) {
    revision = (await uploadAndConfirmVia(routes, storage, seller.cookie, draft.id)).revision;
  }
  const submit = await api(submitRoute, "POST", `${LISTINGS_BASE}/${draft.id}/submit`, {
    body: { expected_revision: revision }, cookie: seller.cookie, params: { listingId: draft.id },
  });
  expect(submit.status).toBe(200);
  expect((submit.body.data?.listing as { status: string }).status).toBe("PENDING_MODERATION");
  return { id: draft.id, revision };
}

async function claim(mod: Session, listingId: string, origin?: string) {
  return api(claimRoute, "POST", `${MOD}/${listingId}/claim`, { cookie: mod.cookie, params: { listingId }, origin });
}
async function approve(mod: Session, listingId: string, revision: number, extra: Record<string, unknown> = {}) {
  return api(approveRoute, "POST", `${MOD}/${listingId}/approve`, {
    body: { expected_revision: revision, ...extra }, cookie: mod.cookie, params: { listingId },
  });
}
async function reject(mod: Session, listingId: string, revision: number, body: Record<string, unknown> = { reason_code: "INVALID_PHOTOS", note: "blurry" }) {
  return api(rejectRoute, "POST", `${MOD}/${listingId}/reject`, {
    body: { expected_revision: revision, ...body }, cookie: mod.cookie, params: { listingId },
  });
}
async function correction(mod: Session, listingId: string, revision: number) {
  return api(correctionRoute, "POST", `${MOD}/${listingId}/request-correction`, {
    body: { expected_revision: revision, reason_code: "INCOMPLETE_INFO", note: "add engine size" },
    cookie: mod.cookie, params: { listingId },
  });
}
async function resubmit(seller: Session, listingId: string, revision: number) {
  return api(resubmitRoute, "POST", `${LISTINGS_BASE}/${listingId}/resubmit`, {
    body: { expected_revision: revision }, cookie: seller.cookie, params: { listingId },
  });
}
async function queue(mod: Session, query = "") {
  const r = await api(queueRoute, "GET", `${MOD}${query}`, { cookie: mod.cookie });
  return r;
}
async function count(table: "moderation_reviews" | "listing_periods" | "listing_status_history" | "outbox_events" | "payments" | "listing_publications" | "moderation_claims", column: string, id: string, extra = ""): Promise<number> {
  const sql = getSql();
  const rows = await sql.unsafe<{ count: string }[]>(
    `select count(*)::text as count from ${table} where ${column} = $1 ${extra}`, [id],
  );
  return Number(rows[0].count);
}
async function listingRow(id: string) {
  const sql = getSql();
  const [row] = await sql<Record<string, unknown>[]>`
    select status, revision, submitted_at, published_at, current_expires_at from listings where id = ${id}
  `;
  return row;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  routes = { create: createListingRoute, patch: patchListingRoute, uploadUrl: uploadUrlRoute, confirm: confirmRoute };
  const sql = getSql();
  const [brand] = await sql<{ id: string }[]>`insert into brands (name, slug) values ('MdKia', 'md-kia') returning id`;
  brandId = brand.id;
  await sql`insert into brand_categories (brand_id, category_id) select ${brandId}, id from categories where code = 'CAR'`;
  const [model] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    select ${brandId}, id, 'MdSportage', 'md-sportage' from categories where code = 'CAR' returning id`;
  modelId = model.id;
  const [city] = await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('MdŞəki', 'md-seki', 96) returning id`;
  cityId = city.id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("staff authorization", () => {
  it("enforces the staff role matrix and actor identity", async () => {
    const anon = await api(queueRoute, "GET", MOD);
    expect(anon.status).toBe(401);
    const user = await newUser();
    const denied = await queue(user);
    expect(denied.status).toBe(403);
    expect(denied.body.error?.code).toBe("STAFF_ROLE_REQUIRED");
    for (const role of ["MODERATOR", "ADMIN", "SUPER_ADMIN"]) {
      const staff = await newUser({ roles: [role] });
      expect((await queue(staff)).status).toBe(200);
    }
    const blockedMod = await newUser({ roles: ["MODERATOR"], blocked: true });
    expect((await queue(blockedMod)).body.error?.code).toBe("USER_BLOCKED");
    // body-supplied actor identity is rejected by the strict schema
    const mod = await newUser({ roles: ["MODERATOR"] });
    const listing = await pendingListing(await newUser());
    await claim(mod, listing.id);
    const spoof = await approve(mod, listing.id, listing.revision, { moderator_id: "someone-else" });
    expect(spoof.status).toBe(400);
    expect(spoof.body.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("moderation queue", () => {
  it("lists only PENDING_MODERATION oldest-first with pagination and claim state", async () => {
    const mod = await newUser({ roles: ["MODERATOR"] });
    const seller = await newUser();
    const a = await pendingListing(seller);
    const b = await pendingListing(seller);
    const page1 = await queue(mod, "?limit=1");
    const items1 = page1.body.data?.items as { id: string }[];
    const cursor = page1.body.data?.next_cursor as string;
    expect(items1.length).toBe(1);
    expect(cursor).toBeTruthy();
    const rest = (await queue(mod, `?limit=100&cursor=${cursor}`)).body.data?.items as { id: string }[];
    const all = [...items1, ...rest].map((i) => i.id);
    expect(all.indexOf(a.id)).toBeGreaterThanOrEqual(0);
    expect(all.indexOf(a.id)).toBeLessThan(all.indexOf(b.id)); // oldest first
    expect(new Set(all).size).toBe(all.length); // deterministic, no duplicates across pages

    await claim(mod, a.id);
    const full = (await queue(mod, "?limit=100")).body.data?.items as Record<string, unknown>[];
    const itemA = full.find((i) => i.id === a.id)!;
    expect((itemA.claim as { moderatorId: string }).moderatorId).toBe(mod.userId);
    expect(JSON.stringify(itemA)).not.toContain("+99451"); // seller phone masked
    expect(itemA.primaryImageUrl).toContain("memory://signed-read/");

    // PAYMENT_REQUIRED (free limit 0) and ACTIVE are excluded
    const sql = getSql();
    await sql`update system_settings set value = '0'::jsonb where key = 'listing.free_publication_limit'`;
    let paid: { id: string };
    try {
      const draft = await createDraftVia(routes, seller.cookie);
      await api(routes.patch, "PATCH", `${LISTINGS_BASE}/${draft.id}`, {
        body: { expected_revision: 1, brand_id: brandId, model_id: modelId, year: 2018, price_minor: 1, mileage: 1, city_id: cityId, contact_phone: "+994501234567" },
        cookie: seller.cookie, params: { listingId: draft.id },
      });
      let rev = 2;
      for (let i = 0; i < 3; i += 1) rev = (await uploadAndConfirmVia(routes, storage, seller.cookie, draft.id)).revision;
      const s = await api(submitRoute, "POST", `${LISTINGS_BASE}/${draft.id}/submit`, { body: { expected_revision: rev }, cookie: seller.cookie, params: { listingId: draft.id } });
      expect((s.body.data?.listing as { status: string }).status).toBe("PAYMENT_REQUIRED");
      paid = { id: draft.id };
    } finally {
      await sql`update system_settings set value = '3'::jsonb where key = 'listing.free_publication_limit'`;
    }
    await approve(mod, a.id, a.revision);
    const after = ((await queue(mod, "?limit=100")).body.data?.items as { id: string }[]).map((i) => i.id);
    expect(after).not.toContain(paid.id);
    expect(after).not.toContain(a.id);
    expect(after).toContain(b.id);
  });

  it("detail exposes labels, images, reviews and claim without storage internals", async () => {
    const mod = await newUser({ roles: ["MODERATOR"] });
    const listing = await pendingListing(await newUser());
    const r = await api(detailRoute, "GET", `${MOD}/${listing.id}`, { cookie: mod.cookie, params: { listingId: listing.id } });
    expect(r.status).toBe(200);
    const d = r.body.data?.listing as Record<string, unknown>;
    expect(d.status).toBe("PENDING_MODERATION");
    expect((d.brand as { name: string }).name).toBe("MdKia");
    expect((d.images as unknown[]).length).toBe(3);
    expect(JSON.stringify(d)).not.toMatch(/storage_?[pP]ath/); // no raw storage path fields
    expect(JSON.stringify(d)).not.toContain("+99451");
    const user = await newUser();
    expect((await api(detailRoute, "GET", `${MOD}/${listing.id}`, { cookie: user.cookie, params: { listingId: listing.id } })).status).toBe(403);
  });
});

describe("claims", () => {
  it("enforces single live claim, same-moderator retry, expiry replacement, and state", async () => {
    const m1 = await newUser({ roles: ["MODERATOR"] });
    const m2 = await newUser({ roles: ["MODERATOR"] });
    const listing = await pendingListing(await newUser());
    expect((await claim(m1, listing.id)).status).toBe(200);
    expect((await claim(m1, listing.id)).status).toBe(200); // retry/extend
    const blocked = await claim(m2, listing.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error?.code).toBe("MODERATION_CLAIMED_BY_OTHER");
    const sql = getSql();
    // expire the live claim (keep expires_at > claimed_at for the CHECK)
    await sql`
      update moderation_claims
      set claimed_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute'
      where listing_id = ${listing.id} and released_at is null
    `;
    expect((await claim(m2, listing.id)).status).toBe(200); // expired → replaceable
    expect(await count("moderation_claims", "listing_id", listing.id, "and released_at is null")).toBe(1);
    expect((await claim(m1, listing.id, "https://evil.example")).status).toBe(403);
    await approve(m2, listing.id, listing.revision);
    const notPending = await claim(m1, listing.id);
    expect(notPending.body.error?.code).toBe("MODERATION_INVALID_STATE");
  });

  it("two concurrent moderators cannot both own a valid claim", async () => {
    const m1 = await newUser({ roles: ["MODERATOR"] });
    const m2 = await newUser({ roles: ["ADMIN"] });
    const listing = await pendingListing(await newUser());
    const [a, b] = await Promise.all([claim(m1, listing.id), claim(m2, listing.id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await count("moderation_claims", "listing_id", listing.id, "and released_at is null")).toBe(1);
  });
});

describe("approval", () => {
  it("requires a claim and a fresh revision", async () => {
    const mod = await newUser({ roles: ["MODERATOR"] });
    const other = await newUser({ roles: ["MODERATOR"] });
    const listing = await pendingListing(await newUser());
    expect((await approve(mod, listing.id, listing.revision)).body.error?.code).toBe("MODERATION_CLAIM_REQUIRED");
    await claim(other, listing.id);
    expect((await approve(mod, listing.id, listing.revision)).body.error?.code).toBe("MODERATION_CLAIMED_BY_OTHER");
    const stale = await approve(other, listing.id, listing.revision - 1);
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("LISTING_REVISION_CONFLICT");
    expect(await count("moderation_reviews", "listing_id", listing.id)).toBe(0);
  });

  it("activates exactly once with a settings-driven 30-day initial period", async () => {
    const mod = await newUser({ roles: ["MODERATOR"] });
    const listing = await pendingListing(await newUser());
    await claim(mod, listing.id);
    const before = Date.now();
    const r = await approve(mod, listing.id, listing.revision);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      listing: { status: "ACTIVE", revision: listing.revision },
      review: { decision: "APPROVED", moderatorId: mod.userId, listingRevision: listing.revision },
    });
    const activation = r.body.data?.activation as { publishedAt: string; currentExpiresAt: string; periodNumber: number };
    expect(activation.periodNumber).toBe(1);
    const row = await listingRow(listing.id);
    expect(row.status).toBe("ACTIVE");
    expect(row.revision).toBe(listing.revision);
    const published = (row.published_at as Date).getTime();
    const expires = (row.current_expires_at as Date).getTime();
    expect(published).toBeGreaterThanOrEqual(before - 1000);
    expect(expires - published).toBe(30 * 86_400_000);
    const sql = getSql();
    const [period] = await sql<{ period_number: number; source: string; starts_at: Date; ends_at: Date; payment_id: string | null; status: string }[]>`
      select period_number, source, starts_at, ends_at, payment_id, status from listing_periods where listing_id = ${listing.id}
    `;
    expect(period).toMatchObject({ period_number: 1, source: "INITIAL", payment_id: null, status: "ACTIVE" });
    expect(period.ends_at.getTime()).toBe(expires);
    expect(await count("moderation_reviews", "listing_id", listing.id)).toBe(1);
    expect(await count("listing_periods", "listing_id", listing.id)).toBe(1);
    expect(await count("listing_status_history", "listing_id", listing.id)).toBe(2); // submit + approve
    expect(await count("outbox_events", "aggregate_id", listing.id, "and event_type = 'LISTING_ACTIVATED'")).toBe(1);
    expect(await count("payments", "listing_id", listing.id)).toBe(0);
    expect(await count("moderation_claims", "listing_id", listing.id, "and released_at is null")).toBe(0);

    // identical retry is idempotent; a different actor gets a state conflict
    const retry = await approve(mod, listing.id, listing.revision);
    expect(retry.status).toBe(200);
    expect((retry.body.data?.review as { id: string }).id).toBe((r.body.data?.review as { id: string }).id);
    expect(await count("listing_periods", "listing_id", listing.id)).toBe(1);
    expect(await count("moderation_reviews", "listing_id", listing.id)).toBe(1);
    const other = await newUser({ roles: ["ADMIN"] });
    const conflict = await approve(other, listing.id, listing.revision);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe("MODERATION_INVALID_STATE");
  });

  it("reads validity from system_settings and fails closed when missing", async () => {
    const sql = getSql();
    const mod = await newUser({ roles: ["MODERATOR"] });
    await sql`update system_settings set value = '45'::jsonb where key = 'listing.validity_days'`;
    try {
      const listing = await pendingListing(await newUser());
      await claim(mod, listing.id);
      await approve(mod, listing.id, listing.revision);
      const row = await listingRow(listing.id);
      expect((row.current_expires_at as Date).getTime() - (row.published_at as Date).getTime()).toBe(45 * 86_400_000);
    } finally {
      await sql`update system_settings set value = '30'::jsonb where key = 'listing.validity_days'`;
    }
    await sql`delete from system_settings where key = 'listing.validity_days'`;
    try {
      const listing = await pendingListing(await newUser());
      await claim(mod, listing.id);
      const r = await approve(mod, listing.id, listing.revision);
      expect(r.status).toBe(500);
      expect(r.body.error?.code).toBe("LISTING_CONFIGURATION_ERROR");
      expect((await listingRow(listing.id)).status).toBe("PENDING_MODERATION"); // rolled back
      expect(await count("moderation_reviews", "listing_id", listing.id)).toBe(0);
    } finally {
      await sql`insert into system_settings (key, value, value_type, description) values ('listing.validity_days', '30'::jsonb, 'integer', 'restored')`;
    }
  });
});

describe("decision races", () => {
  it("approve vs approve yields one review and one period", async () => {
    const mod = await newUser({ roles: ["MODERATOR"] });
    const listing = await pendingListing(await newUser());
    await claim(mod, listing.id);
    const results = await Promise.all([
      approve(mod, listing.id, listing.revision),
      approve(mod, listing.id, listing.revision),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await count("moderation_reviews", "listing_id", listing.id)).toBe(1);
    expect(await count("listing_periods", "listing_id", listing.id)).toBe(1);
    expect(await count("outbox_events", "aggregate_id", listing.id, "and event_type = 'LISTING_ACTIVATED'")).toBe(1);
  });

  it("approve vs reject lets exactly one lifecycle decision win", async () => {
    const mod = await newUser({ roles: ["MODERATOR"] });
    const listing = await pendingListing(await newUser());
    await claim(mod, listing.id);
    const [a, r] = await Promise.all([
      approve(mod, listing.id, listing.revision),
      reject(mod, listing.id, listing.revision),
    ]);
    expect([a.status, r.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? "ACTIVE" : "REJECTED";
    expect((await listingRow(listing.id)).status).toBe(winner);
    expect(await count("moderation_reviews", "listing_id", listing.id)).toBe(1);
    expect(await count("listing_periods", "listing_id", listing.id)).toBe(winner === "ACTIVE" ? 1 : 0);
  });
});

describe("reject / correction", () => {
  it("rejection records review + history without activation data", async () => {
    const mod = await newUser({ roles: ["MODERATOR"] });
    const listing = await pendingListing(await newUser());
    await claim(mod, listing.id);
    const noReason = await reject(mod, listing.id, listing.revision, {});
    expect(noReason.status).toBe(400);
    const longNote = await reject(mod, listing.id, listing.revision, { reason_code: "OTHER", note: "x".repeat(1001) });
    expect(longNote.status).toBe(400);
    const r = await reject(mod, listing.id, listing.revision);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      listing: { status: "REJECTED" },
      review: { decision: "REJECTED", reasonCode: "INVALID_PHOTOS", note: "blurry" },
      activation: null,
    });
    const row = await listingRow(listing.id);
    expect(row.status).toBe("REJECTED");
    expect(row.published_at).toBeNull();
    expect(row.current_expires_at).toBeNull();
    expect(await count("listing_periods", "listing_id", listing.id)).toBe(0);
    expect(await count("moderation_claims", "listing_id", listing.id, "and released_at is null")).toBe(0);
    expect(await count("outbox_events", "aggregate_id", listing.id, "and event_type = 'LISTING_REJECTED'")).toBe(1);
  });

  it("correction request moves the listing to CORRECTION_REQUIRED", async () => {
    const mod = await newUser({ roles: ["MODERATOR"] });
    const listing = await pendingListing(await newUser());
    await claim(mod, listing.id);
    const r = await correction(mod, listing.id, listing.revision);
    expect(r.status).toBe(200);
    expect((await listingRow(listing.id)).status).toBe("CORRECTION_REQUIRED");
    expect(await count("moderation_reviews", "listing_id", listing.id, "and decision = 'CORRECTION_REQUESTED'")).toBe(1);
    expect(await count("outbox_events", "aggregate_id", listing.id, "and event_type = 'LISTING_CORRECTION_REQUESTED'")).toBe(1);
  });
});

describe("seller correction and resubmission", () => {
  async function returnedListing(seller: Session, decision: "correction" | "reject") {
    const mod = await newUser({ roles: ["MODERATOR"] });
    const listing = await pendingListing(seller);
    await claim(mod, listing.id);
    const r = decision === "correction"
      ? await correction(mod, listing.id, listing.revision)
      : await reject(mod, listing.id, listing.revision);
    expect(r.status).toBe(200);
    return listing;
  }

  it("allows owner edits and image changes in CORRECTION_REQUIRED / REJECTED only", async () => {
    const seller = await newUser();
    for (const decision of ["correction", "reject"] as const) {
      const listing = await returnedListing(seller, decision);
      const patch = await api(routes.patch, "PATCH", `${LISTINGS_BASE}/${listing.id}`, {
        body: { expected_revision: listing.revision, engine_cc: 2000 },
        cookie: seller.cookie, params: { listingId: listing.id },
      });
      expect(patch.status).toBe(200);
      const rev = (patch.body.data?.listing as { revision: number }).revision;
      expect(rev).toBe(listing.revision + 1);
      const img = await uploadAndConfirmVia(routes, storage, seller.cookie, listing.id);
      expect(img.revision).toBe(rev + 1);
      const foreign = await newUser();
      expect((await api(routes.patch, "PATCH", `${LISTINGS_BASE}/${listing.id}`, {
        body: { expected_revision: rev + 1, year: 2019 }, cookie: foreign.cookie, params: { listingId: listing.id },
      })).status).toBe(404);
    }
    const blocked = await newUser({ blocked: true });
    const frozen = await pendingListing(seller);
    const pending = await api(routes.patch, "PATCH", `${LISTINGS_BASE}/${frozen.id}`, {
      body: { expected_revision: frozen.revision, year: 2019 }, cookie: seller.cookie, params: { listingId: frozen.id },
    });
    expect(pending.body.error?.code).toBe("LISTING_NOT_EDITABLE");
    expect((await api(routes.patch, "PATCH", `${LISTINGS_BASE}/${frozen.id}`, {
      body: { expected_revision: frozen.revision, year: 2019 }, cookie: blocked.cookie, params: { listingId: frozen.id },
    })).status).toBe(403);
  });

  it("resubmits from both returned states without new publication, ordinal, or fee", async () => {
    const seller = await newUser();
    const mod = await newUser({ roles: ["MODERATOR"] });
    for (const decision of ["correction", "reject"] as const) {
      const listing = await returnedListing(seller, decision);
      const sql = getSql();
      const [beforeRow] = await sql<{ submitted_at: Date }[]>`select submitted_at from listings where id = ${listing.id}`;
      const stale = await resubmit(seller, listing.id, listing.revision - 1);
      expect(stale.status).toBe(409);
      const r = await resubmit(seller, listing.id, listing.revision);
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ listing: { status: "PENDING_MODERATION" }, nextAction: "MODERATION" });
      const row = await listingRow(listing.id);
      expect(row.status).toBe("PENDING_MODERATION");
      expect((row.submitted_at as Date).getTime()).toBeGreaterThan(beforeRow.submitted_at.getTime());
      const retry = await resubmit(seller, listing.id, listing.revision);
      expect(retry.status).toBe(200);
      expect(await count("listing_publications", "listing_id", listing.id)).toBe(1);
      expect(await count("payments", "listing_id", listing.id)).toBe(0);
      expect(await count("moderation_reviews", "listing_id", listing.id)).toBe(1); // history kept
      expect(await count("listing_status_history", "listing_id", listing.id)).toBe(3); // submit, decision, resubmit
      expect(await count("outbox_events", "aggregate_id", listing.id, "and event_type = 'LISTING_ENTERED_MODERATION'")).toBe(2);
      const ids = ((await queue(mod, "?limit=100")).body.data?.items as { id: string }[]).map((i) => i.id);
      expect(ids).toContain(listing.id);
    }
    const sql = getSql();
    const ordinals = await sql<{ publication_number: number }[]>`
      select publication_number from listing_publications where user_id = ${seller.userId} order by 1
    `;
    expect(ordinals.map((o) => o.publication_number)).toEqual([1, 2]); // two listings, no extra ordinals
  });

  it("rechecks completeness and catalog on resubmit", async () => {
    const seller = await newUser();
    const sql = getSql();
    const listing = await returnedListing(seller, "correction");
    await sql`update cities set is_active = false where id = ${cityId}`;
    try {
      const r = await resubmit(seller, listing.id, listing.revision);
      expect(r.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
    } finally {
      await sql`update cities set is_active = true where id = ${cityId}`;
    }
    await sql`delete from listing_images where listing_id = ${listing.id}`;
    const r2 = await resubmit(seller, listing.id, listing.revision);
    expect(r2.body.error?.code).toBe("LISTING_INSUFFICIENT_IMAGES");
    expect((await listingRow(listing.id)).status).toBe("CORRECTION_REQUIRED");
  });
});
