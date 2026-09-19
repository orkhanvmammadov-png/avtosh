import { randomUUID } from "node:crypto";
import sharp from "sharp";
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
import {
  GET as editViewRoute,
  PATCH as editPatchRoute,
  POST as editCreateRoute,
} from "@/app/api/v1/me/listings/[listingId]/edit-revision/route";
import { POST as editSubmitRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/submit/route";
import { POST as editCancelRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/cancel/route";
import { POST as editUploadUrlRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/images/upload-url/route";
import { POST as editConfirmRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/images/confirm/route";
import { DELETE as editDeleteImageRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/images/[imageId]/route";
import { PATCH as editReorderRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/images/order/route";
import { PATCH as editPrimaryRoute } from "@/app/api/v1/me/listings/[listingId]/edit-revision/images/[imageId]/primary/route";

/**
 * O.12 Stage C — revision-backed edit HTTP surface. RELEASE-BLOCKING
 * invariants proven here: the approved listing row, listing_images and
 * listing_features are never written by any edit operation; submit
 * consumes zero quota/fee/publication/period; deactivated and expired
 * listings stay hidden/expired through the whole cycle.
 */

const BASE = "http://localhost/api/v1/me/listings";

let storage: MemoryStorageProvider;
let seller: { userId: string; cookie: string };
let stranger: { userId: string; cookie: string };
let blocked: { userId: string; cookie: string };
let carCat: string;
let brand: string;
let model: string;
let city: string;
let carFeature: string;
let globalFeature: string;

interface Envelope {
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

type Route = (
  request: Request,
  context?: { params: Promise<Record<string, string>> },
) => Promise<Response>;

async function api(
  route: Route,
  method: string,
  url: string,
  options: { body?: unknown; cookie?: string; params?: Record<string, string> } = {},
): Promise<{ status: number; body: Envelope }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  const response = await route(
    new Request(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    options.params === undefined ? undefined : { params: Promise.resolve(options.params) },
  );
  return { status: response.status, body: (await response.json()) as Envelope };
}

const eb = (listingId: string): string => `${BASE}/${listingId}/edit-revision`;

async function makeJpeg(seed = 40): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: seed, g: 80, b: 120 } },
  })
    .jpeg()
    .toBuffer();
}

async function insertListing(spec: {
  status?: string;
  deactivated?: boolean;
  expiresOffsetMin?: number;
  owner?: string;
  features?: string[];
  images?: number;
}): Promise<{ id: string; publicId: number; revision: number; imagePaths: string[] }> {
  const sql = getSql();
  const [row] = await sql<{ id: string; public_id: string; revision: number }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor,
      mileage, credit_available, barter_available, description, contact_phone_e164, seller_name,
      status, submitted_at, published_at, current_expires_at, seller_deactivated_at)
    values (${spec.owner ?? seller.userId}, ${carCat}, ${brand}, ${model}, ${city}, 2021, 2000000,
      50000, false, false, 'O12C təsviri', '+994501234567', 'O12C Satıcı',
      ${spec.status ?? "ACTIVE"}::listing_status, now() - interval '4 days',
      now() - interval '3 days',
      now() + (${spec.expiresOffsetMin ?? 60 * 24 * 15} || ' minutes')::interval,
      ${spec.deactivated === true ? sql`now()` : null})
    returning id, public_id::text as public_id, revision
  `;
  const imagePaths: string[] = [];
  for (let i = 0; i < (spec.images ?? 3); i += 1) {
    const path = `listings/${randomUUID()}.webp`;
    imagePaths.push(path);
    storage.objects.set(`${listingImageConfig().imagesBucket}/${path}`, {
      data: Buffer.from("approved"),
      contentType: "image/webp",
    });
    await sql`
      insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
      values (${row.id}, ${path}, ${i}, ${i === 0}, 'image/webp', 1000, 1600, 900)
    `;
  }
  for (const f of spec.features ?? []) {
    await sql`insert into listing_features (listing_id, feature_id) values (${row.id}, ${f})`;
  }
  return { id: row.id, publicId: Number(row.public_id), revision: row.revision, imagePaths };
}

async function createRevision(listingId: string): Promise<{ listing: Record<string, unknown>; context: Record<string, unknown> }> {
  const r = await api(editCreateRoute, "POST", eb(listingId), {
    cookie: seller.cookie,
    params: { listingId },
  });
  expect(r.status).toBe(200);
  return r.body.data as { listing: Record<string, unknown>; context: Record<string, unknown> };
}

async function patchRevision(
  listingId: string,
  expected: number,
  fields: Record<string, unknown>,
  cookie = seller.cookie,
): Promise<{ status: number; body: Envelope }> {
  return api(editPatchRoute, "PATCH", eb(listingId), {
    body: { expected_revision: expected, ...fields },
    cookie,
    params: { listingId },
  });
}

async function approvedSnapshot(listingId: string): Promise<{
  price: string;
  description: string | null;
  imageCount: number;
  featureCount: number;
  status: string;
}> {
  const sql = getSql();
  const [row] = await sql<
    { price_minor: string; description: string | null; status: string }[]
  >`select price_minor::text as price_minor, description, status from listings where id = ${listingId}`;
  const [{ n: images }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_images where listing_id = ${listingId}`;
  const [{ n: features }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_features where listing_id = ${listingId}`;
  return {
    price: row.price_minor,
    description: row.description,
    imageCount: Number(images),
    featureCount: Number(features),
    status: row.status,
  };
}

async function commerceCounts(userId: string): Promise<{ publications: number; payments: number; periods: number }> {
  const sql = getSql();
  const [{ n: pubs }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_publications where user_id = ${userId}`;
  const [{ n: pays }] = await sql<{ n: string }[]>`
    select count(*)::text as n from payments where user_id = ${userId}`;
  const [{ n: periods }] = await sql<{ n: string }[]>`
    select count(*)::text as n from listing_periods lp
    join listings l on l.id = lp.listing_id where l.owner_id = ${userId}`;
  return { publications: Number(pubs), payments: Number(pays), periods: Number(periods) };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("run via pnpm test:integration:db");
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);
  const sql = getSql();
  seller = await createTestUserSession("+994528000001");
  stranger = await createTestUserSession("+994528000002");
  blocked = await createTestUserSession("+994528000003", { blocked: true });
  carCat = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  brand = (await sql<{ id: string }[]>`insert into brands (name, slug) values ('O12CBrand', 'o12c-brand') returning id`)[0].id;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand}, ${carCat})`;
  model = (await sql<{ id: string }[]>`insert into models (brand_id, category_id, name, slug) values (${brand}, ${carCat}, 'O12CModel', 'o12c-model') returning id`)[0].id;
  city = (await sql<{ id: string }[]>`insert into cities (name_az, slug, sort_order) values ('O12CŞəhər', 'o12c-seher', 98) returning id`)[0].id;
  carFeature = (await sql<{ id: string }[]>`insert into features (code, name_az, category_id, group_code) values ('O12C_CAR_FEAT', 'O12C Car', ${carCat}, 'COMFORT') returning id`)[0].id;
  globalFeature = (await sql<{ id: string }[]>`insert into features (code, name_az, group_code) values ('O12C_GLOBAL_FEAT', 'O12C Global', 'SAFETY') returning id`)[0].id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("create-or-get edit revision (POST/GET /edit-revision)", () => {
  it("snapshots approved content; concurrent creates converge; GET never creates", async () => {
    const fixture = await insertListing({ features: [carFeature, globalFeature] });

    // GET before any revision exists: typed conflict, nothing created
    const empty = await api(editViewRoute, "GET", eb(fixture.id), {
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(empty.status).toBe(409);
    expect(empty.body.error?.code).toBe("LISTING_LIFECYCLE_CONFLICT");

    const view = await createRevision(fixture.id);
    const listing = view.listing as {
      revision: number;
      priceMinor: number;
      featureIds: string[];
      images: { id: string; isPrimary: boolean }[];
      premiumIntentPackageId: string | null;
    };
    expect(view.context).toMatchObject({ editStatus: "EDIT_DRAFT", listingStatus: "ACTIVE" });
    expect(listing.revision).toBe(1);
    expect(listing.priceMinor).toBe(2000000);
    expect([...listing.featureIds].sort()).toEqual([carFeature, globalFeature].sort());
    expect(listing.images).toHaveLength(3);
    expect(listing.images.filter((i) => i.isPrimary)).toHaveLength(1);
    expect(listing.premiumIntentPackageId).toBeNull(); // sealed out

    // repeat POST converges on the same open revision
    const again = await createRevision(fixture.id);
    expect((again.context as { editRevisionId: string }).editRevisionId).toBe(
      (view.context as { editRevisionId: string }).editRevisionId,
    );

    // truly concurrent creates: one revision row wins
    const fresh = await insertListing({});
    const results = await Promise.all([
      api(editCreateRoute, "POST", eb(fresh.id), { cookie: seller.cookie, params: { listingId: fresh.id } }),
      api(editCreateRoute, "POST", eb(fresh.id), { cookie: seller.cookie, params: { listingId: fresh.id } }),
    ]);
    const ids = results.map(
      (r) => ((r.body.data as { context: { editRevisionId: string } }).context).editRevisionId,
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(ids).size).toBe(1);
  });

  it("authorization: non-owner 404 anti-oracle, blocked 403, ineligible lifecycle 409", async () => {
    const fixture = await insertListing({});
    const foreign = await api(editCreateRoute, "POST", eb(fixture.id), {
      cookie: stranger.cookie,
      params: { listingId: fixture.id },
    });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error?.code).toBe("LISTING_NOT_FOUND");
    const blockedTry = await api(editCreateRoute, "POST", eb(fixture.id), {
      cookie: blocked.cookie,
      params: { listingId: fixture.id },
    });
    expect(blockedTry.status).toBe(403);
    expect(blockedTry.body.error?.code).toBe("USER_BLOCKED");
    const draft = await insertListing({ status: "DRAFT" });
    const ineligible = await api(editCreateRoute, "POST", eb(draft.id), {
      cookie: seller.cookie,
      params: { listingId: draft.id },
    });
    expect(ineligible.status).toBe(409);
    expect(ineligible.body.error?.code).toBe("LISTING_LIFECYCLE_CONFLICT");
    const sold = await insertListing({ status: "SOLD" });
    const soldTry = await api(editCreateRoute, "POST", eb(sold.id), {
      cookie: seller.cookie,
      params: { listingId: sold.id },
    });
    expect(soldTry.status).toBe(409);
  });
});

describe("revision PATCH (autosave)", () => {
  it("merges fields under the edit counter; the approved row never changes", async () => {
    const fixture = await insertListing({ features: [carFeature] });
    const before = await approvedSnapshot(fixture.id);
    await createRevision(fixture.id);

    const r1 = await patchRevision(fixture.id, 1, { price_minor: 2550000, description: "Yeni təsvir" });
    expect(r1.status).toBe(200);
    const l1 = (r1.body.data as { listing: { revision: number; priceMinor: number; description: string } }).listing;
    expect(l1.revision).toBe(2);
    expect(l1.priceMinor).toBe(2550000);
    expect(l1.description).toBe("Yeni təsvir");

    // stale expected → typed conflict with current counter
    const stale = await patchRevision(fixture.id, 1, { mileage: 60000 });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("LISTING_REVISION_CONFLICT");

    // catalog validation identical to the draft PATCH
    const badBrand = await patchRevision(fixture.id, 2, { brand_id: randomUUID() });
    expect(badBrand.status).toBe(400);
    expect(badBrand.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");

    // promotion intent is OUT of the edit field space entirely
    const promo = await patchRevision(fixture.id, 2, { premium_intent_package_id: null });
    expect(promo.status).toBe(400);
    expect(promo.body.error?.code).toBe("VALIDATION_ERROR");

    // blocked user cannot autosave
    const blockedTry = await patchRevision(fixture.id, 2, { mileage: 1 }, blocked.cookie);
    expect(blockedTry.status).toBe(403);

    // §36: the approved public row is byte-identical after all of it
    expect(await approvedSnapshot(fixture.id)).toEqual(before);
    const detail = await publicDetail(fixture.publicId);
    expect(detail.listing.status).toBe("ACTIVE");
    expect(detail.listing.priceMinor).toBe(2000000);
  });

  it("category change clears dependents and prunes incompatible features in data", async () => {
    const fixture = await insertListing({ features: [carFeature, globalFeature] });
    await createRevision(fixture.id);
    const r = await patchRevision(fixture.id, 1, { category: "MOTORCYCLE" });
    expect(r.status).toBe(200);
    const listing = (r.body.data as {
      listing: { category: string; brandId: string | null; modelId: string | null; featureIds: string[] };
    }).listing;
    expect(listing.category).toBe("MOTORCYCLE");
    expect(listing.brandId).toBeNull();
    expect(listing.modelId).toBeNull();
    // CAR-scoped feature pruned from the snapshot; global one survives
    expect(listing.featureIds).toEqual([globalFeature]);
    // approved listing_features untouched before approval
    const sql = getSql();
    const [{ n }] = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_features where listing_id = ${fixture.id}`;
    expect(Number(n)).toBe(2);
  });
});

describe("staged images", () => {
  it("upload/confirm stages only; delete removes the row, never the shared object", async () => {
    const fixture = await insertListing({});
    const view = await createRevision(fixture.id);
    const staged = (view.listing as { images: { id: string; isPrimary: boolean }[] }).images;
    const config = listingImageConfig();

    // add a revision-only image
    const auth = await api(editUploadUrlRoute, "POST", `${eb(fixture.id)}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 5000 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(auth.status).toBe(200);
    storage.uploadViaSignedUrl(auth.body.data?.upload_url as string, await makeJpeg(60), "image/jpeg");
    const confirm = await api(editConfirmRoute, "POST", `${eb(fixture.id)}/images/confirm`, {
      body: { upload_id: auth.body.data?.upload_id },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(confirm.status).toBe(201);
    const newImageId = (confirm.body.data?.image as { id: string }).id;

    // the approved gallery gained NOTHING
    expect((await approvedSnapshot(fixture.id)).imageCount).toBe(3);

    // remove an approved-snapshot image from the revision: row only —
    // the shared storage object must survive
    const removedId = staged[0].id;
    const del = await api(editDeleteImageRoute, "DELETE", `${eb(fixture.id)}/images/${removedId}`, {
      cookie: seller.cookie,
      params: { listingId: fixture.id, imageId: removedId },
    });
    expect(del.status).toBe(200);
    expect(storage.has(config.imagesBucket, fixture.imagePaths[0])).toBe(true);
    expect((await approvedSnapshot(fixture.id)).imageCount).toBe(3);
    // cleanup CANDIDATE emitted for the reference-checking worker
    const sql = getSql();
    const events = await sql<{ payload: { cleanup_candidate_paths?: string } }[]>`
      select payload from outbox_events
      where event_type = 'LISTING_EDIT_IMAGE_REMOVED' and aggregate_id = ${fixture.id}
    `;
    expect(events).toHaveLength(1);
    expect(events[0].payload.cleanup_candidate_paths).toBe(fixture.imagePaths[0]);

    // deleting the primary promoted a deterministic successor
    const after = await api(editViewRoute, "GET", eb(fixture.id), {
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    const images = (after.body.data as { listing: { images: { id: string; isPrimary: boolean }[] } }).listing.images;
    expect(images).toHaveLength(3); // 3 snapshot - 1 removed + 1 new
    expect(images.filter((i) => i.isPrimary)).toHaveLength(1);

    // reorder + explicit primary through the revision endpoints
    const reordered = [...images.map((i) => i.id)].reverse();
    const order = await api(editReorderRoute, "PATCH", `${eb(fixture.id)}/images/order`, {
      body: { image_ids: reordered },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(order.status).toBe(200);
    const primary = await api(editPrimaryRoute, "PATCH", `${eb(fixture.id)}/images/${newImageId}/primary`, {
      cookie: seller.cookie,
      params: { listingId: fixture.id, imageId: newImageId },
    });
    expect(primary.status).toBe(200);
    const final = await api(editViewRoute, "GET", eb(fixture.id), {
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    const finalImages = (final.body.data as { listing: { images: { id: string; isPrimary: boolean }[] } }).listing.images;
    expect(finalImages.map((i) => i.id)).toEqual(reordered);
    expect(finalImages.find((i) => i.isPrimary)?.id).toBe(newImageId);

    // the approved public gallery is still exactly the original rows
    const publicRows = await sql<{ storage_path: string; is_primary: boolean }[]>`
      select storage_path, is_primary from listing_images
      where listing_id = ${fixture.id} order by sort_order
    `;
    expect(publicRows.map((r) => r.storage_path)).toEqual(fixture.imagePaths);
    expect(publicRows[0].is_primary).toBe(true);
  });

  it("a PENDING revision rejects every image mutation", async () => {
    const fixture = await insertListing({});
    await createRevision(fixture.id);
    const submit = await api(editSubmitRoute, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: 1 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(submit.status).toBe(200);
    const upload = await api(editUploadUrlRoute, "POST", `${eb(fixture.id)}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 5000 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(upload.status).toBe(409);
    expect(upload.body.error?.code).toBe("LISTING_LIFECYCLE_CONFLICT");
    const patch = await patchRevision(fixture.id, 1, { mileage: 999 });
    expect(patch.status).toBe(409);
  });
});

describe("submit / resubmit", () => {
  it("validates completeness and image rules against the REVISION", async () => {
    const fixture = await insertListing({});
    await createRevision(fixture.id);
    const incomplete = await patchRevision(fixture.id, 1, { seller_name: null });
    expect(incomplete.status).toBe(200);
    const failed = await api(editSubmitRoute, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: 2 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(failed.status).toBe(400);
    expect(failed.body.error?.code).toBe("LISTING_INCOMPLETE");
    expect((failed.body.error as { details?: { missing: string[] } })?.details?.missing).toEqual(["seller_name"]);

    // restore the name, drop a staged image below the minimum
    await patchRevision(fixture.id, 2, { seller_name: "O12C Satıcı" });
    const view = await api(editViewRoute, "GET", eb(fixture.id), {
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    const images = (view.body.data as { listing: { revision: number; images: { id: string }[] } }).listing;
    await api(editDeleteImageRoute, "DELETE", `${eb(fixture.id)}/images/${images.images[0].id}`, {
      cookie: seller.cookie,
      params: { listingId: fixture.id, imageId: images.images[0].id },
    });
    const tooFew = await api(editSubmitRoute, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: images.revision + 1 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(tooFew.status).toBe(400);
    expect(tooFew.body.error?.code).toBe("LISTING_INSUFFICIENT_IMAGES");
  });

  it("submit freezes the revision, never the listing: zero quota/fee/period, public stays old", async () => {
    const fixture = await insertListing({ features: [carFeature] });
    const before = await approvedSnapshot(fixture.id);
    const commerceBefore = await commerceCounts(seller.userId);
    await createRevision(fixture.id);
    await patchRevision(fixture.id, 1, { price_minor: 3300000 });

    const submit = await api(editSubmitRoute, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: 2 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(submit.status).toBe(200);
    expect(submit.body.data).toMatchObject({
      editStatus: "PENDING_MODERATION",
      reactivationRequested: false,
    });

    // idempotent retry with the same expected revision
    const retry = await api(editSubmitRoute, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: 2 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(retry.status).toBe(200);
    expect(retry.body.data).toMatchObject({ editStatus: "PENDING_MODERATION" });

    const sql = getSql();
    const [rev] = await sql<{ status: string; submitted_at: Date | null }[]>`
      select status, submitted_at from listing_edit_revisions
      where id = ${(submit.body.data as { editRevisionId: string }).editRevisionId}
    `;
    expect(rev.status).toBe("PENDING_MODERATION");
    expect(rev.submitted_at).not.toBeNull();

    // §25/§51: edit is NEVER a new listing — nothing commercial moved
    expect(await commerceCounts(seller.userId)).toEqual(commerceBefore);
    // §39: listing stays ACTIVE with the OLD approved content public
    expect(await approvedSnapshot(fixture.id)).toEqual(before);
    const detail = await publicDetail(fixture.publicId);
    expect(detail.listing.status).toBe("ACTIVE");
    expect(detail.listing.priceMinor).toBe(2000000);
  });

  it("CORRECTION_REQUIRED resubmits the SAME revision", async () => {
    const fixture = await insertListing({});
    const view = await createRevision(fixture.id);
    const revisionId = (view.context as { editRevisionId: string }).editRevisionId;
    const sql = getSql();
    await sql`update listing_edit_revisions set status = 'CORRECTION_REQUIRED' where id = ${revisionId}`;

    // still editable in the same revision
    const patch = await patchRevision(fixture.id, 1, { description: "Düzəldilmiş təsvir" });
    expect(patch.status).toBe(200);
    const resubmit = await api(editSubmitRoute, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: 2 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data).toMatchObject({
      editRevisionId: revisionId,
      editStatus: "PENDING_MODERATION",
    });
    const [{ n }] = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_edit_revisions where listing_id = ${fixture.id}`;
    expect(Number(n)).toBe(1); // no second revision
  });

  it("EXPIRED submit enters moderation while the listing stays EXPIRED (no payment, no period)", async () => {
    const fixture = await insertListing({ status: "EXPIRED", expiresOffsetMin: -60 });
    const commerceBefore = await commerceCounts(seller.userId);
    await createRevision(fixture.id);
    const submit = await api(editSubmitRoute, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: 1 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(submit.status).toBe(200);
    expect(submit.body.data).toMatchObject({ editStatus: "PENDING_MODERATION" });
    const after = await approvedSnapshot(fixture.id);
    expect(after.status).toBe("EXPIRED");
    expect(await commerceCounts(seller.userId)).toEqual(commerceBefore);
    // limited EXPIRED public view, never contactable/ACTIVE
    const detail = await publicDetail(fixture.publicId);
    expect(detail.listing.status).toBe("EXPIRED");
  });

  it("combined submit-and-activate records the intent; the listing stays hidden (§21/§37)", async () => {
    const fixture = await insertListing({ deactivated: true });
    await createRevision(fixture.id);
    await patchRevision(fixture.id, 1, { description: "Aktivləşdirmə redaktəsi" });
    const submit = await api(editSubmitRoute, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: 2, activate: true },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(submit.status).toBe(200);
    expect(submit.body.data).toMatchObject({
      editStatus: "PENDING_MODERATION",
      reactivationRequested: true,
    });
    const sql = getSql();
    const [row] = await sql<
      { seller_deactivated_at: Date | null; seller_reactivation_requested_at: Date | null }[]
    >`select seller_deactivated_at, seller_reactivation_requested_at from listings where id = ${fixture.id}`;
    expect(row.seller_deactivated_at).not.toBeNull(); // NO submit path clears it
    expect(row.seller_reactivation_requested_at).not.toBeNull();
    // §37: fresh public read stays a generic not-found
    await expect(publicDetail(fixture.publicId)).rejects.toMatchObject({
      code: "LISTING_NOT_FOUND",
    });
  });
});

describe("cancel edit", () => {
  it("cancels DRAFT/CORRECTION, keeps history, refuses PENDING", async () => {
    const fixture = await insertListing({ deactivated: true });
    await createRevision(fixture.id);
    const before = await approvedSnapshot(fixture.id);
    const cancel = await api(editCancelRoute, "POST", `${eb(fixture.id)}/cancel`, {
      body: { expected_revision: 1 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data).toMatchObject({ status: "CANCELLED" });
    // history retained, approved content untouched, a NEW edit can start
    const sql = getSql();
    const [{ n }] = await sql<{ n: string }[]>`
      select count(*)::text as n from listing_edit_revisions where listing_id = ${fixture.id}`;
    expect(Number(n)).toBe(1);
    expect(await approvedSnapshot(fixture.id)).toEqual(before);
    const second = await createRevision(fixture.id);
    expect((second.listing as { revision: number }).revision).toBe(1);

    // PENDING cancel refused
    await api(editSubmitRoute, "POST", `${eb(fixture.id)}/submit`, {
      body: { expected_revision: 1 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    const refused = await api(editCancelRoute, "POST", `${eb(fixture.id)}/cancel`, {
      body: { expected_revision: 1 },
      cookie: seller.cookie,
      params: { listingId: fixture.id },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("LISTING_LIFECYCLE_CONFLICT");
  });
});
