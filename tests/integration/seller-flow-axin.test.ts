import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { createTestUserSession } from "./helpers/session";
import { POST as createListingRoute, GET as myListingsRoute } from "@/app/api/v1/me/listings/route";
import { PATCH as patchListingRoute } from "@/app/api/v1/me/listings/[listingId]/route";
import { POST as promotionCheckoutRoute } from "@/app/api/v1/me/listings/[listingId]/promotions/checkout/route";
import { publicDetail, revealListingContact } from "@/services/marketplace";

/**
 * Phase 4.17O.9 Stage A — AXIN draft-contract tests: listing-level
 * seller_name, promotion intent preferences, and the Owner-decided
 * satisfaction rule. No payment-core behavior is touched: intent is
 * preference data and checkout keeps its own authority.
 */

const BASE = "http://localhost/api/v1/me/listings";

let seller: { userId: string; cookie: string };
let carBrandId = "";
let carModelId = "";
let cityId = "";
let premiumPkgA = "";
let premiumPkgB = "";
let boostPkg = "";

interface Envelope {
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
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

async function createDraft(cookie: string): Promise<{ id: string; revision: number }> {
  const { status, body } = await api(createListingRoute, "POST", BASE, {
    body: { category: "CAR" },
    cookie,
  });
  expect(status).toBe(201);
  const listing = body.data?.listing as { id: string; revision: number };
  return { id: listing.id, revision: listing.revision };
}

async function patch(
  cookie: string,
  listingId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Envelope; listing: Record<string, unknown> }> {
  const r = await api(patchListingRoute, "PATCH", `${BASE}/${listingId}`, {
    body,
    cookie,
    params: { listingId },
  });
  return { ...r, listing: (r.body.data?.listing ?? {}) as Record<string, unknown> };
}

beforeAll(async () => {
  const sql = getSql();
  seller = await createTestUserSession("+994518000001");
  const [brand] = await sql`
    insert into brands (name, slug) values ('AxinToyota', 'axin-toyota') returning id
  `;
  carBrandId = brand.id as string;
  await sql`
    insert into brand_categories (brand_id, category_id)
    select ${carBrandId}, id from categories where code = 'CAR'
  `;
  const [model] = await sql`
    insert into models (brand_id, category_id, name, slug)
    select ${carBrandId}, id, 'Axinolla', 'axinolla' from categories where code = 'CAR'
    returning id
  `;
  carModelId = model.id as string;
  const [city] = await sql`select id from cities limit 1`;
  cityId = city.id as string;
  // Deterministic promotion packages for intent tests (active).
  const pkgs = await sql`
    insert into promotion_packages (type, name, duration_days, price_minor, currency, is_active, sort_order)
    values ('PREMIUM', 'Axin P1', 1, 300, 'AZN', true, 901),
           ('PREMIUM', 'Axin P3', 3, 700, 'AZN', true, 902),
           ('BOOST', 'Axin B1', 1, 200, 'AZN', true, 903)
    returning id, name
  `;
  premiumPkgA = pkgs.find((p) => p.name === "Axin P1")!.id as string;
  premiumPkgB = pkgs.find((p) => p.name === "Axin P3")!.id as string;
  boostPkg = pkgs.find((p) => p.name === "Axin B1")!.id as string;
});

afterAll(async () => {
  const sql = getSql();
  await sql`delete from payments where idempotency_key like 'axin-test:%'`;
  await sql`update listings set premium_intent_package_id = null, boost_intent_package_id = null
    where premium_intent_package_id in (${premiumPkgA}, ${premiumPkgB})
       or boost_intent_package_id = ${boostPkg}`;
  await sql`delete from promotion_packages where name like 'Axin %'`;
  await closeSql();
});

describe("seller_name draft field", () => {
  it("patches, trims, clears, and enforces the 100-char limit", async () => {
    const draft = await createDraft(seller.cookie);
    const r1 = await patch(seller.cookie, draft.id, {
      expected_revision: draft.revision,
      seller_name: "  Orxan M.  ",
    });
    expect(r1.status).toBe(200);
    expect(r1.listing.sellerName).toBe("Orxan M."); // trimmed
    const r2 = await patch(seller.cookie, draft.id, {
      expected_revision: r1.listing.revision as number,
      seller_name: "   ",
    });
    expect(r2.status).toBe(200);
    expect(r2.listing.sellerName).toBeNull(); // whitespace-only → null
    const r3 = await patch(seller.cookie, draft.id, {
      expected_revision: r2.listing.revision as number,
      seller_name: "x".repeat(101),
    });
    expect(r3.status).toBe(400); // over limit rejected by schema
    const r4 = await patch(seller.cookie, draft.id, {
      expected_revision: r2.listing.revision as number,
      seller_name: null,
    });
    expect(r4.status).toBe(200);
    expect(r4.listing.sellerName).toBeNull();
  });

  it("is required at submission via the shared completeness check", async () => {
    // Submission itself (images etc.) is covered by the submission
    // suite; here we prove the missing-code wiring for seller_name by
    // asserting the REQUIRED_FIELDS behavior indirectly through a
    // documented-complete listing lacking ONLY the name.
    const sql = getSql();
    const draft = await createDraft(seller.cookie);
    await patch(seller.cookie, draft.id, {
      expected_revision: draft.revision,
      brand_id: carBrandId,
      model_id: carModelId,
      year: 2021,
      price_minor: 100000,
      mileage: 1000,
      city_id: cityId,
      contact_phone: "+994501110001",
    });
    const [row] = await sql`select seller_name from listings where id = ${draft.id}`;
    expect(row.seller_name).toBeNull();
    const { submitListing } = await import("@/services/listing-submission");
    const { getCurrentAuth } = await import("@/auth/current-user");
    const auth = await getCurrentAuth(
      new Request("http://localhost/", { headers: { cookie: seller.cookie } }),
    );
    const [{ revision }] = await sql`select revision from listings where id = ${draft.id}`;
    await expect(submitListing(auth!, draft.id, revision as number)).rejects.toMatchObject({
      code: "LISTING_INCOMPLETE",
      details: { missing: expect.arrayContaining(["seller_name"]) },
    });
  });
});

describe("public seller-name resolution", () => {
  it("prefers listing.seller_name, falls back to users.display_name, never leaks phones", async () => {
    const sql = getSql();
    // Named user WITHOUT listing name → fallback to display_name.
    await sql`update users set display_name = 'Profil Adı' where id = ${seller.userId}`;
    const draft = await createDraft(seller.cookie);
    await patch(seller.cookie, draft.id, {
      expected_revision: draft.revision,
      brand_id: carBrandId,
      model_id: carModelId,
      year: 2021,
      price_minor: 100000,
      mileage: 1000,
      city_id: cityId,
      contact_phone: "+994701110002",
    });
    await sql`update listings set status = 'ACTIVE', published_at = now(),
      current_expires_at = now() + interval '10 days' where id = ${draft.id}`;
    const [{ public_id }] = await sql`select public_id::text as public_id from listings where id = ${draft.id}`;
    const d1 = await publicDetail(Number(public_id));
    expect(d1.listing.seller?.displayName).toBe("Profil Adı");
    // Listing-level name wins over the account name.
    await sql`update listings set seller_name = 'Elan Satıcısı' where id = ${draft.id}`;
    const d2 = await publicDetail(Number(public_id));
    expect(d2.listing.seller?.displayName).toBe("Elan Satıcısı");
    // Contact phone remains the LISTING phone, not the auth phone.
    const reveal = await revealListingContact(Number(public_id), null);
    expect(reveal.phone).toBe("+994701110002");
    const [{ phone_e164 }] = await sql`select phone_e164 from users where id = ${seller.userId}`;
    expect(phone_e164).toBe("+994518000001"); // auth identity untouched
    await sql`update users set display_name = null where id = ${seller.userId}`;
  });
});

describe("promotion intent preferences", () => {
  it("saves, replaces, dual-selects and clears intent per type", async () => {
    const draft = await createDraft(seller.cookie);
    const r1 = await patch(seller.cookie, draft.id, {
      expected_revision: draft.revision,
      premium_intent_package_id: premiumPkgA,
    });
    expect(r1.status).toBe(200);
    expect(r1.listing.premiumIntentPackageId).toBe(premiumPkgA);
    expect(r1.listing.boostIntentPackageId).toBeNull();
    // latest saved preference wins (A → B)
    const r2 = await patch(seller.cookie, draft.id, {
      expected_revision: r1.listing.revision as number,
      premium_intent_package_id: premiumPkgB,
      boost_intent_package_id: boostPkg, // dual selection
    });
    expect(r2.status).toBe(200);
    expect(r2.listing.premiumIntentPackageId).toBe(premiumPkgB);
    expect(r2.listing.boostIntentPackageId).toBe(boostPkg);
    // clearing one leaves the other
    const r3 = await patch(seller.cookie, draft.id, {
      expected_revision: r2.listing.revision as number,
      premium_intent_package_id: null,
    });
    expect(r3.status).toBe(200);
    expect(r3.listing.premiumIntentPackageId).toBeNull();
    expect(r3.listing.boostIntentPackageId).toBe(boostPkg);
  });

  it("rejects a wrong-type or unknown package", async () => {
    const draft = await createDraft(seller.cookie);
    const wrongType = await patch(seller.cookie, draft.id, {
      expected_revision: draft.revision,
      premium_intent_package_id: boostPkg, // BOOST package in the PREMIUM slot
    });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
    const unknown = await patch(seller.cookie, draft.id, {
      expected_revision: draft.revision,
      boost_intent_package_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error?.code).toBe("LISTING_INVALID_CATALOG_SELECTION");
  });

  it("intent survives correction and resubmission states", async () => {
    const sql = getSql();
    const draft = await createDraft(seller.cookie);
    await patch(seller.cookie, draft.id, {
      expected_revision: draft.revision,
      premium_intent_package_id: premiumPkgA,
    });
    await sql`update listings set status = 'CORRECTION_REQUIRED' where id = ${draft.id}`;
    const [{ revision }] = await sql`select revision from listings where id = ${draft.id}`;
    // still editable and still set while in a correction state
    const r = await patch(seller.cookie, draft.id, {
      expected_revision: revision as number,
      description: "düzəliş",
    });
    expect(r.status).toBe(200);
    expect(r.listing.premiumIntentPackageId).toBe(premiumPkgA);
  });

  it("an inactive intended package can no longer be checked out", async () => {
    const sql = getSql();
    const draft = await createDraft(seller.cookie);
    await patch(seller.cookie, draft.id, {
      expected_revision: draft.revision,
      premium_intent_package_id: premiumPkgA,
    });
    // reach ACTIVE, then deactivate the intended package
    await sql`update listings set status = 'ACTIVE', published_at = now(),
      current_expires_at = now() + interval '10 days' where id = ${draft.id}`;
    await sql`update promotion_packages set is_active = false where id = ${premiumPkgA}`;
    try {
      const r = await api(promotionCheckoutRoute, "POST", `${BASE}/${draft.id}/promotions/checkout`, {
        body: { type: "PREMIUM", package_id: premiumPkgA },
        cookie: seller.cookie,
        params: { listingId: draft.id },
      });
      expect(r.status).toBe(404);
      expect(r.body.error?.code).toBe("PROMOTION_PACKAGE_NOT_FOUND");
      // the stored intent remains valid historical preference
      const [row] = await sql`select premium_intent_package_id from listings where id = ${draft.id}`;
      expect(row.premium_intent_package_id).toBe(premiumPkgA);
    } finally {
      await sql`update promotion_packages set is_active = true where id = ${premiumPkgA}`;
    }
  });
});

describe("intent satisfaction read model", () => {
  async function myListingRow(listingId: string): Promise<Record<string, unknown>> {
    const r = await api(myListingsRoute, "GET", `${BASE}?filter=all`, { cookie: seller.cookie });
    expect(r.status).toBe(200);
    const rows = (r.body.data?.items ?? []) as { id: string }[];
    const row = rows.find((l) => l.id === listingId);
    expect(row).toBeDefined();
    return row as unknown as Record<string, unknown>;
  }

  async function insertPayment(
    listingId: string,
    type: "PREMIUM" | "BOOST",
    status: string,
  ): Promise<void> {
    const sql = getSql();
    await sql`
      insert into payments (user_id, listing_id, type, amount_minor, currency, status, provider,
                            fulfillment_status, idempotency_key)
      values (${seller.userId}, ${listingId}, ${type}::payment_type, 300, 'AZN',
              ${status}::payment_status,
              ${status === "CREATED" ? null : "KAPITAL"},
              'PENDING', ${`axin-test:${listingId}:${type}:${status}:${Math.random()}`})
    `;
  }

  it("SUCCESS of the same type satisfies per type; open/failed states do not", async () => {
    const sql = getSql();
    const draft = await createDraft(seller.cookie);
    await patch(seller.cookie, draft.id, {
      expected_revision: draft.revision,
      premium_intent_package_id: premiumPkgA,
      boost_intent_package_id: boostPkg,
    });
    let row = await myListingRow(draft.id);
    expect(row.premiumSatisfied).toBe(false);
    expect(row.boostSatisfied).toBe(false);
    expect((row.premiumIntent as { packageId: string }).packageId).toBe(premiumPkgA);
    expect((row.premiumIntent as { packageActive: boolean }).packageActive).toBe(true);

    // FAILED / CANCELLED / CREATED never satisfy
    await insertPayment(draft.id, "PREMIUM", "FAILED");
    await insertPayment(draft.id, "PREMIUM", "CANCELLED");
    await insertPayment(draft.id, "BOOST", "CREATED");
    row = await myListingRow(draft.id);
    expect(row.premiumSatisfied).toBe(false);
    expect(row.boostSatisfied).toBe(false);

    // PREMIUM SUCCESS with a DIFFERENT package still satisfies
    // Premium (Owner rule: package match not required) while Boost
    // stays pending — full type independence.
    const sqlDone = await sql`
      insert into payments (user_id, listing_id, type, amount_minor, currency, status, provider,
                            fulfillment_status, idempotency_key, promotion_package_id)
      values (${seller.userId}, ${draft.id}, 'PREMIUM', 700, 'AZN', 'SUCCESS', 'KAPITAL',
              'FULFILLED', ${`axin-test:${draft.id}:premium-success`}, ${premiumPkgB})
      returning id
    `;
    expect(sqlDone.length).toBe(1);
    row = await myListingRow(draft.id);
    expect(row.premiumSatisfied).toBe(true);
    expect(row.boostSatisfied).toBe(false); // Boost intent remains pending

    // BOOST SUCCESS then satisfies Boost independently.
    await insertPayment(draft.id, "BOOST", "SUCCESS");
    row = await myListingRow(draft.id);
    expect(row.boostSatisfied).toBe(true);
  });

  it("reports an intent's package as inactive for the CTA fallback", async () => {
    const sql = getSql();
    const draft = await createDraft(seller.cookie);
    await patch(seller.cookie, draft.id, {
      expected_revision: draft.revision,
      boost_intent_package_id: boostPkg,
    });
    await sql`update promotion_packages set is_active = false where id = ${boostPkg}`;
    try {
      const row = await myListingRow(draft.id);
      expect((row.boostIntent as { packageActive: boolean }).packageActive).toBe(false);
    } finally {
      await sql`update promotion_packages set is_active = true where id = ${boostPkg}`;
    }
  });
});
