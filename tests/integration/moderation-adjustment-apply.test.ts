import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  createMemoryStorageProvider,
  type MemoryStorageProvider,
} from "@/providers/storage/memory-provider";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import { listingImageConfig } from "@/lib/config/listing-images";
import { publicDetail } from "@/services/marketplace";
import { myListings } from "@/services/my-listings";
import { runImageCleanup } from "@/services/lifecycle-jobs";
import type { AuthContext } from "@/auth/current-user";
import { createTestUserSession } from "./helpers/session";
import { api, type Route } from "./helpers/listing";
import {
  PATCH as editPatchRoute,
  POST as editCreateRoute,
} from "@/app/api/v1/me/listings/[listingId]/edit-revision/route";
import { POST as editSubmitRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/submit/route";
import { POST as claimRoute } from "@/app/api/v1/moderator/listings/[listingId]/claim/route";
import { POST as approveRoute } from "@/app/api/v1/moderator/listings/[listingId]/approve/route";
import { POST as rejectRoute } from "@/app/api/v1/moderator/listings/[listingId]/reject/route";
import { POST as correctionRoute } from "@/app/api/v1/moderator/listings/[listingId]/request-correction/route";
import { POST as editApproveRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/approve/route";
import { POST as editRejectRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/reject/route";
import { POST as editCorrectionRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/request-correction/route";
import { PUT as adjustmentSaveRoute } from "@/app/api/v1/moderator/listings/[listingId]/adjustment/route";

/**
 * O.13 Stage C — moderator-adjusted NEW decisions. RELEASE-BLOCKING
 * invariants: adjusted approval applies the saved content ATOMICALLY
 * through the unchanged activation lifecycle (one period, same
 * validity/publication semantics); the frozen seller submission is
 * never mutated; correction/reject apply NOTHING and terminal-discard
 * the adjustment; no-adjustment decisions stay byte-identical; EDIT
 * adjusted decisions remain Stage-B-blocked.
 */

const SELLER_BASE = "http://localhost/api/v1/me/listings";
const MOD = "http://localhost/api/v1/moderator/listings";
const CONTACT = "+994701118888";
const BUCKET = () => listingImageConfig().imagesBucket;

let storage: MemoryStorageProvider;
let carCat: string;
let brand: string;
let model: string;
let city: string;
let featA: string;
let featB: string;
let phoneCounter = 6_600_000;
type Session = { userId: string; cookie: string };
let seller: Session;
let mod1: Session;

const sellerAuth = (): AuthContext => ({ user: { id: seller.userId } }) as AuthContext;

async function newUser(opts: { roles?: string[] } = {}): Promise<Session> {
  phoneCounter += 1;
  return createTestUserSession(`+99451${phoneCounter}`, opts);
}

async function insertListing(spec: {
  status: "PENDING_MODERATION" | "ACTIVE";
  images?: number;
  /** Owner-UAT regression shape: legacy-era submissions predate the
      seller_name requirement and are still plainly approvable. */
  sellerName?: string | null;
}): Promise<{ id: string; publicId: number; revision: number; imageIds: string[]; imagePaths: string[] }> {
  const sql = getSql();
  const active = spec.status === "ACTIVE";
  const [row] = await sql<{ id: string; public_id: string; revision: number }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor,
      mileage, credit_available, barter_available, description, contact_phone_e164, seller_name,
      status, submitted_at, published_at, current_expires_at)
    values (${seller.userId}, ${carCat}, ${brand}, ${model}, ${city}, 2021, 2500000,
      50000, false, false, 'O13C satıcı təsviri', ${CONTACT},
      ${spec.sellerName === undefined ? "O13C Satıcı" : spec.sellerName},
      ${spec.status}::listing_status, now() - interval '2 days',
      ${active ? sql`now() - interval '1 day'` : null},
      ${active ? sql`now() + interval '20 days'` : null})
    returning id, public_id::text as public_id, revision
  `;
  const imageIds: string[] = [];
  const imagePaths: string[] = [];
  for (let i = 0; i < (spec.images ?? 4); i += 1) {
    const path = `listings/${randomUUID()}.webp`;
    imagePaths.push(path);
    storage.objects.set(`${BUCKET()}/${path}`, {
      data: Buffer.from("img"),
      contentType: "image/webp",
    });
    const [image] = await sql<{ id: string }[]>`
      insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
      values (${row.id}, ${path}, ${i}, ${i === 0}, 'image/webp', 1000, 1600, 900)
      returning id
    `;
    imageIds.push(image.id);
  }
  await sql`insert into listing_features (listing_id, feature_id) values (${row.id}, ${featA})`;
  // publication row: submitted listings always carry one (baseline
  // parity with the real submit flow)
  await sql`
    insert into listing_publications (listing_id, user_id, publication_number, billing_type)
    values (${row.id}, ${seller.userId},
      (select coalesce(max(publication_number), 0) + 1 from listing_publications where user_id = ${seller.userId}),
      'FREE')
  `;
  return { id: row.id, publicId: Number(row.public_id), revision: row.revision, imageIds, imagePaths };
}

async function claim(session: Session, listingId: string) {
  return api(claimRoute as Route, "POST", `${MOD}/${listingId}/claim`, {
    cookie: session.cookie,
    params: { listingId },
  });
}

function planFor(
  imageIds: string[],
  overrides: Partial<Record<number, { removed?: boolean; primary?: boolean }>> = {},
) {
  return imageIds.map((id, index) => ({
    source_id: id,
    removed: overrides[index]?.removed ?? false,
    is_primary: overrides[index]?.primary ?? index === 0,
  }));
}

async function saveAdjustment(session: Session, listingId: string, body: Record<string, unknown>) {
  return api(adjustmentSaveRoute as Route, "PUT", `${MOD}/${listingId}/adjustment`, {
    body,
    cookie: session.cookie,
    params: { listingId },
  });
}

async function decideNew(
  route: Route,
  endpoint: string,
  session: Session,
  listingId: string,
  body: Record<string, unknown>,
) {
  return api(route, "POST", `${MOD}/${listingId}/${endpoint}`, {
    body,
    cookie: session.cookie,
    params: { listingId },
  });
}

async function listingState(listingId: string) {
  const sql = getSql();
  const [row] = await sql<
    {
      status: string;
      revision: number;
      price_minor: string;
      mileage: number | null;
      description: string | null;
      published_at: Date | null;
      current_expires_at: Date | null;
      needs_remoderation: boolean;
    }[]
  >`select status, revision, price_minor::text as price_minor, mileage, description,
      published_at, current_expires_at, needs_remoderation
    from listings where id = ${listingId}`;
  const features = (
    await sql<{ feature_id: string }[]>`
      select feature_id from listing_features where listing_id = ${listingId} order by feature_id
    `
  ).map((f) => f.feature_id);
  const images = await sql<{ storage_path: string; sort_order: number; is_primary: boolean }[]>`
    select storage_path, sort_order, is_primary from listing_images
    where listing_id = ${listingId} order by sort_order
  `;
  const [{ n: periods }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_periods where listing_id = ${listingId}
  `;
  return { ...row, features, images, periods: Number(periods) };
}

async function applyOutboxEvents(listingId: string) {
  return getSql()<{ id: string; payload: Record<string, unknown> }[]>`
    select id, payload from outbox_events
    where aggregate_id = ${listingId} and event_type = 'MODERATION_ADJUSTMENT_APPLIED'
  `;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  seller = await newUser();
  mod1 = await newUser({ roles: ["MODERATOR"] });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  brand = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('O13CBrand', 'o13c-brand') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand}, ${carCat})`;
  model = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brand}, ${carCat}, 'O13CModel', 'o13c-model') returning id`)[0].id;
  city = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('O13CŞəhər', 'o13c-seher', 98) returning id`)[0].id;
  featA = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O13C_FEAT_A', 'O13C Avadanlıq A', 'SAFETY') returning id`)[0].id;
  featB = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O13C_FEAT_B', 'O13C Avadanlıq B', 'COMFORT') returning id`)[0].id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("NEW approval without adjustment — baseline unchanged", () => {
  it("activates identically and records no adjustment linkage", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(mod1, listing.id);
    const approve = await decideNew(approveRoute as Route, "approve", mod1, listing.id, {
      expected_revision: listing.revision,
    });
    expect(approve.status).toBe(200);
    const state = await listingState(listing.id);
    expect(state.status).toBe("ACTIVE");
    expect(state.periods).toBe(1);
    expect(state.price_minor).toBe("2500000");
    expect(state.images).toHaveLength(4);
    expect(state.needs_remoderation).toBe(false);
    const [review] = await getSql()<{ adjustment_id: string | null; adjustment_revision: number | null }[]>`
      select adjustment_id, adjustment_revision from moderation_reviews where listing_id = ${listing.id}
    `;
    expect(review.adjustment_id).toBeNull();
    expect(review.adjustment_revision).toBeNull();
    expect(await applyOutboxEvents(listing.id)).toHaveLength(0);
  });
});

describe("NEW adjusted approval", () => {
  it("applies scalars/equipment/image plan atomically through the unchanged activation lifecycle", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(mod1, listing.id);
    // moderator working copy: price/mileage/description, +featB, gallery
    // reordered (img1 first, primary), img3 removed
    const save = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: {
        price_minor: 2350000,
        mileage: 45500,
        description: "Moderator tərəfindən düzəldilmiş təsvir",
        feature_ids: [featA, featB],
      },
      image_plan: [
        { source_id: listing.imageIds[1], removed: false, is_primary: true },
        { source_id: listing.imageIds[0], removed: false, is_primary: false },
        { source_id: listing.imageIds[2], removed: false, is_primary: false },
        { source_id: listing.imageIds[3], removed: true, is_primary: false },
      ],
    });
    expect(save.status).toBe(200);
    const adjustmentId = (save.body.data?.adjustment as { id: string }).id;

    const approve = await decideNew(approveRoute as Route, "approve", mod1, listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
    });
    expect(approve.status).toBe(200);

    // final listing = moderator values, activated through the SAME flow
    const state = await listingState(listing.id);
    expect(state.status).toBe("ACTIVE");
    expect(state.price_minor).toBe("2350000");
    expect(state.mileage).toBe(45500);
    expect(state.description).toBe("Moderator tərəfindən düzəldilmiş təsvir");
    expect(state.features).toEqual([featA, featB].sort());
    expect(state.revision).toBe(listing.revision + 1);
    expect(state.periods).toBe(1);
    expect(state.published_at).not.toBeNull();
    expect(state.current_expires_at!.getTime()).toBeGreaterThan(Date.now());
    expect(state.needs_remoderation).toBe(false);
    // final gallery: plan order, one primary, removed image excluded
    expect(state.images.map((img) => img.storage_path)).toEqual([
      listing.imagePaths[1],
      listing.imagePaths[0],
      listing.imagePaths[2],
    ]);
    expect(state.images.map((img) => img.is_primary)).toEqual([true, false, false]);

    // adjustment terminal APPLIED; frozen seller evidence untouched
    const [adj] = await getSql()<
      { status: string; applied_at: Date | null; submitted_data: Record<string, unknown>; adjusted_data: Record<string, unknown> }[]
    >`select status, applied_at, submitted_data, adjusted_data from moderation_adjustments where id = ${adjustmentId}`;
    expect(adj.status).toBe("APPLIED");
    expect(adj.applied_at).not.toBeNull();
    expect(adj.submitted_data.price_minor).toBe(2500000);
    expect(adj.submitted_data.feature_ids).toEqual([featA]);
    expect(adj.adjusted_data.price_minor).toBe(2350000);

    // review references the EXACT adjustment version decided
    const [review] = await getSql()<
      { adjustment_id: string | null; adjustment_revision: number | null; listing_revision: number; decision: string }[]
    >`select adjustment_id, adjustment_revision, listing_revision, decision
      from moderation_reviews where listing_id = ${listing.id}`;
    expect(review).toEqual({
      adjustment_id: adjustmentId,
      adjustment_revision: 1,
      listing_revision: listing.revision,
      decision: "APPROVED",
    });

    // append-only apply event + ONE cleanup intake for the removed image
    const audits = await getSql()<{ action: string }[]>`
      select action from audit_logs
      where entity_id = ${listing.id} and action = 'MODERATION_ADJUSTMENT_APPLIED'
    `;
    expect(audits).toHaveLength(1);
    const outbox = await applyOutboxEvents(listing.id);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].payload.cleanup_candidate_paths).toBe(listing.imagePaths[3]);
    expect(outbox[0].payload.adjustment_id).toBe(adjustmentId);

    // public detail + seller read-back = adjusted version, no shadow state
    const pub = await publicDetail(listing.publicId);
    expect(pub.listing.priceMinor).toBe(2350000);
    expect(pub.listing.images).toHaveLength(3);
    const card = (await myListings(sellerAuth(), "all")).find((item) => item.id === listing.id)!;
    expect(card.priceMinor).toBe(2350000);

    // idempotent retry: identical decision returns the terminal state
    // without re-applying anything
    const retry = await decideNew(approveRoute as Route, "approve", mod1, listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
    });
    expect(retry.status).toBe(200);
    const after = await listingState(listing.id);
    expect(after.periods).toBe(1);
    expect(after.revision).toBe(listing.revision + 1);
    expect(after.images).toHaveLength(3);
    expect(await applyOutboxEvents(listing.id)).toHaveLength(1);

    // reference-safe cleanup (sealed O.13.2 retention rule): the
    // candidate reaches the worker after grace, but the removed
    // object is NOT deleted — the retained APPLIED adjustment's frozen
    // submitted_images snapshot still references its exact path; the
    // final approved gallery stays protected as before
    await getSql()`
      update outbox_events set created_at = now() - interval '2 hours'
      where aggregate_id = ${listing.id} and event_type = 'MODERATION_ADJUSTMENT_APPLIED'
    `;
    const summary = await runImageCleanup({ graceSeconds: 3600 });
    expect(summary.events).toBeGreaterThanOrEqual(1);
    expect(storage.has(BUCKET(), listing.imagePaths[3])).toBe(true); // history-protected
    expect(storage.has(BUCKET(), listing.imagePaths[0])).toBe(true);
    expect(storage.has(BUCKET(), listing.imagePaths[1])).toBe(true);
    expect(storage.has(BUCKET(), listing.imagePaths[2])).toBe(true);
    const [event] = await applyOutboxEvents(listing.id);
    const [{ status: eventStatus }] = await getSql()<{ status: string }[]>`
      select status from outbox_events where id = ${event.id}
    `;
    expect(eventStatus).toBe("PROCESSED"); // retained, not retried forever
  });

  it("Owner-UAT regression: a legacy submission without seller_name approves with an adjustment exactly like the plain path", async () => {
    // fails on 5221db3 with 400 LISTING_INCOMPLETE {missing: seller_name}
    const listing = await insertListing({ status: "PENDING_MODERATION", sellerName: null });
    await claim(mod1, listing.id);
    // full content-type matrix in one working copy: scalar + equipment + photo
    const save = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { price_minor: 2750000, feature_ids: [featA, featB] },
      image_plan: planFor(listing.imageIds, {
        0: { primary: false },
        1: { primary: true },
        3: { removed: true },
      }),
    });
    expect(save.status).toBe(200);
    const approve = await decideNew(approveRoute as Route, "approve", mod1, listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
    });
    expect(approve.status).toBe(200);
    const state = await listingState(listing.id);
    expect(state.status).toBe("ACTIVE");
    expect(state.price_minor).toBe("2750000");
    expect(state.features).toEqual([featA, featB].sort());
    expect(state.images).toHaveLength(3);
    // the field the seller never submitted stays absent — no invented content
    const [{ seller_name }] = await getSql()<{ seller_name: string | null }[]>`
      select seller_name from listings where id = ${listing.id}
    `;
    expect(seller_name).toBeNull();
  });

  it("still refuses an adjustment that DEGRADES submitted required content", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" }); // has seller_name
    await claim(mod1, listing.id);
    const save = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { seller_name: null },
      image_plan: planFor(listing.imageIds),
    });
    expect(save.status).toBe(200);
    const approve = await decideNew(approveRoute as Route, "approve", mod1, listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
    });
    expect(approve.status).toBe(400);
    expect(approve.body.error?.code).toBe("LISTING_INCOMPLETE");
    // refused approval leaves everything intact: still pending, OPEN
    const state = await listingState(listing.id);
    expect(state.status).toBe("PENDING_MODERATION");
    const [adj] = await getSql()<{ status: string }[]>`
      select status from moderation_adjustments where listing_id = ${listing.id}
    `;
    expect(adj.status).toBe("OPEN");
  });

  it("blocks stale/mismatched adjustment views and lost claims with typed conflicts", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(mod1, listing.id);
    await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { price_minor: 2400000 },
      image_plan: planFor(listing.imageIds),
    });
    // a newer save bumps the adjustment counter …
    await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: 1,
      content: { price_minor: 2450000 },
      image_plan: planFor(listing.imageIds),
    });
    // … so an approval of the OLD view is refused
    const stale = await decideNew(approveRoute as Route, "approve", mod1, listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("MODERATION_ADJUSTMENT_CONFLICT");
    // deciding as if NO adjustment existed is equally refused
    const blind = await decideNew(approveRoute as Route, "approve", mod1, listing.id, {
      expected_revision: listing.revision,
    });
    expect(blind.status).toBe(409);
    expect(blind.body.error?.code).toBe("MODERATION_ADJUSTMENT_CONFLICT");
    // seller pass changed underneath → typed stale-subject conflict
    await getSql()`update listings set revision = revision + 1 where id = ${listing.id}`;
    const changed = await decideNew(approveRoute as Route, "approve", mod1, listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 2,
    });
    expect(changed.status).toBe(409);
    expect(changed.body.error?.code).toBe("LISTING_REVISION_CONFLICT");
    await getSql()`update listings set revision = revision - 1 where id = ${listing.id}`;
    // lost claim
    await getSql()`
      update moderation_claims set claimed_at = now() - interval '10 minutes',
        expires_at = now() - interval '1 minute'
      where listing_id = ${listing.id} and released_at is null
    `;
    const unclaimed = await decideNew(approveRoute as Route, "approve", mod1, listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 2,
    });
    expect(unclaimed.status).toBe(409);
    expect(unclaimed.body.error?.code).toBe("MODERATION_CLAIM_REQUIRED");
    // nothing applied by any refusal
    const state = await listingState(listing.id);
    expect(state.status).toBe("PENDING_MODERATION");
    expect(state.price_minor).toBe("2500000");
  });

  it("concurrent identical approvals execute the application exactly once", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(mod1, listing.id);
    await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { price_minor: 2390000 },
      image_plan: planFor(listing.imageIds),
    });
    const body = { expected_revision: listing.revision, expected_adjustment_revision: 1 };
    const [a, b] = await Promise.all([
      decideNew(approveRoute as Route, "approve", mod1, listing.id, body),
      decideNew(approveRoute as Route, "approve", mod1, listing.id, body),
    ]);
    // the loser serializes behind the row lock and lands on the
    // idempotent-retry path (or a typed conflict) — never a second apply
    expect([a.status, b.status]).toContain(200);
    const state = await listingState(listing.id);
    expect(state.status).toBe("ACTIVE");
    expect(state.periods).toBe(1);
    expect(state.price_minor).toBe("2390000");
    expect(state.revision).toBe(listing.revision + 1);
    expect(await applyOutboxEvents(listing.id)).toHaveLength(1);
  });
});

describe("NEW correction / reject with adjustment — nothing applied, terminal discard", () => {
  it("correction keeps seller content, discards the adjustment, and the next pass starts clean", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(mod1, listing.id);
    const save = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { price_minor: 2300000, feature_ids: [featA, featB] },
      image_plan: planFor(listing.imageIds, { 3: { removed: true } }),
    });
    const adjustmentId = (save.body.data?.adjustment as { id: string }).id;

    const correction = await decideNew(correctionRoute as Route, "request-correction", mod1, listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
      reason_code: "INVALID_PHOTOS",
      note: "Şəkilləri yeniləyin.",
    });
    expect(correction.status).toBe(200);

    // seller content byte-identical; nothing from adjusted_data leaked
    const state = await listingState(listing.id);
    expect(state.status).toBe("CORRECTION_REQUIRED");
    expect(state.price_minor).toBe("2500000");
    expect(state.features).toEqual([featA]);
    expect(state.images).toHaveLength(4);
    expect(state.periods).toBe(0);

    // adjustment terminal DISCARDED, retained, linked on the review
    const [adj] = await getSql()<{ status: string; discarded_at: Date | null }[]>`
      select status, discarded_at from moderation_adjustments where id = ${adjustmentId}
    `;
    expect(adj.status).toBe("DISCARDED");
    expect(adj.discarded_at).not.toBeNull();
    const [review] = await getSql()<{ adjustment_id: string | null; adjustment_revision: number | null }[]>`
      select adjustment_id, adjustment_revision from moderation_reviews
      where listing_id = ${listing.id} and decision = 'CORRECTION_REQUESTED'
    `;
    expect(review).toEqual({ adjustment_id: adjustmentId, adjustment_revision: 1 });
    // NO cleanup intake from a correction
    expect(await applyOutboxEvents(listing.id)).toHaveLength(0);

    // seller resubmits (same pass semantics as the real resubmit
    // transition) → a NEW clean adjustment pass, no re-attachment
    await getSql()`
      update listings set status = 'PENDING_MODERATION', submitted_at = now()
      where id = ${listing.id}
    `;
    await claim(mod1, listing.id);
    const clean = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { price_minor: 2460000 },
      image_plan: planFor(listing.imageIds),
    });
    expect(clean.status).toBe(200);
    const fresh = clean.body.data?.adjustment as { id: string; revision: number };
    expect(fresh.id).not.toBe(adjustmentId);
    expect(fresh.revision).toBe(1);
  });

  it("reject keeps seller content and discards the adjustment through the unchanged reject lifecycle", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(mod1, listing.id);
    const save = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { price_minor: 2200000 },
      image_plan: planFor(listing.imageIds),
    });
    const adjustmentId = (save.body.data?.adjustment as { id: string }).id;
    const reject = await decideNew(rejectRoute as Route, "reject", mod1, listing.id, {
      expected_revision: listing.revision,
      expected_adjustment_revision: 1,
      reason_code: "PROHIBITED_ITEM",
    });
    expect(reject.status).toBe(200);
    const state = await listingState(listing.id);
    expect(state.status).toBe("REJECTED");
    expect(state.price_minor).toBe("2500000");
    expect(state.periods).toBe(0);
    const [adj] = await getSql()<{ status: string }[]>`
      select status from moderation_adjustments where id = ${adjustmentId}
    `;
    expect(adj.status).toBe("DISCARDED");
    expect(await applyOutboxEvents(listing.id)).toHaveLength(0);
  });
});

describe("EDIT decisions over an OPEN adjustment must name the adjustment version", () => {
  it("every blind EDIT decision over an OPEN adjustment is a typed refusal", async () => {
    const listing = await insertListing({ status: "ACTIVE" });
    // real seller edit → PENDING revision
    const create = await api(editCreateRoute as Route, "POST", `${SELLER_BASE}/${listing.id}/edit-revision`, {
      cookie: seller.cookie,
      params: { listingId: listing.id },
    });
    let no = (create.body.data?.listing as { revision: number }).revision;
    const patch = await api(editPatchRoute as Route, "PATCH", `${SELLER_BASE}/${listing.id}/edit-revision`, {
      body: { expected_revision: no, price_minor: 2600000 },
      cookie: seller.cookie,
      params: { listingId: listing.id },
    });
    no = (patch.body.data?.listing as { revision: number }).revision;
    const submit = await api(editSubmitRoute as Route, "POST", `${SELLER_BASE}/${listing.id}/edit-revision/submit`, {
      body: { expected_revision: no },
      cookie: seller.cookie,
      params: { listingId: listing.id },
    });
    expect(submit.status).toBe(200);
    const revisionId = submit.body.data?.editRevisionId as string;
    const revisionNo = submit.body.data?.editRevision as number;

    await claim(mod1, listing.id);
    const staged = await getSql()<{ id: string }[]>`
      select id from listing_edit_images where edit_revision_id = ${revisionId} order by sort_order
    `;
    const save = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      edit_revision_id: revisionId,
      expected_edit_revision: revisionNo,
      expected_adjustment_revision: null,
      content: { price_minor: 2550000 },
      image_plan: planFor(staged.map((row) => row.id)),
    });
    expect(save.status).toBe(200);

    for (const [route, endpoint, body] of [
      [editApproveRoute, "edit/approve", { expected_edit_revision: revisionNo }],
      [editCorrectionRoute, "edit/request-correction", { expected_edit_revision: revisionNo, reason_code: "INVALID_PHOTOS", note: "n" }],
      [editRejectRoute, "edit/reject", { expected_edit_revision: revisionNo, reason_code: "MISLEADING_INFO", note: "n" }],
    ] as const) {
      const r = await api(route as Route, "POST", `${MOD}/${listing.id}/${endpoint}`, {
        body,
        cookie: mod1.cookie,
        params: { listingId: listing.id },
      });
      expect(r.status).toBe(409);
      expect(r.body.error?.code).toBe("MODERATION_ADJUSTMENT_CONFLICT");
    }
  });
});
