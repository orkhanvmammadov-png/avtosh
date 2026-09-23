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
import { createTestUserSession } from "./helpers/session";
import { api, type Route } from "./helpers/listing";
import {
  PATCH as editPatchRoute,
  POST as editCreateRoute,
} from "@/app/api/v1/me/listings/[listingId]/edit-revision/route";
import { POST as editSubmitRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/submit/route";
import { GET as detailRoute } from "@/app/api/v1/moderator/listings/[listingId]/route";
import { POST as claimRoute } from "@/app/api/v1/moderator/listings/[listingId]/claim/route";
import { POST as approveRoute } from "@/app/api/v1/moderator/listings/[listingId]/approve/route";
import { POST as rejectRoute } from "@/app/api/v1/moderator/listings/[listingId]/reject/route";
import { POST as editApproveRoute } from "@/app/api/v1/moderator/listings/[listingId]/edit/approve/route";
import {
  PUT as adjustmentSaveRoute,
} from "@/app/api/v1/moderator/listings/[listingId]/adjustment/route";
import {
  POST as adjustmentDiscardRoute,
} from "@/app/api/v1/moderator/listings/[listingId]/adjustment/discard/route";

/**
 * O.13 Stage B — moderator adjustment foundation. RELEASE-BLOCKING
 * invariants under test: seller submission frozen at FIRST save (NEW
 * and EDIT alike); moderator saves never mutate seller artifacts; the
 * adjustment has its own optimistic counter; claim ownership gates
 * every write; takeover preserves authorship (append-only audit);
 * discard is terminal-retained; decisions are refused while an OPEN
 * adjustment exists; nothing public/lifecycle changes.
 */

const SELLER_BASE = "http://localhost/api/v1/me/listings";
const MOD = "http://localhost/api/v1/moderator/listings";
const CONTACT = "+994701119999";

let storage: MemoryStorageProvider;
let carCat: string;
let brand: string;
let model: string;
let otherBrand: string;
let otherBrandModel: string;
let city: string;
let featA: string;
let featB: string;
let phoneCounter = 6_500_000;
type Session = { userId: string; cookie: string };
let seller: Session;
let mod1: Session;
let mod2: Session;

async function newUser(opts: { blocked?: boolean; roles?: string[]; name?: string } = {}): Promise<Session> {
  phoneCounter += 1;
  const session = await createTestUserSession(`+99451${phoneCounter}`, opts);
  if (opts.name !== undefined) {
    await getSql()`update users set display_name = ${opts.name} where id = ${session.userId}`;
  }
  return session;
}

async function insertListing(spec: {
  status: "PENDING_MODERATION" | "ACTIVE";
  features?: string[];
  images?: number;
}): Promise<{ id: string; publicId: number; revision: number; imageIds: string[] }> {
  const sql = getSql();
  const active = spec.status === "ACTIVE";
  const [row] = await sql<{ id: string; public_id: string; revision: number }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor,
      mileage, credit_available, barter_available, description, contact_phone_e164, seller_name,
      status, submitted_at, published_at, current_expires_at)
    values (${seller.userId}, ${carCat}, ${brand}, ${model}, ${city}, 2021, 2500000,
      50000, false, false, 'O13B satıcı təsviri', ${CONTACT}, 'O13B Satıcı',
      ${spec.status}::listing_status, now() - interval '2 days',
      ${active ? sql`now() - interval '1 day'` : null},
      ${active ? sql`now() + interval '20 days'` : null})
    returning id, public_id::text as public_id, revision
  `;
  const imageIds: string[] = [];
  for (let i = 0; i < (spec.images ?? 3); i += 1) {
    const path = `listings/${randomUUID()}.webp`;
    storage.objects.set(`${listingImageConfig().imagesBucket}/${path}`, {
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
  for (const f of spec.features ?? [featA]) {
    await sql`insert into listing_features (listing_id, feature_id) values (${row.id}, ${f})`;
  }
  return { id: row.id, publicId: Number(row.public_id), revision: row.revision, imageIds };
}

const eb = (id: string): string => `${SELLER_BASE}/${id}/edit-revision`;

async function submitEdit(
  listingId: string,
  changes: Record<string, unknown>,
): Promise<{ revisionId: string; revisionNo: number }> {
  const create = await api(editCreateRoute as Route, "POST", eb(listingId), {
    cookie: seller.cookie,
    params: { listingId },
  });
  expect(create.status).toBe(200);
  let no = (create.body.data?.listing as { revision: number }).revision;
  const patch = await api(editPatchRoute as Route, "PATCH", eb(listingId), {
    body: { expected_revision: no, ...changes },
    cookie: seller.cookie,
    params: { listingId },
  });
  expect(patch.status).toBe(200);
  no = (patch.body.data?.listing as { revision: number }).revision;
  const submit = await api(editSubmitRoute as Route, "POST", `${eb(listingId)}/submit`, {
    body: { expected_revision: no },
    cookie: seller.cookie,
    params: { listingId },
  });
  expect(submit.status).toBe(200);
  return {
    revisionId: submit.body.data?.editRevisionId as string,
    revisionNo: submit.body.data?.editRevision as number,
  };
}

async function claim(session: Session, listingId: string) {
  return api(claimRoute as Route, "POST", `${MOD}/${listingId}/claim`, {
    cookie: session.cookie,
    params: { listingId },
  });
}

async function expireClaim(listingId: string): Promise<void> {
  // deterministic expiry (no sleeps); claimed_at moves too because the
  // schema enforces expires_at > claimed_at
  await getSql()`
    update moderation_claims
    set claimed_at = now() - interval '10 minutes',
        expires_at = now() - interval '1 minute'
    where listing_id = ${listingId} and released_at is null
  `;
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

async function saveAdjustment(
  session: Session,
  listingId: string,
  body: Record<string, unknown>,
  origin?: string,
) {
  return api(adjustmentSaveRoute as Route, "PUT", `${MOD}/${listingId}/adjustment`, {
    body,
    cookie: session.cookie,
    params: { listingId },
    ...(origin !== undefined ? { origin } : {}),
  });
}

async function discardAdjustment(session: Session, listingId: string, expectedRevision: number) {
  return api(adjustmentDiscardRoute as Route, "POST", `${MOD}/${listingId}/adjustment/discard`, {
    body: { expected_adjustment_revision: expectedRevision },
    cookie: session.cookie,
    params: { listingId },
  });
}

async function detail(session: Session, listingId: string): Promise<Record<string, unknown>> {
  const r = await api(detailRoute as Route, "GET", `${MOD}/${listingId}`, {
    cookie: session.cookie,
    params: { listingId },
  });
  expect(r.status).toBe(200);
  return r.body.data?.listing as Record<string, unknown>;
}

/** Full seller-artifact fingerprint — MUST be byte-identical across
    moderator working saves. */
async function sellerArtifacts(listingId: string): Promise<string> {
  const sql = getSql();
  const [listing] = await sql`
    select category_id, brand_id, model_id, year, price_minor, mileage, engine_cc,
           fuel_type_id, transmission_id, body_type_id, drive_type_id, motorcycle_type_id,
           color_id, city_id, credit_available, barter_available, no_accident, not_repainted,
           description, contact_phone_e164, seller_name, status, revision,
           published_at, current_expires_at
    from listings where id = ${listingId}
  `;
  const features = await sql`
    select feature_id from listing_features where listing_id = ${listingId} order by feature_id
  `;
  const images = await sql`
    select storage_path, sort_order, is_primary from listing_images
    where listing_id = ${listingId} order by sort_order
  `;
  const revisions = await sql`
    select id, status, data, revision from listing_edit_revisions
    where listing_id = ${listingId} order by created_at
  `;
  const stagedImages = await sql`
    select edit_revision_id, storage_path, sort_order, is_primary from listing_edit_images
    where edit_revision_id in (select id from listing_edit_revisions where listing_id = ${listingId})
    order by edit_revision_id, sort_order
  `;
  return JSON.stringify({ listing, features, images, revisions, stagedImages });
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  seller = await newUser();
  mod1 = await newUser({ roles: ["MODERATOR"], name: "Aygün" });
  mod2 = await newUser({ roles: ["MODERATOR"], name: "Rauf" });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  brand = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('O13BBrand', 'o13b-brand') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand}, ${carCat})`;
  model = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brand}, ${carCat}, 'O13BModel', 'o13b-model') returning id`)[0].id;
  otherBrand = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('O13BOther', 'o13b-other') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${otherBrand}, ${carCat})`;
  otherBrandModel = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${otherBrand}, ${carCat}, 'O13BOtherModel', 'o13b-other-model') returning id`)[0].id;
  city = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('O13BŞəhər', 'o13b-seher', 97) returning id`)[0].id;
  featA = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O13B_FEAT_A', 'O13B Avadanlıq A', 'SAFETY') returning id`)[0].id;
  featB = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O13B_FEAT_B', 'O13B Avadanlıq B', 'COMFORT') returning id`)[0].id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("NEW first save — frozen snapshot, no seller-artifact mutation", () => {
  it("freezes submitted_data/images, stores the working copy, and leaves every seller artifact untouched", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    expect((await claim(mod1, listing.id)).status).toBe(200);
    const before = await sellerArtifacts(listing.id);

    const save = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: {
        price_minor: 2350000,
        mileage: 45500,
        description: "Moderator tərəfindən düzəldilmiş təsvir",
        feature_ids: [featA, featB],
      },
      image_plan: planFor(listing.imageIds, { 0: { primary: false }, 1: { primary: true } }),
    });
    expect(save.status).toBe(200);
    const result = save.body.data?.adjustment as { id: string; revision: number; changedFields: string[] };
    expect(result.revision).toBe(1);
    expect(result.changedFields).toEqual([
      "description",
      "feature_ids",
      "mileage",
      "price_minor",
      "image_plan",
    ]);

    // seller artifacts byte-identical
    expect(await sellerArtifacts(listing.id)).toBe(before);

    // frozen evidence in the adjustment row
    const sql = getSql();
    const [row] = await sql<
      { submitted_data: Record<string, unknown>; adjusted_data: Record<string, unknown>; submitted_images: unknown[]; moderator_id: string }[]
    >`select submitted_data, adjusted_data, submitted_images, moderator_id from moderation_adjustments where id = ${result.id}`;
    expect(row.submitted_data.price_minor).toBe(2500000);
    expect(row.submitted_data.feature_ids).toEqual([featA]);
    expect(row.adjusted_data.price_minor).toBe(2350000);
    expect(row.adjusted_data.feature_ids).toEqual([featA, featB]);
    expect(row.submitted_images).toHaveLength(3);
    expect(row.moderator_id).toBe(mod1.userId);

    // detail exposes the OPEN adjustment with the server-resolved summary
    const d = await detail(mod1, listing.id);
    const adjustment = d.adjustment as {
      revision: number;
      savedBy: { id: string };
      changes: { field: string; submittedValue: string | null; adjustedValue: string | null }[];
      descriptionChange: { submitted: string | null; adjusted: string | null } | null;
      equipmentAdded: string[];
      photoSummary: { primaryChanged: boolean };
    };
    expect(adjustment.revision).toBe(1);
    expect(adjustment.savedBy.id).toBe(mod1.userId);
    // human-readable grouped values via the shared AVTOSH formatters —
    // and description is NEVER a scalar row (dedicated before/after)
    expect(adjustment.changes).toEqual([
      { field: "price", submittedValue: "25 000 AZN", adjustedValue: "23 500 AZN" },
      { field: "mileage", submittedValue: "50 000 km", adjustedValue: "45 500 km" },
    ]);
    expect(adjustment.descriptionChange).toEqual({
      submitted: "O13B satıcı təsviri",
      adjusted: "Moderator tərəfindən düzəldilmiş təsvir",
    });
    expect(adjustment.equipmentAdded).toEqual(["O13B Avadanlıq B"]);
    expect(adjustment.photoSummary.primaryChanged).toBe(true);

    // Stage C decision safety: a decision that does not name the saved
    // adjustment version can never silently run over the submission
    const approve = await api(approveRoute as Route, "POST", `${MOD}/${listing.id}/approve`, {
      body: { expected_revision: listing.revision },
      cookie: mod1.cookie,
      params: { listingId: listing.id },
    });
    expect(approve.status).toBe(409);
    expect(approve.body.error?.code).toBe("MODERATION_ADJUSTMENT_CONFLICT");
    const reject = await api(rejectRoute as Route, "POST", `${MOD}/${listing.id}/reject`, {
      body: { expected_revision: listing.revision, reason_code: "MISLEADING_INFO" },
      cookie: mod1.cookie,
      params: { listingId: listing.id },
    });
    expect(reject.status).toBe(409);
    expect(reject.body.error?.code).toBe("MODERATION_ADJUSTMENT_CONFLICT");
  });

  it("update saves bump ONLY the adjustment's own counter; stale counters and stale subjects are typed conflicts", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(mod1, listing.id);
    const first = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { mileage: 60000 },
      image_plan: planFor(listing.imageIds),
    });
    expect(first.status).toBe(200);

    const second = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: 1,
      content: { mileage: 61000 },
      image_plan: planFor(listing.imageIds),
    });
    expect(second.status).toBe(200);
    expect((second.body.data?.adjustment as { revision: number }).revision).toBe(2);

    // listings.revision untouched by both saves
    const sql = getSql();
    expect(
      (await sql<{ revision: number }[]>`select revision from listings where id = ${listing.id}`)[0].revision,
    ).toBe(listing.revision);

    // stale adjustment counter
    const stale = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: 1,
      content: { mileage: 62000 },
      image_plan: planFor(listing.imageIds),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("MODERATION_ADJUSTMENT_CONFLICT");

    // stale SUBJECT (seller pass changed underneath)
    await sql`update listings set revision = revision + 1 where id = ${listing.id}`;
    const staleSubject = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: 2,
      content: { mileage: 63000 },
      image_plan: planFor(listing.imageIds),
    });
    expect(staleSubject.status).toBe(409);
    expect(staleSubject.body.error?.code).toBe("MODERATION_SUBJECT_CHANGED");
  });

  it("runs the SAME seller validation pipeline — invalid combinations and injected image identities never persist", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    const foreign = await insertListing({ status: "PENDING_MODERATION" });
    await claim(mod1, listing.id);
    const base = {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      image_plan: planFor(listing.imageIds),
    };
    // model of another brand
    const badModel = await saveAdjustment(mod1, listing.id, {
      ...base,
      content: { model_id: otherBrandModel },
    });
    expect(badModel.status).toBe(400);
    expect(badModel.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
    // invalid phone
    const badPhone = await saveAdjustment(mod1, listing.id, {
      ...base,
      content: { contact_phone: "12345" },
    });
    expect(badPhone.status).toBe(400);
    // lifecycle/admin keys cannot even parse (strict schema)
    const badKey = await saveAdjustment(mod1, listing.id, {
      ...base,
      content: { price_minor: 100, status: "ACTIVE" },
    });
    expect(badKey.status).toBe(400);
    expect(badKey.body.error?.code).toBe("VALIDATION_ERROR");
    // foreign-listing image injection
    const injected = await saveAdjustment(mod1, listing.id, {
      ...base,
      content: {},
      image_plan: planFor([...listing.imageIds.slice(0, 2), foreign.imageIds[0]]),
    });
    expect(injected.status).toBe(400);
    // below-min kept images
    const belowMin = await saveAdjustment(mod1, listing.id, {
      ...base,
      content: {},
      image_plan: planFor(listing.imageIds, { 1: { removed: true }, 2: { removed: true } }),
    });
    expect(belowMin.status).toBe(400);
    expect(belowMin.body.error?.code).toBe("LISTING_INSUFFICIENT_IMAGES");
    // nothing persisted by any refused save
    expect(await getSql()`select id from moderation_adjustments where listing_id = ${listing.id}`).toHaveLength(0);
  });
});

describe("claim ownership + takeover lineage", () => {
  it("save requires a LIVE owned claim; expiry and rival ownership are typed refusals", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    const body = {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { mileage: 51000 },
      image_plan: planFor(listing.imageIds),
    };
    // no claim at all
    const unclaimed = await saveAdjustment(mod1, listing.id, body);
    expect(unclaimed.status).toBe(409);
    expect(unclaimed.body.error?.code).toBe("MODERATION_CLAIM_REQUIRED");
    // expired claim
    await claim(mod1, listing.id);
    await expireClaim(listing.id);
    const expired = await saveAdjustment(mod1, listing.id, body);
    expect(expired.status).toBe(409);
    expect(expired.body.error?.code).toBe("MODERATION_CLAIM_REQUIRED");
    // rival's live claim
    await claim(mod2, listing.id);
    const rival = await saveAdjustment(mod1, listing.id, body);
    expect(rival.status).toBe(409);
    expect(rival.body.error?.code).toBe("MODERATION_CLAIMED_BY_OTHER");
  });

  it("takeover: B inherits A's OPEN adjustment with attribution, continues it, and the audit proves both actors", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(mod1, listing.id);
    const first = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { price_minor: 2400000 },
      image_plan: planFor(listing.imageIds),
    });
    expect(first.status).toBe(200);

    // deterministic claim expiry (no sleeps) → B claims
    await expireClaim(listing.id);
    expect((await claim(mod2, listing.id)).status).toBe(200);

    // B sees A's saved work with A's attribution
    const d = await detail(mod2, listing.id);
    const adjustment = d.adjustment as {
      revision: number;
      savedBy: { id: string; displayName: string | null };
      descriptionChange: unknown;
    };
    expect(adjustment.savedBy).toEqual({ id: mod1.userId, displayName: "Aygün" });
    // unchanged description never fabricates a false before/after diff
    expect(adjustment.descriptionChange).toBeNull();

    // B continues — current saved-state author becomes B, counter bumps
    const cont = await saveAdjustment(mod2, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: adjustment.revision,
      content: { price_minor: 2450000 },
      image_plan: planFor(listing.imageIds),
    });
    expect(cont.status).toBe(200);

    // A's stale save is refused (claim now owned by B)
    const staleA = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: adjustment.revision,
      content: { price_minor: 2300000 },
      image_plan: planFor(listing.imageIds),
    });
    expect(staleA.status).toBe(409);
    expect(staleA.body.error?.code).toBe("MODERATION_CLAIMED_BY_OTHER");

    // append-only lineage: one save event per actor, in order
    const events = await getSql()<{ actor_user_id: string }[]>`
      select actor_user_id from audit_logs
      where entity_id = ${listing.id} and action = 'MODERATION_ADJUSTMENT_SAVED'
      order by created_at
    `;
    expect(events.map((event) => event.actor_user_id)).toEqual([mod1.userId, mod2.userId]);
  });

  it("discard is terminal-retained, unlocks decisions, and a clean adjustment can start for the same pass", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    await claim(mod1, listing.id);
    await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { price_minor: 2600000 },
      image_plan: planFor(listing.imageIds),
    });
    const before = await sellerArtifacts(listing.id);

    // stale discard counter refused
    const stale = await discardAdjustment(mod1, listing.id, 5);
    expect(stale.status).toBe(409);

    const discard = await discardAdjustment(mod1, listing.id, 1);
    expect(discard.status).toBe(200);
    const discarded = discard.body.data?.adjustment as { id: string; status: string };
    expect(discarded.status).toBe("DISCARDED");

    // idempotent retry returns the same terminal state
    const retry = await discardAdjustment(mod1, listing.id, 1);
    expect(retry.status).toBe(200);
    expect((retry.body.data?.adjustment as { id: string }).id).toBe(discarded.id);

    // retained row + untouched seller artifacts + history event
    const sql = getSql();
    const [row] = await sql<{ status: string; discarded_at: Date | null }[]>`
      select status, discarded_at from moderation_adjustments where id = ${discarded.id}
    `;
    expect(row.status).toBe("DISCARDED");
    expect(row.discarded_at).not.toBeNull();
    expect(await sellerArtifacts(listing.id)).toBe(before);
    const d = await detail(mod1, listing.id);
    expect(d.adjustment).toBeNull();
    expect(
      (d.adjustmentEvents as { action: string }[]).map((event) => event.action),
    ).toContain("MODERATION_ADJUSTMENT_DISCARDED");

    // fresh first save creates a CLEAN OPEN adjustment
    const clean = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: { price_minor: 2700000 },
      image_plan: planFor(listing.imageIds),
    });
    expect(clean.status).toBe(200);
    expect((clean.body.data?.adjustment as { revision: number }).revision).toBe(1);
    // clean pass: discard it and prove decisions work again
    expect((await discardAdjustment(mod1, listing.id, 1)).status).toBe(200);
    const approve = await api(approveRoute as Route, "POST", `${MOD}/${listing.id}/approve`, {
      body: { expected_revision: listing.revision },
      cookie: mod1.cookie,
      params: { listingId: listing.id },
    });
    expect(approve.status).toBe(200);
  });
});

describe("LISTING_EDIT first save — frozen seller revision evidence", () => {
  it("freezes the pending revision (data + staged images) and never relies on later live reads", async () => {
    const listing = await insertListing({ status: "ACTIVE" });
    const edit = await submitEdit(listing.id, { price_minor: 2800000 });
    await claim(mod1, listing.id);
    const before = await sellerArtifacts(listing.id);

    const save = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      edit_revision_id: edit.revisionId,
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: null,
      content: { price_minor: 2750000 },
      image_plan: planFor(await stagedImageIds(edit.revisionId)),
    });
    expect(save.status).toBe(200);
    expect(await sellerArtifacts(listing.id)).toBe(before);

    const sql = getSql();
    const [row] = await sql<
      { submitted_data: Record<string, unknown>; edit_revision_id: string | null; submitted_edit_revision_no: number | null }[]
    >`select submitted_data, edit_revision_id, submitted_edit_revision_no
      from moderation_adjustments where listing_id = ${listing.id} and status = 'OPEN'`;
    expect(row.edit_revision_id).toBe(edit.revisionId);
    expect(row.submitted_edit_revision_no).toBe(edit.revisionNo);
    expect(row.submitted_data.price_minor).toBe(2800000);

    // later mutation of the live revision (correction-cycle semantics)
    // never rewrites the frozen evidence
    await sql`
      update listing_edit_revisions set data = data || '{"price_minor": 9999999}'::jsonb
      where id = ${edit.revisionId}
    `;
    const [after] = await sql<{ submitted_data: Record<string, unknown> }[]>`
      select submitted_data from moderation_adjustments where listing_id = ${listing.id} and status = 'OPEN'
    `;
    expect(after.submitted_data.price_minor).toBe(2800000);

    // Stage D semantics: a decision that does not name the saved
    // adjustment version can never silently run over the proposal
    const approve = await api(editApproveRoute as Route, "POST", `${MOD}/${listing.id}/edit/approve`, {
      body: { expected_edit_revision: edit.revisionNo },
      cookie: mod1.cookie,
      params: { listingId: listing.id },
    });
    expect(approve.status).toBe(409);
    expect(approve.body.error?.code).toBe("MODERATION_ADJUSTMENT_CONFLICT");

    // the approved public listing never moved
    const pub = await publicDetail(listing.publicId);
    expect(pub.listing.priceMinor).toBe(2500000);
    expect(JSON.stringify(pub)).not.toContain("adjust");
  });

  it("subject identity is exact: wrong revision id / stale counter are typed conflicts", async () => {
    const listing = await insertListing({ status: "ACTIVE" });
    const edit = await submitEdit(listing.id, { mileage: 52000 });
    await claim(mod1, listing.id);
    const staged = await stagedImageIds(edit.revisionId);

    const wrongId = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      edit_revision_id: randomUUID(),
      expected_edit_revision: edit.revisionNo,
      expected_adjustment_revision: null,
      content: { mileage: 53000 },
      image_plan: planFor(staged),
    });
    expect(wrongId.status).toBe(409);
    expect(wrongId.body.error?.code).toBe("MODERATION_SUBJECT_CHANGED");

    const staleNo = await saveAdjustment(mod1, listing.id, {
      expected_listing_revision: listing.revision,
      edit_revision_id: edit.revisionId,
      expected_edit_revision: edit.revisionNo + 1,
      expected_adjustment_revision: null,
      content: { mileage: 53000 },
      image_plan: planFor(staged),
    });
    expect(staleNo.status).toBe(409);
    expect(staleNo.body.error?.code).toBe("MODERATION_SUBJECT_CHANGED");
  });
});

describe("security boundary", () => {
  it("USER and anonymous are denied; cross-origin writes are rejected", async () => {
    const listing = await insertListing({ status: "PENDING_MODERATION" });
    const user = await newUser();
    const body = {
      expected_listing_revision: listing.revision,
      expected_adjustment_revision: null,
      content: {},
      image_plan: planFor(listing.imageIds),
    };
    expect((await saveAdjustment(user, listing.id, body)).status).toBe(403);
    const anon = await api(adjustmentSaveRoute as Route, "PUT", `${MOD}/${listing.id}/adjustment`, {
      body,
      params: { listingId: listing.id },
    });
    expect(anon.status).toBe(401);
    const crossOrigin = await saveAdjustment(mod1, listing.id, body, "https://evil.example");
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.body.error?.code).toBe("FORBIDDEN_ORIGIN");
    expect((await discardAdjustment(user, listing.id, 1)).status).toBe(403);
  });
});

async function stagedImageIds(revisionId: string): Promise<string[]> {
  const rows = await getSql()<{ id: string }[]>`
    select id from listing_edit_images where edit_revision_id = ${revisionId} order by sort_order
  `;
  return rows.map((row) => row.id);
}
