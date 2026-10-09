import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { listSitemapListings } from "@/lib/seo/sitemap";
import sitemap from "@/app/sitemap";
import { createTestUserSession } from "./helpers/session";

/**
 * Sitemap inclusion/exclusion against the REAL visibility invariant
 * on a real database: exactly the publicly visible listing appears;
 * drafts, pending moderation, expired, suspended and
 * seller-deactivated rows never do.
 */

const ids: Record<string, string> = {};

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  const sql = getSql();
  const owner = await createTestUserSession("+994519333444");
  const [cat] = await sql<{ id: string }[]>`select id from categories where code = 'CAR'`;
  const [brand] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('SeoBrand', 'seo-brand') returning id
  `;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand!.id}, ${cat!.id})`;
  const [model] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    values (${brand!.id}, ${cat!.id}, 'SeoModel', 'seo-model') returning id
  `;
  const [city] = await sql<{ id: string }[]>`
    insert into cities (name_az, slug) values ('SeoBakı', 'seo-baki') returning id
  `;
  async function insertListing(
    key: string,
    status: string,
    options: { expired?: boolean; deactivated?: boolean } = {},
  ) {
    const [row] = await sql<{ public_id: string }[]>`
      insert into listings (owner_id, category_id, brand_id, model_id, city_id, year,
        price_minor, mileage, description, contact_phone_e164, seller_name,
        status, published_at, current_expires_at, seller_deactivated_at)
      values (${owner.userId}, ${cat!.id}, ${brand!.id}, ${model!.id}, ${city!.id}, 2020,
        900000, 10000, 'Seo təsvir', '+994501110000', 'Seo Seller',
        ${status},
        ${status === "DRAFT" ? null : new Date()},
        ${options.expired ? new Date(Date.now() - 86_400_000) : new Date(Date.now() + 86_400_000)},
        ${options.deactivated ? new Date() : null})
      returning public_id::text as public_id
    `;
    ids[key] = row!.public_id;
  }
  await insertListing("active", "ACTIVE");
  await insertListing("expiredActive", "ACTIVE", { expired: true });
  await insertListing("deactivated", "ACTIVE", { deactivated: true });
  await insertListing("draft", "DRAFT");
  await insertListing("pending", "PENDING_MODERATION");
  await insertListing("suspended", "SUSPENDED");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeSql();
});

describe("sitemap visibility", () => {
  it("the repository query returns exactly the publicly visible listing set", async () => {
    const rows = await listSitemapListings(getSql());
    const publicIds = new Set(rows.map((r) => r.public_id));
    expect(publicIds.has(ids.active!)).toBe(true);
    for (const key of ["expiredActive", "deactivated", "draft", "pending", "suspended"]) {
      expect(publicIds.has(ids[key]!), key).toBe(false);
    }
    for (const row of rows) expect(row.updated_at).toBeInstanceOf(Date);
  });

  it("the sitemap route emits static pages plus only public listings on the canonical origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.avtosh.az");
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls[0]).toBe("https://www.avtosh.az/");
    expect(urls).toContain("https://www.avtosh.az/elanlar?category=CAR");
    expect(urls).toContain(`https://www.avtosh.az/elan/${ids.active}`);
    for (const key of ["expiredActive", "deactivated", "draft", "pending", "suspended"]) {
      expect(urls, key).not.toContain(`https://www.avtosh.az/elan/${ids[key]}`);
    }
    for (const url of urls) expect(url.startsWith("https://www.avtosh.az/")).toBe(true);
  });
});
