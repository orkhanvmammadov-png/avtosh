import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { GET as getCategoriesRoute } from "@/app/api/v1/catalog/categories/route";
import { GET as getBrandsRoute } from "@/app/api/v1/catalog/brands/route";
import { GET as getModelsRoute } from "@/app/api/v1/catalog/models/route";
import { GET as getCitiesRoute } from "@/app/api/v1/catalog/cities/route";
import { GET as getOptionsRoute } from "@/app/api/v1/catalog/options/route";
import { GET as getFeaturesRoute } from "@/app/api/v1/catalog/features/route";

const BASE = "http://localhost/api/v1/catalog";

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string; request_id: string };
}

async function call<T>(
  route: (request: Request) => Promise<Response>,
  url: string,
): Promise<{ status: number; body: Envelope<T>; response: Response }> {
  const response = await route(new Request(url));
  const body = (await response.json()) as Envelope<T>;
  return { status: response.status, body, response };
}

let toyotaId = "";
let bmwId = "";
let inactiveBrandId = "";
let yamahaId = "";

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set — run via: pnpm test:integration:db",
    );
  }
  const sql = getSql();

  // Fixtures on top of the immutable migration seed. Categories CAR /
  // MOTORCYCLE and reference groups/options come from the seed
  // migration; everything below is test-local.
  await sql`
    insert into categories (code, name_az, slug, is_active, sort_order)
    values ('TRUCK', 'Yük maşınları', 'yuk-masinlari', false, 99)
  `;

  const [toyota] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('Toyota', 'toyota') returning id
  `;
  toyotaId = toyota.id;
  const [bmw] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('BMW', 'bmw') returning id
  `;
  bmwId = bmw.id;
  const [ghost] = await sql<{ id: string }[]>`
    insert into brands (name, slug, is_active)
    values ('GhostBrand', 'ghostbrand', false) returning id
  `;
  inactiveBrandId = ghost.id;
  const [yamaha] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('Yamaha', 'yamaha') returning id
  `;
  yamahaId = yamaha.id;

  await sql`
    insert into brand_categories (brand_id, category_id)
    select b.id, c.id from brands b, categories c
    where (b.slug, c.code) in
      (('toyota', 'CAR'), ('bmw', 'CAR'), ('bmw', 'MOTORCYCLE'),
       ('ghostbrand', 'CAR'), ('yamaha', 'MOTORCYCLE'))
  `;

  await sql`
    insert into models (brand_id, category_id, name, slug, is_active)
    select b.id, c.id, m.name, m.slug, m.is_active
    from (values
      ('toyota', 'CAR', 'Corolla', 'corolla', true),
      ('toyota', 'CAR', 'Camry', 'camry', true),
      ('toyota', 'CAR', 'HiddenModel', 'hiddenmodel', false),
      ('bmw', 'CAR', '3 Series', '3-series', true),
      ('bmw', 'MOTORCYCLE', 'R 1250 GS', 'r-1250-gs', true),
      ('yamaha', 'MOTORCYCLE', 'YZF-R6', 'yzf-r6', true)
    ) as m (brand_slug, category_code, name, slug, is_active)
    join brands b on b.slug = m.brand_slug
    join categories c on c.code = m.category_code
  `;

  await sql`
    insert into cities (name_az, slug, is_active, sort_order) values
      ('Bakı', 'baki', true, 1),
      ('Gəncə', 'gence', true, 2),
      ('KöhnəŞəhər', 'kohne-seher', false, 3)
  `;

  await sql`
    insert into features (code, name_az, category_id, is_active) values
      ('AIR_CONDITIONING', 'Kondisioner',
        (select id from categories where code = 'CAR'), true),
      ('ABS', 'ABS', null, true),
      ('HIDDEN_FEATURE', 'Gizli', null, false)
  `;
});

afterAll(async () => {
  await closeSql();
});

describe("GET /catalog/categories", () => {
  it("returns active categories with the expected DTO shape", async () => {
    const { status, body } = await call<
      { id: string; code: string; name: string; slug: string }[]
    >(getCategoriesRoute, `${BASE}/categories`);
    expect(status).toBe(200);
    const codes = body.data?.map((c) => c.code);
    expect(codes).toEqual(["CAR", "MOTORCYCLE"]);
    expect(body.data?.[0]).toEqual({
      id: expect.any(String),
      code: "CAR",
      name: "Avtomobillər",
      slug: "avtomobiller",
    });
  });

  it("hides inactive categories", async () => {
    const { body } = await call<{ code: string }[]>(
      getCategoriesRoute,
      `${BASE}/categories`,
    );
    expect(body.data?.some((c) => c.code === "TRUCK")).toBe(false);
  });

  it("echoes a valid X-Request-ID", async () => {
    const response = await getCategoriesRoute(
      new Request(`${BASE}/categories`, {
        headers: { "X-Request-ID": "catalog-test-1234" },
      }),
    );
    expect(response.headers.get("X-Request-ID")).toBe("catalog-test-1234");
  });
});

describe("GET /catalog/brands", () => {
  it("returns active brands linked to the category", async () => {
    const { status, body } = await call<{ name: string }[]>(
      getBrandsRoute,
      `${BASE}/brands?category=CAR`,
    );
    expect(status).toBe(200);
    const names = body.data?.map((b) => b.name);
    expect(names).toContain("Toyota");
    expect(names).toContain("BMW");
    expect(names).not.toContain("GhostBrand"); // inactive
    expect(names).not.toContain("Yamaha"); // not linked to CAR
  });

  it("rejects an unknown category code", async () => {
    const { status, body } = await call(
      getBrandsRoute,
      `${BASE}/brands?category=PLANE`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe("CATALOG_INVALID_CATEGORY");
  });

  it("rejects an inactive category code", async () => {
    const { status, body } = await call(
      getBrandsRoute,
      `${BASE}/brands?category=TRUCK`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe("CATALOG_INVALID_CATEGORY");
  });

  it("rejects a malformed category code", async () => {
    const { status, body } = await call(
      getBrandsRoute,
      `${BASE}/brands?category=car!`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /catalog/models", () => {
  it("returns only active models of the brand in the category", async () => {
    const { status, body } = await call<{ name: string; brandId: string }[]>(
      getModelsRoute,
      `${BASE}/models?category=CAR&brand_id=${toyotaId}`,
    );
    expect(status).toBe(200);
    const names = body.data?.map((m) => m.name);
    expect(names).toEqual(["Camry", "Corolla"]);
    expect(body.data?.[0]?.brandId).toBe(toyotaId);
  });

  it("does not leak models across categories for a multi-category brand", async () => {
    const car = await call<{ name: string }[]>(
      getModelsRoute,
      `${BASE}/models?category=CAR&brand_id=${bmwId}`,
    );
    expect(car.body.data?.map((m) => m.name)).toEqual(["3 Series"]);
    const moto = await call<{ name: string }[]>(
      getModelsRoute,
      `${BASE}/models?category=MOTORCYCLE&brand_id=${bmwId}`,
    );
    expect(moto.body.data?.map((m) => m.name)).toEqual(["R 1250 GS"]);
  });

  it("rejects a brand not linked to the requested category", async () => {
    const { status, body } = await call(
      getModelsRoute,
      `${BASE}/models?category=CAR&brand_id=${yamahaId}`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe("CATALOG_INVALID_BRAND");
  });

  it("rejects an inactive brand", async () => {
    const { status, body } = await call(
      getModelsRoute,
      `${BASE}/models?category=CAR&brand_id=${inactiveBrandId}`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe("CATALOG_INVALID_BRAND");
  });

  it("rejects a malformed brand_id", async () => {
    const { status, body } = await call(
      getModelsRoute,
      `${BASE}/models?category=CAR&brand_id=not-a-uuid`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("requires both category and brand_id", async () => {
    const { status, body } = await call(getModelsRoute, `${BASE}/models`);
    expect(status).toBe(400);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /catalog/cities", () => {
  it("returns only active cities in deterministic order", async () => {
    const { status, body } = await call<{ name: string; slug: string }[]>(
      getCitiesRoute,
      `${BASE}/cities`,
    );
    expect(status).toBe(200);
    // Other integration files add their own active cities to the shared
    // database, so assert deterministically on THIS file's fixtures:
    // projecting the response onto the fixture slugs must yield exactly
    // the two active ones, in sort_order — the inactive one must be
    // absent. This still fails if filtering or ordering breaks.
    const fixtureSlugs = new Set(["baki", "gence", "kohne-seher"]);
    const ours = (body.data ?? []).filter((c) => fixtureSlugs.has(c.slug));
    expect(ours.map((c) => c.name)).toEqual(["Bakı", "Gəncə"]);
    expect(body.data?.some((c) => c.slug === "kohne-seher")).toBe(false);
  });
});

describe("GET /catalog/options", () => {
  it("returns seeded global options for a group", async () => {
    const { status, body } = await call<{ code: string }[]>(
      getOptionsRoute,
      `${BASE}/options?group=FUEL_TYPE`,
    );
    expect(status).toBe(200);
    expect(body.data?.map((o) => o.code)).toEqual([
      "PETROL",
      "DIESEL",
      "GAS",
      "HYBRID",
      "ELECTRIC",
    ]);
  });

  it("returns category-scoped options for the matching category", async () => {
    const { body } = await call<{ code: string }[]>(
      getOptionsRoute,
      `${BASE}/options?group=BODY_TYPE&category=CAR`,
    );
    expect(body.data?.length).toBe(8);
    expect(body.data?.map((o) => o.code)).toContain("SEDAN");
  });

  it("does not leak CAR-scoped options into MOTORCYCLE", async () => {
    const { status, body } = await call<{ code: string }[]>(
      getOptionsRoute,
      `${BASE}/options?group=BODY_TYPE&category=MOTORCYCLE`,
    );
    expect(status).toBe(200);
    expect(body.data).toEqual([]); // valid combination, empty result
  });

  it("returns global options for any category", async () => {
    const { body } = await call<{ code: string }[]>(
      getOptionsRoute,
      `${BASE}/options?group=COLOR&category=MOTORCYCLE`,
    );
    expect(body.data?.length).toBe(12);
  });

  it("rejects an unknown group", async () => {
    const { status, body } = await call(
      getOptionsRoute,
      `${BASE}/options?group=WING_TYPE`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe("CATALOG_INVALID_GROUP");
  });
});

describe("GET /catalog/features", () => {
  it("returns global + category-scoped features for CAR", async () => {
    const { body } = await call<{ code: string }[]>(
      getFeaturesRoute,
      `${BASE}/features?category=CAR`,
    );
    const codes = body.data?.map((f) => f.code);
    expect(codes).toContain("ABS");
    expect(codes).toContain("AIR_CONDITIONING");
    expect(codes).not.toContain("HIDDEN_FEATURE");
  });

  it("returns only global features for MOTORCYCLE", async () => {
    const { body } = await call<{ code: string }[]>(
      getFeaturesRoute,
      `${BASE}/features?category=MOTORCYCLE`,
    );
    const codes = body.data?.map((f) => f.code);
    expect(codes).toContain("ABS");
    expect(codes).not.toContain("AIR_CONDITIONING");
  });
});
