import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import {
  createMemoryStorageProvider,
  type MemoryStorageProvider,
} from "@/providers/storage/memory-provider";
import { setStorageProviderForTesting } from "@/providers/storage/factory";
import { createTestUserSession } from "./helpers/session";
import { POST as createListingRoute } from "@/app/api/v1/me/listings/route";
import {
  GET as getListingRoute,
  PATCH as patchListingRoute,
} from "@/app/api/v1/me/listings/[listingId]/route";
import { POST as uploadUrlRoute } from "@/app/api/v1/me/listings/[listingId]/images/upload-url/route";
import { POST as confirmRoute } from "@/app/api/v1/me/listings/[listingId]/images/confirm/route";
import { DELETE as deleteImageRoute } from "@/app/api/v1/me/listings/[listingId]/images/[imageId]/route";
import { PATCH as reorderRoute } from "@/app/api/v1/me/listings/[listingId]/images/order/route";
import { PATCH as primaryRoute } from "@/app/api/v1/me/listings/[listingId]/images/[imageId]/primary/route";

const BASE = "http://localhost/api/v1/me/listings";

let storage: MemoryStorageProvider;
let seller: { userId: string; cookie: string };
let otherUser: { userId: string; cookie: string };
let carBrandId = "";
let carModelId = "";
let motoBrandId = "";
let motoModelId = "";
let inactiveBrandId = "";
let cityId = "";
let carFeatureId = "";
let globalFeatureId = "";
let sedanOptionId = "";
let sportMotoOptionId = "";
let petrolOptionId = "";

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
  options: {
    body?: unknown;
    cookie?: string;
    params?: Record<string, string>;
    origin?: string;
  } = {},
): Promise<{ status: number; body: Envelope; response: Response }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  if (options.origin !== undefined) {
    headers.origin = options.origin;
    headers.host = "localhost";
  }
  const response = await route(
    new Request(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    options.params === undefined
      ? undefined
      : { params: Promise.resolve(options.params) },
  );
  return {
    status: response.status,
    body: (await response.json()) as Envelope,
    response,
  };
}

async function createDraft(cookie: string, category = "CAR"): Promise<string> {
  const { status, body } = await api(createListingRoute, "POST", BASE, {
    body: { category },
    cookie,
  });
  expect(status).toBe(201);
  return (body.data?.listing as { id: string }).id;
}

async function makeJpeg(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 80, b: 120 } },
  })
    .jpeg()
    .toBuffer();
}

async function uploadAndConfirm(
  cookie: string,
  listingId: string,
  data?: Buffer,
): Promise<{ imageId: string; revision: number }> {
  const auth = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
    body: { declared_mime_type: "image/jpeg", declared_size_bytes: 5000 },
    cookie,
    params: { listingId },
  });
  expect(auth.status).toBe(200);
  storage.uploadViaSignedUrl(
    auth.body.data?.upload_url as string,
    data ?? (await makeJpeg()),
    "image/jpeg",
  );
  const confirm = await api(confirmRoute, "POST", `${BASE}/${listingId}/images/confirm`, {
    body: { upload_id: auth.body.data?.upload_id },
    cookie,
    params: { listingId },
  });
  expect(confirm.status).toBe(201);
  return {
    imageId: (confirm.body.data?.image as { id: string }).id,
    revision: confirm.body.data?.revision as number,
  };
}

async function withEnv<T>(
  overrides: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function setImageMax(value: number | null): Promise<void> {
  const sql = getSql();
  await sql`
    update system_settings
    set value = ${value === null ? "20" : String(value)}::jsonb
    where key = 'listing.image_max'
  `;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  storage = createMemoryStorageProvider();
  setStorageProviderForTesting(storage);

  seller = await createTestUserSession("+994513000001");
  otherUser = await createTestUserSession("+994513000002");

  const sql = getSql();
  const [carBrand] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('LiToyota', 'li-toyota') returning id
  `;
  carBrandId = carBrand.id;
  const [motoBrand] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('LiYamaha', 'li-yamaha') returning id
  `;
  motoBrandId = motoBrand.id;
  const [ghost] = await sql<{ id: string }[]>`
    insert into brands (name, slug, is_active) values ('LiGhost', 'li-ghost', false) returning id
  `;
  inactiveBrandId = ghost.id;
  await sql`
    insert into brand_categories (brand_id, category_id)
    select b.id, c.id from brands b, categories c
    where (b.slug, c.code) in
      (('li-toyota', 'CAR'), ('li-yamaha', 'MOTORCYCLE'), ('li-ghost', 'CAR'))
  `;
  const [carModel] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    select ${carBrandId}, id, 'LiCorolla', 'li-corolla' from categories where code = 'CAR'
    returning id
  `;
  carModelId = carModel.id;
  const [motoModel] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    select ${motoBrandId}, id, 'LiR6', 'li-r6' from categories where code = 'MOTORCYCLE'
    returning id
  `;
  motoModelId = motoModel.id;
  const [city] = await sql<{ id: string }[]>`
    insert into cities (name_az, slug) values ('LiBakı', 'li-baki') returning id
  `;
  cityId = city.id;
  const [carFeature] = await sql<{ id: string }[]>`
    insert into features (code, name_az, category_id)
    select 'LI_CAR_AC', 'Li Kondisioner', id from categories where code = 'CAR'
    returning id
  `;
  carFeatureId = carFeature.id;
  const [globalFeature] = await sql<{ id: string }[]>`
    insert into features (code, name_az, category_id)
    values ('LI_ABS', 'Li ABS', null)
    returning id
  `;
  globalFeatureId = globalFeature.id;
  const [sedan] = await sql<{ id: string }[]>`
    select id from reference_options where group_code = 'BODY_TYPE' and code = 'SEDAN'
  `;
  sedanOptionId = sedan.id;
  const [sport] = await sql<{ id: string }[]>`
    select id from reference_options where group_code = 'MOTORCYCLE_TYPE' and code = 'SPORT'
  `;
  sportMotoOptionId = sport.id;
  const [petrol] = await sql<{ id: string }[]>`
    select id from reference_options where group_code = 'FUEL_TYPE' and code = 'PETROL'
  `;
  petrolOptionId = petrol.id;
});

afterAll(async () => {
  setStorageProviderForTesting(null);
  await closeSql();
});

describe("draft creation", () => {
  it("creates a DRAFT owned by the session user with no side effects", async () => {
    const { status, body } = await api(createListingRoute, "POST", BASE, {
      body: { category: "CAR" },
      cookie: seller.cookie,
    });
    expect(status).toBe(201);
    const listing = body.data?.listing as Record<string, unknown>;
    expect(listing.status).toBe("DRAFT");
    expect(listing.revision).toBe(1);
    expect(listing.category).toBe("CAR");
    const sql = getSql();
    const [row] = await sql<{ owner_id: string }[]>`
      select owner_id from listings where id = ${listing.id as string}
    `;
    expect(row.owner_id).toBe(seller.userId);
    const publications = await sql`
      select 1 from listing_publications where listing_id = ${listing.id as string}
    `;
    const payments = await sql`
      select 1 from payments where listing_id = ${listing.id as string}
    `;
    expect(publications.length).toBe(0);
    expect(payments.length).toBe(0);
  });

  it("rejects unauthenticated and blocked users", async () => {
    const anon = await api(createListingRoute, "POST", BASE, {
      body: { category: "CAR" },
    });
    expect(anon.status).toBe(401);
    const blocked = await createTestUserSession("+994513000003", { blocked: true });
    const rejected = await api(createListingRoute, "POST", BASE, {
      body: { category: "CAR" },
      cookie: blocked.cookie,
    });
    expect(rejected.status).toBe(403);
    expect(rejected.body.error?.code).toBe("USER_BLOCKED");
  });

  it("rejects an unknown category", async () => {
    const { status, body } = await api(createListingRoute, "POST", BASE, {
      body: { category: "PLANE" },
      cookie: seller.cookie,
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
  });

  it("rejects cross-origin creation", async () => {
    const { status, body } = await api(createListingRoute, "POST", BASE, {
      body: { category: "CAR" },
      cookie: seller.cookie,
      origin: "https://evil.example",
    });
    expect(status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN_ORIGIN");
  });
});

describe("ownership / IDOR", () => {
  it("hides other users' drafts behind LISTING_NOT_FOUND", async () => {
    const listingId = await createDraft(seller.cookie);
    for (const [route, method, params] of [
      [getListingRoute, "GET", { listingId }],
      [patchListingRoute, "PATCH", { listingId }],
    ] as const) {
      const { status, body } = await api(route, method, `${BASE}/${listingId}`, {
        body: method === "PATCH" ? { expected_revision: 1, year: 2020 } : undefined,
        cookie: otherUser.cookie,
        params: { ...params },
      });
      expect(status).toBe(404);
      expect(body.error?.code).toBe("LISTING_NOT_FOUND");
    }
    const upload = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
      cookie: otherUser.cookie,
      params: { listingId },
    });
    expect(upload.status).toBe(404);
  });

  it("prevents cross-user image mutations", async () => {
    const listingId = await createDraft(seller.cookie);
    const { imageId } = await uploadAndConfirm(seller.cookie, listingId);
    const del = await api(
      deleteImageRoute,
      "DELETE",
      `${BASE}/${listingId}/images/${imageId}`,
      { cookie: otherUser.cookie, params: { listingId, imageId } },
    );
    expect(del.status).toBe(404);
    const reorder = await api(reorderRoute, "PATCH", `${BASE}/${listingId}/images/order`, {
      body: { image_ids: [imageId] },
      cookie: otherUser.cookie,
      params: { listingId },
    });
    expect(reorder.status).toBe(404);
  });

  it("rejects malformed listing IDs", async () => {
    const { status, body } = await api(getListingRoute, "GET", `${BASE}/nope`, {
      cookie: seller.cookie,
      params: { listingId: "nope" },
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("draft PATCH / autosave", () => {
  it("applies partial updates and bumps revision", async () => {
    const listingId = await createDraft(seller.cookie);
    const { status, body } = await api(patchListingRoute, "PATCH", `${BASE}/${listingId}`, {
      body: {
        expected_revision: 1,
        brand_id: carBrandId,
        model_id: carModelId,
        year: 2021,
        price_minor: 2550000,
        mileage: 45000,
        fuel_type_id: petrolOptionId,
        body_type_id: sedanOptionId,
        city_id: cityId,
        credit_available: true,
        description: "Yaxşı vəziyyətdə",
        contact_phone: "050 555 44 33",
        feature_ids: [carFeatureId, globalFeatureId],
      },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(status).toBe(200);
    const listing = body.data?.listing as Record<string, unknown>;
    expect(listing.revision).toBe(2);
    expect(listing.priceMinor).toBe(2550000);
    expect(listing.contactPhone).toBe("+994505554433");
    expect((listing.featureIds as string[]).sort()).toEqual(
      [carFeatureId, globalFeatureId].sort(),
    );
  });

  it("returns 409 on a stale revision", async () => {
    const listingId = await createDraft(seller.cookie);
    await api(patchListingRoute, "PATCH", `${BASE}/${listingId}`, {
      body: { expected_revision: 1, year: 2019 },
      cookie: seller.cookie,
      params: { listingId },
    });
    const stale = await api(patchListingRoute, "PATCH", `${BASE}/${listingId}`, {
      body: { expected_revision: 1, year: 2022 },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("LISTING_REVISION_CONFLICT");
  });

  it("rejects unknown body fields (strict allowlist)", async () => {
    const listingId = await createDraft(seller.cookie);
    const { status, body } = await api(patchListingRoute, "PATCH", `${BASE}/${listingId}`, {
      body: { expected_revision: 1, status: "ACTIVE" },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("rejects edits on non-DRAFT listings", async () => {
    const listingId = await createDraft(seller.cookie);
    const sql = getSql();
    await sql`update listings set status = 'ACTIVE' where id = ${listingId}`;
    const { status, body } = await api(patchListingRoute, "PATCH", `${BASE}/${listingId}`, {
      body: { expected_revision: 1, year: 2020 },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(status).toBe(409);
    expect(body.error?.code).toBe("LISTING_NOT_EDITABLE");
  });

  it("rejects an invalid contact phone", async () => {
    const listingId = await createDraft(seller.cookie);
    const { status, body } = await api(patchListingRoute, "PATCH", `${BASE}/${listingId}`, {
      body: { expected_revision: 1, contact_phone: "12345" },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("catalog relationship validation", () => {
  async function patchDraft(
    listingId: string,
    fields: Record<string, unknown>,
    revision = 1,
  ) {
    return api(patchListingRoute, "PATCH", `${BASE}/${listingId}`, {
      body: { expected_revision: revision, ...fields },
      cookie: seller.cookie,
      params: { listingId },
    });
  }

  it("rejects a brand outside the listing category", async () => {
    const listingId = await createDraft(seller.cookie, "CAR");
    const { status, body } = await patchDraft(listingId, { brand_id: motoBrandId });
    expect(status).toBe(400);
    expect(body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
  });

  it("rejects an inactive brand", async () => {
    const listingId = await createDraft(seller.cookie, "CAR");
    const { body } = await patchDraft(listingId, { brand_id: inactiveBrandId });
    expect(body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
  });

  it("rejects a model that does not belong to the brand/category", async () => {
    const listingId = await createDraft(seller.cookie, "CAR");
    const { body } = await patchDraft(listingId, {
      brand_id: carBrandId,
      model_id: motoModelId,
    });
    expect(body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
  });

  it("rejects a model without a brand", async () => {
    const listingId = await createDraft(seller.cookie, "CAR");
    const { body } = await patchDraft(listingId, { model_id: carModelId });
    expect(body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
  });

  it("rejects category-scoped options on the wrong category", async () => {
    const carListing = await createDraft(seller.cookie, "CAR");
    const moto = await patchDraft(carListing, { motorcycle_type_id: sportMotoOptionId });
    expect(moto.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
    const motoListing = await createDraft(seller.cookie, "MOTORCYCLE");
    const bodyType = await patchDraft(motoListing, { body_type_id: sedanOptionId });
    expect(bodyType.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
  });

  it("rejects category-incompatible features", async () => {
    const motoListing = await createDraft(seller.cookie, "MOTORCYCLE");
    const { body } = await patchDraft(motoListing, { feature_ids: [carFeatureId] });
    expect(body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
  });

  it("clears dependent fields and incompatible features on category change", async () => {
    const listingId = await createDraft(seller.cookie, "CAR");
    await api(patchListingRoute, "PATCH", `${BASE}/${listingId}`, {
      body: {
        expected_revision: 1,
        brand_id: carBrandId,
        model_id: carModelId,
        body_type_id: sedanOptionId,
        feature_ids: [carFeatureId, globalFeatureId],
      },
      cookie: seller.cookie,
      params: { listingId },
    });
    const changed = await api(patchListingRoute, "PATCH", `${BASE}/${listingId}`, {
      body: { expected_revision: 2, category: "MOTORCYCLE" },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(changed.status).toBe(200);
    const listing = changed.body.data?.listing as Record<string, unknown>;
    expect(listing.category).toBe("MOTORCYCLE");
    expect(listing.brandId).toBeNull();
    expect(listing.modelId).toBeNull();
    expect(listing.bodyTypeId).toBeNull();
    expect(listing.featureIds).toEqual([globalFeatureId]); // car-only feature removed
  });
});

describe("image upload flow", () => {
  it("issues a server-controlled path and processes a real JPEG to WebP", async () => {
    const listingId = await createDraft(seller.cookie);
    const auth = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 5000 },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(auth.status).toBe(200);
    const target = storage.issuedUploads.get(auth.body.data?.upload_url as string);
    expect(target?.path.startsWith(`uploads/${seller.userId}/${listingId}/`)).toBe(true);

    storage.uploadViaSignedUrl(
      auth.body.data?.upload_url as string,
      await makeJpeg(2400, 1200),
      "image/jpeg",
    );
    const confirm = await api(confirmRoute, "POST", `${BASE}/${listingId}/images/confirm`, {
      body: { upload_id: auth.body.data?.upload_id },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(confirm.status).toBe(201);
    const image = confirm.body.data?.image as Record<string, unknown>;
    expect(image.mimeType).toBe("image/webp");
    expect(image.width).toBe(1600);
    expect(image.height).toBe(800);
    expect(image.isPrimary).toBe(true); // first image auto-primary
    expect(image.url).toContain("memory://signed-read/");
    expect(JSON.stringify(image)).not.toContain("uploads/"); // no temp path leak
    // temp object cleaned up
    expect(storage.has("listing-uploads", target!.path)).toBe(false);
    expect(confirm.body.data?.revision).toBe(2); // image mutation bumps revision
  });

  it("stores processed images under an opaque path with no owner or listing UUID", async () => {
    const listingId = await createDraft(seller.cookie);
    const { imageId } = await uploadAndConfirm(seller.cookie, listingId);
    const sql = getSql();
    const [row] = await sql<{ storage_path: string }[]>`
      select storage_path from listing_images where id = ${imageId}
    `;
    expect(row.storage_path).toBe(`listings/${imageId}.webp`);
    expect(row.storage_path).not.toContain(seller.userId);
    expect(row.storage_path).not.toContain(listingId);
    expect(storage.has("listing-images", row.storage_path)).toBe(true);
    // temp path stays internal; final object key carries nothing identifying
    for (const key of storage.objects.keys()) {
      if (key.startsWith("listing-images/")) {
        expect(key).not.toContain(seller.userId);
        expect(key).not.toContain(listingId);
      }
    }
    // owner read still works and the signed URL reveals no internal UUIDs
    const read = await api(getListingRoute, "GET", `${BASE}/${listingId}`, {
      cookie: seller.cookie,
      params: { listingId },
    });
    const url = (read.body.data?.listing as { images: { url: string }[] }).images[0].url;
    expect(url).not.toContain(seller.userId);
    expect(url).not.toContain(listingId);
    // cross-user access remains impossible (DB ownership, not path secrecy)
    const foreign = await api(getListingRoute, "GET", `${BASE}/${listingId}`, {
      cookie: otherUser.cookie,
      params: { listingId },
    });
    expect(foreign.status).toBe(404);
  });

  it("confirm is idempotent", async () => {
    const listingId = await createDraft(seller.cookie);
    const auth = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 5000 },
      cookie: seller.cookie,
      params: { listingId },
    });
    storage.uploadViaSignedUrl(auth.body.data?.upload_url as string, await makeJpeg());
    const first = await api(confirmRoute, "POST", `${BASE}/${listingId}/images/confirm`, {
      body: { upload_id: auth.body.data?.upload_id },
      cookie: seller.cookie,
      params: { listingId },
    });
    const second = await api(confirmRoute, "POST", `${BASE}/${listingId}/images/confirm`, {
      body: { upload_id: auth.body.data?.upload_id },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((second.body.data?.image as { id: string }).id).toBe(
      (first.body.data?.image as { id: string }).id,
    );
    const sql = getSql();
    const rows = await sql`
      select 1 from listing_images where listing_id = ${listingId}
    `;
    expect(rows.length).toBe(1);
  });

  it("rejects confirmation without an uploaded object", async () => {
    const listingId = await createDraft(seller.cookie);
    const auth = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 5000 },
      cookie: seller.cookie,
      params: { listingId },
    });
    const confirm = await api(confirmRoute, "POST", `${BASE}/${listingId}/images/confirm`, {
      body: { upload_id: auth.body.data?.upload_id },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(confirm.status).toBe(404);
    expect(confirm.body.error?.code).toBe("IMAGE_UPLOAD_NOT_FOUND");
  });

  it("rejects expired upload authorizations", async () => {
    const listingId = await createDraft(seller.cookie);
    const auth = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 5000 },
      cookie: seller.cookie,
      params: { listingId },
    });
    storage.uploadViaSignedUrl(auth.body.data?.upload_url as string, await makeJpeg());
    const sql = getSql();
    await sql`
      update listing_image_uploads
      set expires_at = now() - interval '1 second'
      where id = ${auth.body.data?.upload_id as string}
    `;
    const confirm = await api(confirmRoute, "POST", `${BASE}/${listingId}/images/confirm`, {
      body: { upload_id: auth.body.data?.upload_id },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(confirm.status).toBe(410);
    expect(confirm.body.error?.code).toBe("IMAGE_UPLOAD_EXPIRED");
  });

  it("rejects SVG, corrupt bytes, and fake MIME claims by decoding", async () => {
    const listingId = await createDraft(seller.cookie);
    const cases: Buffer[] = [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'),
      Buffer.from("plain text pretending to be image/jpeg"),
    ];
    for (const payload of cases) {
      const auth = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
        body: { declared_mime_type: "image/jpeg", declared_size_bytes: 5000 },
        cookie: seller.cookie,
        params: { listingId },
      });
      storage.uploadViaSignedUrl(auth.body.data?.upload_url as string, payload);
      const confirm = await api(confirmRoute, "POST", `${BASE}/${listingId}/images/confirm`, {
        body: { upload_id: auth.body.data?.upload_id },
        cookie: seller.cookie,
        params: { listingId },
      });
      expect(confirm.status).toBe(400);
      expect(confirm.body.error?.code).toBe("IMAGE_INVALID_FORMAT");
    }
    const sql = getSql();
    const rows = await sql`select 1 from listing_images where listing_id = ${listingId}`;
    expect(rows.length).toBe(0);
  });

  it("rejects oversized declarations and oversized actual objects", async () => {
    const listingId = await createDraft(seller.cookie);
    const declared = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 999_999_999 },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(declared.status).toBe(413);
    expect(declared.body.error?.code).toBe("IMAGE_TOO_LARGE");

    await withEnv({ LISTING_IMAGE_MAX_UPLOAD_BYTES: "2000" }, async () => {
      const auth = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
        body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
        cookie: seller.cookie,
        params: { listingId },
      });
      storage.uploadViaSignedUrl(
        auth.body.data?.upload_url as string,
        await makeJpeg(1200, 900), // real bytes exceed the 2000-byte cap
      );
      const confirm = await api(confirmRoute, "POST", `${BASE}/${listingId}/images/confirm`, {
        body: { upload_id: auth.body.data?.upload_id },
        cookie: seller.cookie,
        params: { listingId },
      });
      expect(confirm.status).toBe(413);
    });
  });

  it("rejects unsupported declared MIME types up front", async () => {
    const listingId = await createDraft(seller.cookie);
    const { status, body } = await api(
      uploadUrlRoute,
      "POST",
      `${BASE}/${listingId}/images/upload-url`,
      {
        body: { declared_mime_type: "image/svg+xml", declared_size_bytes: 100 },
        cookie: seller.cookie,
        params: { listingId },
      },
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("enforces the pending-upload issuance limit", async () => {
    await withEnv({ LISTING_IMAGE_MAX_PENDING_UPLOADS: "2" }, async () => {
      const listingId = await createDraft(seller.cookie);
      for (let i = 0; i < 2; i += 1) {
        const { status } = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
          body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
          cookie: seller.cookie,
          params: { listingId },
        });
        expect(status).toBe(200);
      }
      const third = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
        body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
        cookie: seller.cookie,
        params: { listingId },
      });
      expect(third.status).toBe(429);
      expect(third.body.error?.code).toBe("IMAGE_UPLOAD_RATE_LIMITED");
    });
  });

  it("enforces the image maximum, including under concurrent confirms", async () => {
    await setImageMax(1);
    try {
      const listingId = await createDraft(seller.cookie);
      const auths = [];
      for (let i = 0; i < 2; i += 1) {
        // Issuance counts images + pending, so issue one at a time is
        // impossible for the second — verify that too, then test the
        // confirm-time guard with pre-issued uploads on a fresh listing.
        auths.push(
          await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
            body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
            cookie: seller.cookie,
            params: { listingId },
          }),
        );
      }
      expect(auths[0].status).toBe(200);
      expect(auths[1].status).toBe(409);
      expect(auths[1].body.error?.code).toBe("LISTING_IMAGE_LIMIT_REACHED");

      // Confirm-time race: two valid uploads issued while max was 2,
      // then max drops to 1 — concurrent confirms must not both land.
      await setImageMax(2);
      const raceListing = await createDraft(seller.cookie);
      const uploadA = await api(uploadUrlRoute, "POST", `${BASE}/${raceListing}/images/upload-url`, {
        body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
        cookie: seller.cookie,
        params: { listingId: raceListing },
      });
      const uploadB = await api(uploadUrlRoute, "POST", `${BASE}/${raceListing}/images/upload-url`, {
        body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
        cookie: seller.cookie,
        params: { listingId: raceListing },
      });
      storage.uploadViaSignedUrl(uploadA.body.data?.upload_url as string, await makeJpeg());
      storage.uploadViaSignedUrl(uploadB.body.data?.upload_url as string, await makeJpeg());
      await setImageMax(1);
      const [a, b] = await Promise.all([
        api(confirmRoute, "POST", `${BASE}/${raceListing}/images/confirm`, {
          body: { upload_id: uploadA.body.data?.upload_id },
          cookie: seller.cookie,
          params: { listingId: raceListing },
        }),
        api(confirmRoute, "POST", `${BASE}/${raceListing}/images/confirm`, {
          body: { upload_id: uploadB.body.data?.upload_id },
          cookie: seller.cookie,
          params: { listingId: raceListing },
        }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const sql = getSql();
      const rows = await sql`
        select 1 from listing_images where listing_id = ${raceListing}
      `;
      expect(rows.length).toBe(1);
    } finally {
      await setImageMax(null);
    }
  });
});

describe("image delete / reorder / primary", () => {
  it("orders, reorders, re-primaries, and deletes deterministically", async () => {
    const listingId = await createDraft(seller.cookie);
    const first = await uploadAndConfirm(seller.cookie, listingId);
    const second = await uploadAndConfirm(seller.cookie, listingId);
    const third = await uploadAndConfirm(seller.cookie, listingId);

    // initial order 0,1,2; first is primary
    const initial = await api(getListingRoute, "GET", `${BASE}/${listingId}`, {
      cookie: seller.cookie,
      params: { listingId },
    });
    const images = initial.body.data?.listing as { images: { id: string; isPrimary: boolean; sortOrder: number }[] };
    expect(images.images.map((i) => i.id)).toEqual([
      first.imageId,
      second.imageId,
      third.imageId,
    ]);
    expect(images.images[0].isPrimary).toBe(true);

    // reorder
    const reorder = await api(reorderRoute, "PATCH", `${BASE}/${listingId}/images/order`, {
      body: { image_ids: [third.imageId, first.imageId, second.imageId] },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(reorder.status).toBe(200);

    // set primary explicitly; uniqueness preserved
    const primary = await api(primaryRoute, "PATCH", `${BASE}/${listingId}/images/${second.imageId}/primary`, {
      cookie: seller.cookie,
      params: { listingId, imageId: second.imageId },
    });
    expect(primary.status).toBe(200);
    const sql = getSql();
    const primaries = await sql<{ id: string }[]>`
      select id from listing_images where listing_id = ${listingId} and is_primary
    `;
    expect(primaries.length).toBe(1);
    expect(primaries[0].id).toBe(second.imageId);

    // delete the primary: next by sort_order becomes primary
    const del = await api(deleteImageRoute, "DELETE", `${BASE}/${listingId}/images/${second.imageId}`, {
      cookie: seller.cookie,
      params: { listingId, imageId: second.imageId },
    });
    expect(del.status).toBe(200);
    const after = await sql<{ id: string; is_primary: boolean; sort_order: number }[]>`
      select id, is_primary, sort_order from listing_images
      where listing_id = ${listingId} order by sort_order
    `;
    expect(after.length).toBe(2);
    expect(after[0].id).toBe(third.imageId); // sort 0 after reorder
    expect(after[0].is_primary).toBe(true);
    // storage object of the deleted image removed (opaque path: image id only)
    expect(storage.has("listing-images", `listings/${second.imageId}.webp`)).toBe(false);
  });

  it("rejects reorder lists that do not exactly match the image set", async () => {
    const listingId = await createDraft(seller.cookie);
    const { imageId } = await uploadAndConfirm(seller.cookie, listingId);
    const foreignListing = await createDraft(seller.cookie);
    const foreign = await uploadAndConfirm(seller.cookie, foreignListing);
    const wrong = await api(reorderRoute, "PATCH", `${BASE}/${listingId}/images/order`, {
      body: { image_ids: [imageId, foreign.imageId] },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(wrong.status).toBe(400);
    const dupes = await api(reorderRoute, "PATCH", `${BASE}/${listingId}/images/order`, {
      body: { image_ids: [imageId, imageId] },
      cookie: seller.cookie,
      params: { listingId },
    });
    expect(dupes.status).toBe(400);
  });

  it("blocks image mutations for blocked users and non-DRAFT listings", async () => {
    const listingId = await createDraft(seller.cookie);
    const { imageId } = await uploadAndConfirm(seller.cookie, listingId);
    const blocked = await createTestUserSession("+994513000004", { blocked: true });
    const blockedUpload = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
      body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
      cookie: blocked.cookie,
      params: { listingId },
    });
    expect(blockedUpload.status).toBe(403);
    const sql = getSql();
    await sql`update listings set status = 'ACTIVE' where id = ${listingId}`;
    const del = await api(deleteImageRoute, "DELETE", `${BASE}/${listingId}/images/${imageId}`, {
      cookie: seller.cookie,
      params: { listingId, imageId },
    });
    expect(del.status).toBe(409);
    expect(del.body.error?.code).toBe("LISTING_NOT_EDITABLE");
  });
});

describe("concurrent upload-url issuance", () => {
  it("cannot exceed the pending-upload cap under parallel requests", async () => {
    await withEnv({ LISTING_IMAGE_MAX_PENDING_UPLOADS: "5" }, async () => {
      const listingId = await createDraft(seller.cookie);
      // Seed 4 live pending uploads sequentially.
      for (let i = 0; i < 4; i += 1) {
        const { status } = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
          body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
          cookie: seller.cookie,
          params: { listingId },
        });
        expect(status).toBe(200);
      }
      // 10 concurrent authorization requests: only ONE slot remains.
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
            body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
            cookie: seller.cookie,
            params: { listingId },
          }),
        ),
      );
      const successes = results.filter((r) => r.status === 200);
      const limited = results.filter((r) => r.status === 429);
      expect(successes.length).toBe(1);
      expect(limited.length).toBe(9);
      expect(limited.every((r) => r.body.error?.code === "IMAGE_UPLOAD_RATE_LIMITED")).toBe(true);
      const sql = getSql();
      const [row] = await sql<{ count: string }[]>`
        select count(*)::text as count from listing_image_uploads
        where listing_id = ${listingId} and status = 'PENDING' and expires_at > now()
      `;
      expect(Number(row.count)).toBe(5); // cap holds in the database
      // Ownership/status rules untouched: another user still gets 404.
      const foreign = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
        body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
        cookie: otherUser.cookie,
        params: { listingId },
      });
      expect(foreign.status).toBe(404);
    });
  });

  it("cannot exceed the image maximum via parallel issuance (images + pending)", async () => {
    await setImageMax(3);
    try {
      const listingId = await createDraft(seller.cookie);
      await uploadAndConfirm(seller.cookie, listingId); // 1 persisted image
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
            body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
            cookie: seller.cookie,
            params: { listingId },
          }),
        ),
      );
      expect(results.filter((r) => r.status === 200).length).toBe(2); // 1 image + 2 pending = 3
      expect(
        results
          .filter((r) => r.status !== 200)
          .every((r) => r.status === 409 && r.body.error?.code === "LISTING_IMAGE_LIMIT_REACHED"),
      ).toBe(true);
    } finally {
      await setImageMax(null);
    }
  });

  it("marks the pending row FAILED when the provider cannot issue a URL", async () => {
    const listingId = await createDraft(seller.cookie);
    const original = storage.createSignedUploadUrl;
    storage.createSignedUploadUrl = async () => {
      throw new Error("simulated provider outage");
    };
    try {
      const { status, body } = await api(uploadUrlRoute, "POST", `${BASE}/${listingId}/images/upload-url`, {
        body: { declared_mime_type: "image/jpeg", declared_size_bytes: 1000 },
        cookie: seller.cookie,
        params: { listingId },
      });
      expect(status).toBe(502);
      expect(body.error?.code).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(body)).not.toContain("outage"); // no provider leak
    } finally {
      storage.createSignedUploadUrl = original;
    }
    const sql = getSql();
    const rows = await sql<{ status: string }[]>`
      select status from listing_image_uploads where listing_id = ${listingId}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("FAILED"); // no live pending slot consumed
  });
});
