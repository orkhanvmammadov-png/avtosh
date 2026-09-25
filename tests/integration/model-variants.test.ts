import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { ApiError } from "@/lib/api/errors";
import { assertContentSubmittable } from "@/services/listing-edit";
import { searchMarketplace } from "@/services/marketplace";
import { createTestUserSession } from "./helpers/session";
import { POST as createListingRoute } from "@/app/api/v1/me/listings/route";
import { PATCH as patchListingRoute } from "@/app/api/v1/me/listings/[listingId]/route";
import { GET as variantsRoute } from "@/app/api/v1/catalog/model-variants/route";

// O.15 Alt model behavior: catalog endpoint, seller patch rules,
// conditional submission requirement, legacy NULL listings, search
// filtering. All fixtures use mv-* slugs owned by this file only.

const BASE = "http://localhost/api/v1/me/listings";

let seller: { userId: string; cookie: string };
let carCategoryId = "";
let motoCategoryId = "";
let brandId = "";
let motoBrandId = "";
let familyId = ""; // CAR family WITH variants
let plainModelId = ""; // CAR family WITHOUT variants
let motoFamilyId = ""; // MOTORCYCLE family WITH variants
let variantAId = "";
let variantBId = "";
let inactiveVariantId = "";
let motoVariantId = "";
let cityId = "";

interface Envelope {
  data?: unknown;
  error?: { code: string; message: string };
}

async function api(
  route: (
    request: Request,
    context?: { params: Promise<Record<string, string>> },
  ) => Promise<Response>,
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

async function createDraft(category = "CAR"): Promise<string> {
  const { status, body } = await api(createListingRoute, "POST", BASE, {
    body: { category },
    cookie: seller.cookie,
  });
  expect(status).toBe(201);
  return ((body.data as Record<string, unknown>).listing as { id: string }).id;
}

async function patchDraft(
  listingId: string,
  fields: Record<string, unknown>,
  revision = 1,
): Promise<{ status: number; body: Envelope }> {
  return api(patchListingRoute, "PATCH", `${BASE}/${listingId}`, {
    body: { expected_revision: revision, ...fields },
    cookie: seller.cookie,
    params: { listingId },
  });
}

function listingOf(body: Envelope): Record<string, unknown> {
  return (body.data as Record<string, unknown>).listing as Record<string, unknown>;
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  seller = await createTestUserSession("+994513400001");
  const sql = getSql();
  carCategoryId = (await sql<{ id: string }[]>`select id from categories where code = 'CAR'`)[0].id;
  motoCategoryId = (await sql<{ id: string }[]>`select id from categories where code = 'MOTORCYCLE'`)[0].id;
  const [brand] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('MvBrand', 'mv-brand') returning id
  `;
  brandId = brand.id;
  const [motoBrand] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('MvMoto', 'mv-moto') returning id
  `;
  motoBrandId = motoBrand.id;
  await sql`
    insert into brand_categories (brand_id, category_id)
    values (${brandId}, ${carCategoryId}), (${motoBrandId}, ${motoCategoryId})
  `;
  const [family] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    values (${brandId}, ${carCategoryId}, 'Mv 3-series', 'mv-3-series') returning id
  `;
  familyId = family.id;
  const [plain] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    values (${brandId}, ${carCategoryId}, 'Mv Plain', 'mv-plain') returning id
  `;
  plainModelId = plain.id;
  const [motoFamily] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    values (${motoBrandId}, ${motoCategoryId}, 'Mv Moto Family', 'mv-moto-family') returning id
  `;
  motoFamilyId = motoFamily.id;
  const variants = await sql<{ id: string; slug: string }[]>`
    insert into model_variants (model_id, name, slug, is_active, sort_order) values
      (${familyId}, 'Mv 328', 'mv-328', true, 1),
      (${familyId}, 'Mv 330', 'mv-330', true, 2),
      (${familyId}, 'Mv 316 Old', 'mv-316-old', false, 3),
      (${motoFamilyId}, 'Mv S 1000 RR', 'mv-s-1000-rr', true, 1)
    returning id, slug
  `;
  variantAId = variants.find((v) => v.slug === "mv-328")!.id;
  variantBId = variants.find((v) => v.slug === "mv-330")!.id;
  inactiveVariantId = variants.find((v) => v.slug === "mv-316-old")!.id;
  motoVariantId = variants.find((v) => v.slug === "mv-s-1000-rr")!.id;
  const [city] = await sql<{ id: string }[]>`
    insert into cities (name_az, slug) values ('MvBakı', 'mv-baki') returning id
  `;
  cityId = city.id;
});

afterAll(async () => {
  await closeSql();
});

describe("GET /catalog/variants", () => {
  it("returns active variants of the family in display order", async () => {
    const { status, body } = await api(
      variantsRoute,
      "GET",
      `http://localhost/api/v1/catalog/model-variants?category=CAR&brand_id=${brandId}&model_id=${familyId}`,
    );
    expect(status).toBe(200);
    const rows = body.data as { id: string; name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["Mv 328", "Mv 330"]); // inactive hidden
  });

  it("returns an empty list for a family without variants", async () => {
    const { status, body } = await api(
      variantsRoute,
      "GET",
      `http://localhost/api/v1/catalog/model-variants?category=CAR&brand_id=${brandId}&model_id=${plainModelId}`,
    );
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("rejects a model outside the brand/category instead of leaking a foreign list", async () => {
    const { status, body } = await api(
      variantsRoute,
      "GET",
      `http://localhost/api/v1/catalog/model-variants?category=CAR&brand_id=${brandId}&model_id=${motoFamilyId}`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe("CATALOG_INVALID_MODEL");
  });
});

describe("seller patch: Alt model rules", () => {
  it("stores a valid variant and clears it when the model changes", async () => {
    const listingId = await createDraft();
    const set = await patchDraft(listingId, {
      brand_id: brandId,
      model_id: familyId,
      model_variant_id: variantAId,
    });
    expect(set.status).toBe(200);
    expect(listingOf(set.body).modelVariantId).toBe(variantAId);

    const moved = await patchDraft(listingId, { model_id: plainModelId }, 2);
    expect(moved.status).toBe(200);
    expect(listingOf(moved.body).modelId).toBe(plainModelId);
    expect(listingOf(moved.body).modelVariantId).toBeNull();
  });

  it("clears the variant when the brand or category changes", async () => {
    const listingId = await createDraft();
    await patchDraft(listingId, {
      brand_id: brandId,
      model_id: familyId,
      model_variant_id: variantBId,
    });
    const cleared = await patchDraft(listingId, { brand_id: null }, 2);
    expect(cleared.status).toBe(200);
    expect(listingOf(cleared.body).modelVariantId).toBeNull();
  });

  it("rejects a variant of another model, an inactive variant, and a variant without a model", async () => {
    const listingId = await createDraft();
    const foreign = await patchDraft(listingId, {
      brand_id: brandId,
      model_id: plainModelId,
      model_variant_id: variantAId,
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");

    const inactive = await patchDraft(listingId, {
      brand_id: brandId,
      model_id: familyId,
      model_variant_id: inactiveVariantId,
    });
    expect(inactive.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");

    const orphan = await patchDraft(listingId, { model_variant_id: variantAId });
    expect(orphan.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
  });
});

describe("conditional Alt model requirement", () => {
  function submittableData(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      category: "CAR",
      brand_id: brandId,
      model_id: familyId,
      model_variant_id: null,
      year: 2020,
      price_minor: 1000000,
      mileage: 50000,
      city_id: cityId,
      contact_phone: "+994501234567",
      seller_name: "Mv Seller",
      feature_ids: [],
      ...overrides,
    };
  }

  it("requires an Alt model for a CAR family with active variants", async () => {
    await expect(assertContentSubmittable(submittableData({}))).rejects.toMatchObject({
      code: "LISTING_INCOMPLETE",
    });
    await expect(
      assertContentSubmittable(submittableData({ model_variant_id: variantAId })),
    ).resolves.toBeUndefined();
  });

  it("does not require one for a zero-variant family (legacy NULL stays valid)", async () => {
    await expect(
      assertContentSubmittable(submittableData({ model_id: plainModelId })),
    ).resolves.toBeUndefined();
  });

  it("requires one for a MOTORCYCLE family with active variants too", async () => {
    await expect(
      assertContentSubmittable(
        submittableData({
          category: "MOTORCYCLE",
          brand_id: motoBrandId,
          model_id: motoFamilyId,
        }),
      ),
    ).rejects.toMatchObject({ code: "LISTING_INCOMPLETE" });
  });
});

describe("search filtering by Alt model", () => {
  let withVariantA = "";
  let withVariantB = "";
  let withoutVariant = "";

  beforeAll(async () => {
    const sql = getSql();
    async function activeListing(variantId: string | null): Promise<string> {
      const [row] = await sql<{ public_id: string }[]>`
        insert into listings (owner_id, category_id, brand_id, model_id, model_variant_id,
          city_id, year, price_minor, mileage, description, contact_phone_e164,
          status, published_at, current_expires_at)
        values (${seller.userId}, ${carCategoryId}, ${brandId}, ${familyId}, ${variantId},
          ${cityId}, 2021, 2000000, 10000, 'Mv Təsvir', '+994501234567',
          'ACTIVE', now(), now() + interval '10 days')
        returning public_id::text as public_id
      `;
      return row.public_id;
    }
    withVariantA = await activeListing(variantAId);
    withVariantB = await activeListing(variantBId);
    withoutVariant = await activeListing(null);
  });

  it("never violates the user's variant filter and keeps unfiltered results whole", async () => {
    const all = await searchMarketplace({
      category: "CAR",
      sort: "NEWEST",
      brand_id: brandId,
      model_id: familyId,
    } as Parameters<typeof searchMarketplace>[0]);
    const allIds = all.items.map((i) => i.publicId);
    expect(allIds).toEqual(expect.arrayContaining([withVariantA, withVariantB, withoutVariant]));

    const filtered = await searchMarketplace({
      category: "CAR",
      sort: "NEWEST",
      brand_id: brandId,
      model_id: familyId,
      model_variant_id: variantAId,
    } as Parameters<typeof searchMarketplace>[0]);
    const ids = filtered.items.map((i) => i.publicId);
    expect(ids).toContain(withVariantA);
    expect(ids).not.toContain(withVariantB);
    expect(ids).not.toContain(withoutVariant);
  });

  it("multi-select: families OR variants in one group; family includes legacy NULL rows", async () => {
    // second family with its own listing for cross-family OR
    const sql = getSql();
    const [otherRow] = await sql<{ public_id: string }[]>`
      insert into listings (owner_id, category_id, brand_id, model_id, city_id, year,
        price_minor, mileage, description, contact_phone_e164, status, published_at, current_expires_at)
      values (${seller.userId}, ${carCategoryId}, ${brandId}, ${plainModelId}, ${cityId}, 2022,
        3000000, 5000, 'Mv Digər', '+994501234567', 'ACTIVE', now(), now() + interval '10 days')
      returning public_id::text as public_id
    `;
    const q = (extra: Record<string, unknown>) =>
      searchMarketplace({ category: "CAR", sort: "NEWEST", brand_id: brandId, ...extra } as Parameters<typeof searchMarketplace>[0]);

    // family(plain) OR variant(A of the other family)
    const or = await q({ model_ids: [plainModelId], model_variant_ids: [variantAId] });
    const orIds = or.items.map((i) => i.publicId);
    expect(orIds).toEqual(expect.arrayContaining([otherRow.public_id, withVariantA]));
    expect(orIds).not.toContain(withVariantB);
    expect(orIds).not.toContain(withoutVariant);

    // family selection alone includes every listing of the family (NULL too)
    const fam = await q({ model_ids: [familyId] });
    expect(fam.items.map((i) => i.publicId)).toEqual(
      expect.arrayContaining([withVariantA, withVariantB, withoutVariant]),
    );

    // normalization: a variant of an already-selected family is absorbed
    const normalized = await q({ model_ids: [familyId], model_variant_ids: [variantAId] });
    expect(normalized.items.map((i) => i.publicId)).toEqual(
      expect.arrayContaining([withVariantA, withVariantB, withoutVariant]),
    );
  });

  it("rejects mixed-brand and foreign ids in multi-select", async () => {
    const q = (extra: Record<string, unknown>) =>
      searchMarketplace({ category: "CAR", sort: "NEWEST", brand_id: brandId, ...extra } as Parameters<typeof searchMarketplace>[0]);
    // a MOTORCYCLE-brand family id under a CAR brand query
    await expect(q({ model_ids: [motoFamilyId] })).rejects.toMatchObject({
      code: "CATALOG_INVALID_BRAND",
    });
    // a variant whose parent family belongs to another brand/category
    await expect(q({ model_variant_ids: [motoVariantId] })).rejects.toMatchObject({
      code: "CATALOG_INVALID_BRAND",
    });
    // model selections without a brand
    await expect(
      searchMarketplace({ category: "CAR", sort: "NEWEST", model_ids: [familyId] } as Parameters<typeof searchMarketplace>[0]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a variant filter without a model and a variant of another model", async () => {
    await expect(
      searchMarketplace({
        category: "CAR",
        sort: "NEWEST",
        model_variant_id: variantAId,
      } as Parameters<typeof searchMarketplace>[0]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      searchMarketplace({
        category: "CAR",
        sort: "NEWEST",
        brand_id: brandId,
        model_id: plainModelId,
        model_variant_id: variantAId,
      } as Parameters<typeof searchMarketplace>[0]),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
