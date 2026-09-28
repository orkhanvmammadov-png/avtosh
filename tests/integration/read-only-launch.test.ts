import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { handleKapitalCallback } from "@/services/payment-checkout";
import { createTestUserSession } from "./helpers/session";
import { POST as otpRequestRoute } from "@/app/api/v1/auth/otp/request/route";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";
import { PUT as favoriteRoute } from "@/app/api/v1/me/favorites/[publicId]/route";
import { POST as contactRoute } from "@/app/api/v1/listings/[publicId]/contact/route";
import { POST as reportRoute } from "@/app/api/v1/listings/[publicId]/report/route";
import { POST as createListingRoute } from "@/app/api/v1/me/listings/route";
import { POST as claimRoute } from "@/app/api/v1/moderator/listings/[listingId]/claim/route";
import { PATCH as adminSettingsRoute } from "@/app/api/v1/admin/settings/route";
import { GET as brandsRoute } from "@/app/api/v1/catalog/brands/route";
import { GET as searchRoute } from "@/app/api/v1/listings/route";
import { GET as detailRoute } from "@/app/api/v1/listings/[publicId]/route";
import { GET as healthRoute } from "@/app/api/v1/health/route";
import { GET as expireJobRoute } from "@/app/api/jobs/expire-listings/route";

// Production READ-ONLY launch: every mutation and side-effecting
// entry fails closed at the SERVER while the public read paths keep
// serving. LAUNCH_MODE is read live, so this file flips it for its
// own scope only (vitest isolates env per test file).

const CRON_SECRET = "read-only-test-cron-secret-0001";
let sellerCookie = "";
let publicId = "";
let sessionLastSeen: Date | null = null;

interface Envelope {
  data?: unknown;
  error?: { code: string };
}

async function call(
  route: (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Response | Promise<Response>,
  method: string,
  url: string,
  options: { body?: unknown; cookie?: string; params?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Envelope }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...options.headers };
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

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  const sql = getSql();
  // Fixtures are created in FULL mode, then the launch flips.
  const seller = await createTestUserSession("+994513500001");
  sellerCookie = seller.cookie;
  const [cat] = await sql<{ id: string }[]>`select id from categories where code = 'CAR'`;
  const [brand] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('RlBrand', 'rl-brand') returning id
  `;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand.id}, ${cat.id})`;
  const [model] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    values (${brand.id}, ${cat.id}, 'RlModel', 'rl-model') returning id
  `;
  const [city] = await sql<{ id: string }[]>`
    insert into cities (name_az, slug) values ('RlBakı', 'rl-baki') returning id
  `;
  const [listing] = await sql<{ public_id: string }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year,
      price_minor, mileage, description, contact_phone_e164, seller_name,
      status, published_at, current_expires_at)
    values (${seller.userId}, ${cat.id}, ${brand.id}, ${model.id}, ${city.id}, 2020,
      1000000, 50000, 'Rl təsvir', '+994501234567', 'Rl Seller',
      'ACTIVE', now(), now() + interval '10 days')
    returning public_id::text as public_id
  `;
  publicId = listing.public_id;
  const [session] = await sql<{ last_seen_at: Date | null }[]>`
    select last_seen_at from sessions where user_id = ${seller.userId}
  `;
  sessionLastSeen = session.last_seen_at;
  process.env.LAUNCH_MODE = "READ_ONLY";
  process.env.CRON_SECRET = CRON_SECRET;
});

afterAll(async () => {
  delete process.env.LAUNCH_MODE;
  await closeSql();
});

describe("read-only launch: mutations fail closed at the server", () => {
  it("blocks login (OTP request)", async () => {
    const r = await call(otpRequestRoute, "POST", "http://localhost/api/v1/auth/otp/request", {
      body: { phone: "0501234567" },
    });
    expect(r.status).toBe(503);
    expect(r.body.error?.code).toBe("SERVICE_READ_ONLY");
  });

  it("blocks listing creation, favorites, contact reveal and reports", async () => {
    const create = await call(createListingRoute, "POST", "http://localhost/api/v1/me/listings", {
      body: { category: "CAR" },
      cookie: sellerCookie,
    });
    expect(create.status).toBe(503);
    const fav = await call(favoriteRoute, "PUT", `http://localhost/api/v1/me/favorites/${publicId}`, {
      cookie: sellerCookie,
      params: { publicId },
    });
    expect(fav.status).toBe(503);
    const contact = await call(contactRoute, "POST", `http://localhost/api/v1/listings/${publicId}/contact`, {
      params: { publicId },
    });
    expect(contact.status).toBe(503);
    const report = await call(reportRoute, "POST", `http://localhost/api/v1/listings/${publicId}/report`, {
      body: { reason_code: "OTHER" },
      params: { publicId },
    });
    expect(report.status).toBe(503);
    for (const r of [create, fav, contact, report]) {
      expect(r.body.error?.code).toBe("SERVICE_READ_ONLY");
    }
  });

  it("blocks moderation and admin writes", async () => {
    const claim = await call(claimRoute, "POST", "http://localhost/api/v1/moderator/listings/x/claim", {
      params: { listingId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(claim.status).toBe(503);
    const settings = await call(adminSettingsRoute, "PATCH", "http://localhost/api/v1/admin/settings", {
      body: {},
    });
    expect(settings.status).toBe(503);
  });

  it("blocks scheduled jobs even with a valid CRON_SECRET", async () => {
    const r = await call(expireJobRoute, "GET", "http://localhost/api/jobs/expire-listings", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(r.status).toBe(503);
    expect(r.body.error?.code).toBe("SERVICE_READ_ONLY");
  });

  it("blocks the render-time payment verification service", async () => {
    await expect(handleKapitalCallback(null, "some-order")).rejects.toMatchObject({
      code: "SERVICE_READ_ONLY",
    });
  });

  it("treats a valid session as anonymous without touching it", async () => {
    const me = await call(meRoute, "GET", "http://localhost/api/v1/auth/me", {
      cookie: sellerCookie,
    });
    expect(me.status).toBe(401); // AUTH_REQUIRED — login is not operating
    const sql = getSql();
    const [session] = await sql<{ last_seen_at: Date | null }[]>`
      select s.last_seen_at from sessions s
      join users u on u.id = s.user_id
      where u.phone_e164 = '+994513500001'
    `;
    expect(session.last_seen_at?.getTime() ?? null).toBe(sessionLastSeen?.getTime() ?? null);
  });
});

describe("read-only launch: public read paths keep serving", () => {
  it("catalog, search, health and public detail respond", async () => {
    const brands = await call(brandsRoute, "GET", "http://localhost/api/v1/catalog/brands?category=CAR");
    expect(brands.status).toBe(200);
    const search = await call(searchRoute, "GET", "http://localhost/api/v1/listings?category=CAR");
    expect(search.status).toBe(200);
    const health = await call(healthRoute, "GET", "http://localhost/api/v1/health");
    expect(health.status).toBe(200);
    const detail = await call(detailRoute, "GET", `http://localhost/api/v1/listings/${publicId}`, {
      params: { publicId },
    });
    expect(detail.status).toBe(200);
  });

  it("public detail does not write the view counter", async () => {
    const sql = getSql();
    const before = await sql<{ view_count: number }[]>`
      select view_count from listing_stats ls
      join listings l on l.id = ls.listing_id
      where l.public_id::text = ${publicId}
    `;
    await call(detailRoute, "GET", `http://localhost/api/v1/listings/${publicId}`, {
      params: { publicId },
    });
    const after = await sql<{ view_count: number }[]>`
      select view_count from listing_stats ls
      join listings l on l.id = ls.listing_id
      where l.public_id::text = ${publicId}
    `;
    expect(after.length).toBe(before.length); // no row appears
    if (after.length > 0) {
      expect(after[0].view_count).toBe(before[0].view_count);
    }
  });
});
