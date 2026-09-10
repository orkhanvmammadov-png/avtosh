import postgres from "postgres";
import { expect, test } from "@playwright/test";
import { seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import { insertListingFixture } from "./seller-helpers";

/**
 * Phase 4.17O.7 Stage A — Direction 1A 1440 captures for Owner review,
 * matching design_handoff_avtosh/o7_listing_detail/references/
 * (artifacts land in the gitignored test-results/visual-review/).
 */
const OUT = "test-results/visual-review";

test.describe("listing detail visual review (Stage A — 1440)", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
  });

  test("o7-1440-captures", async ({ page, context }) => {
    test.setTimeout(180_000);
    const s = seed();
    const { userId } = await loginAs(context, testPhone("desktop", 51));
    const rich = await insertListingFixture(userId, {
      status: "ACTIVE", complete: true, images: 9, noAccident: true, notRepainted: true,
    });
    await context.clearCookies();
    const sql = postgres(s.databaseUrl, { prepare: false, max: 1 });
    try {
      for (const type of ["PREMIUM", "BOOST"] as const) {
        await sql`
          with pay as (
            insert into payments (user_id, listing_id, type, amount_minor, idempotency_key, status, provider)
            values (${userId}, ${rich.id}, ${type}, 0, ${`o7cap:${rich.id}:${type}`}, 'SUCCESS', 'KAPITAL')
            returning id
          )
          insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
          select ${rich.id}, ${type}, pay.id, now() - interval '1 hour', now() + interval '7 days', 'ACTIVE', 7, 0 from pay
        `;
      }
      await page.setViewportSize({ width: 1440, height: 900 });

      // plain ACTIVE (seeded listing)
      await page.goto(`/elan/${s.activeCar}`);
      await expect(page.getByTestId("identity-panel")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o7-1440-active.png`, fullPage: true });

      // Premium + Boost, claims, "+n" gallery
      await page.goto(`/elan/${rich.publicId}`);
      await expect(page.getByTestId("gallery-more")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o7-1440-premium-boost.png`, fullPage: true });

      // lower content viewport shot
      await page.getByTestId("key-specs").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/o7-1440-lower-content.png` });

      // close-ups
      await page.getByTestId("gallery-main").scrollIntoViewIfNeeded();
      await page.getByTestId("gallery-next").click();
      await page.locator('[data-testid="gallery"] .hidden.md\\:block').first().screenshot({ path: `${OUT}/o7-gallery-controls.png` });
      await page.getByTestId("key-specs").screenshot({ path: `${OUT}/o7-key-specs.png` });
      await page.getByTestId("condition-claims").screenshot({ path: `${OUT}/o7-condition-claim.png` });
      await page.getByTestId("identity-panel").screenshot({ path: `${OUT}/o7-contact-cta.png` });

      // Stage B — 1024 states
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.goto(`/elan/${s.activeCar}`);
      await expect(page.getByTestId("identity-panel")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o7-1024-active.png`, fullPage: true });
      await page.goto(`/elan/${rich.publicId}`);
      await expect(page.getByTestId("gallery-more")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o7-1024-premium-boost.png`, fullPage: true });
      await page.getByTestId("contact-reveal").click();
      await expect(page.getByTestId("contact-call")).toBeVisible();
      await page.screenshot({ path: `${OUT}/o7-1024-contact-revealed.png` });

      // Stage C — 768 board states
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(`/elan/${s.activeCar}`);
      await expect(page.getByTestId("identity-panel")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o7-768-active.png`, fullPage: true });
      await page.goto(`/elan/${rich.publicId}`);
      await expect(page.getByTestId("gallery-more")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o7-768-premium-boost.png`, fullPage: true });
      await page.getByTestId("key-specs").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/o7-768-lower-content.png` });
      await page.getByTestId("identity-panel").scrollIntoViewIfNeeded();
      await page.getByTestId("contact-reveal").click();
      await expect(page.getByTestId("contact-call")).toBeVisible();
      await page.screenshot({ path: `${OUT}/o7-768-contact-revealed.png` });

      // Stage D — 390 states
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/elan/${s.activeCar}`);
      await expect(page.getByTestId("contact-card")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o7-390-active.png`, fullPage: true });
      await page.goto(`/elan/${rich.publicId}`);
      await expect(page.getByTestId("detail-price")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o7-390-premium-boost.png`, fullPage: true });
      await page.getByTestId("contact-reveal").click();
      await expect(page.getByTestId("contact-call")).toBeVisible();
      await page.screenshot({ path: `${OUT}/o7-390-contact-revealed.png` });
      await page.goto(`/elan/${s.sold}`);
      await expect(page.getByTestId("status-chip")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o7-sold.png`, fullPage: true });
      await page.goto(`/elan/${s.expired}`);
      await expect(page.getByTestId("status-chip")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o7-expired.png`, fullPage: true });
      await page.goto(`/elan/${s.motos[0]}`);
      await expect(page.getByTestId("detail-price")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o7-motorcycle.png`, fullPage: true });
    } finally {
      await sql`delete from listing_promotions where payment_id in (select id from payments where idempotency_key like 'o7cap:%')`;
      await sql`delete from payments where idempotency_key like 'o7cap:%'`;
      await sql.end();
    }
  });
});
