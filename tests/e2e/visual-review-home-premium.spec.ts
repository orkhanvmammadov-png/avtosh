import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { expectNoHorizontalOverflow, seed } from "./helpers";

/**
 * Phase 4.17O.5 — Home Premium feed consolidation captures + smoke
 * (artifacts land in the gitignored test-results/visual-review/).
 * Premium is temporarily extended past one page (same promote/restore
 * pattern as the Home zero-state test) so the continuation state is
 * real, then fully restored.
 */
const OUT = "test-results/visual-review";
const WIDTHS: [number, number][] = [
  [1440, 900],
  [1024, 800],
  [768, 1024],
  [390, 844],
];

test.describe("home premium feed visual review", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
  });

  test("o5-home-premium-captures", async ({ page }) => {
    test.setTimeout(120_000);
    const s = seed();
    const sql = postgres(s.databaseUrl, { prepare: false, max: 1 });
    try {
      await sql`
        with candidates as (
          select l.id from listings l
          where l.status = 'ACTIVE' and l.current_expires_at > now()
            and not exists (select 1 from listing_promotions p where p.listing_id = l.id and p.type = 'PREMIUM')
        ), pays as (
          insert into payments (user_id, listing_id, type, amount_minor, idempotency_key, status)
          select ${s.sellerId}, c.id, 'PREMIUM', 0, 'o5cap:' || c.id, 'CREATED' from candidates c
          returning id, listing_id
        )
        insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
        select p.listing_id, 'PREMIUM', p.id, now() - interval '2 hours', now() + interval '7 days', 'ACTIVE', 7, 0 from pays p
      `;
      for (const [width, height] of WIDTHS) {
        await page.setViewportSize({ width, height });
        await page.goto("/");
        await expect(page.getByTestId("premium-section")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Yeni elanlar" })).toHaveCount(0);
        await expect(page.getByTestId("premium-load-more")).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: `${OUT}/o5-premium-${width}.png`, fullPage: true });
        if (width === 1440 || width === 390) {
          await page.getByTestId("premium-load-more").scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${OUT}/o5-premium-continuation-${width}.png` });
        }
      }
    } finally {
      await sql`delete from listing_promotions where payment_id in (select id from payments where idempotency_key like 'o5cap:%')`;
      await sql`delete from payments where idempotency_key like 'o5cap:%'`;
      await sql.end();
    }
  });
});
