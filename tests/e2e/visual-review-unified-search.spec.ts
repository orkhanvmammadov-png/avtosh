import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";

/**
 * Phase 4.17O.6 — unified search & boosted results captures for Owner
 * UAT, matching design_handoff_avtosh/o6_unified_search/references/
 * state for state (artifacts land in the gitignored
 * test-results/visual-review/).
 */
const OUT = "test-results/visual-review";

async function shoot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}

test.describe("unified search visual review", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
  });

  test("o6-breakpoint-captures", async ({ page }) => {
    test.setTimeout(180_000);
    for (const [width, height] of [
      [1440, 900],
      [1024, 800],
      [768, 1024],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto("/elanlar?category=CAR");
      await expect(page.getByTestId("results-grid")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await shoot(page, `o6-${width}-collapsed`);
      await page.getByTestId("home-advanced-toggle").click();
      await expect(page.getByTestId("home-advanced-panel")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await shoot(page, `o6-${width}-expanded`);
    }
    // moto context at 390: same shell, moto-only option groups
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/elanlar?category=MOTORCYCLE");
    await page.getByTestId("home-advanced-toggle").click();
    await expect(page.getByTestId("home-adv-motorcycle_type_id")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shoot(page, "o6-390-moto-context");
  });

  test("o6-active-filters-and-badges", async ({ page }) => {
    test.setTimeout(180_000);
    const s = seed();
    const sql = postgres(s.databaseUrl, { prepare: false, max: 1 });
    try {
      // premium+boost state for the dual-badge capture (settled intent)
      await sql`
        with target as (
          select l.id from listings l where l.public_id::text = ${s.boosted[0]}
        ), pay as (
          insert into payments (user_id, listing_id, type, amount_minor, idempotency_key, status, provider)
          select ${s.sellerId}, t.id, 'PREMIUM', 0, 'o6cap:' || t.id, 'SUCCESS', 'KAPITAL' from target t
          returning id, listing_id
        )
        insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
        select p.listing_id, 'PREMIUM', p.id, now() - interval '1 hour', now() + interval '7 days', 'ACTIVE', 7, 0 from pay p
      `;
      await page.setViewportSize({ width: 1440, height: 900 });
      // realistic active-filter state built through the UI (URL-as-state)
      await page.goto("/elanlar?category=CAR");
      await page.getByTestId("home-brand").selectOption(s.toyotaBrandId);
      await page.getByTestId("home-model").selectOption(s.corollaModelId);
      await page.getByTestId("home-advanced-toggle").click();
      await page.getByTestId("home-adv-year-min").selectOption("2015");
      await page.getByTestId("home-adv-price-min").fill("10000");
      await page.getByTestId("home-adv-price-max").fill("70000");
      await page.getByTestId("home-adv-fuel_type-toggle").click();
      await page.getByTestId("home-adv-fuel_type-opt-PETROL").check();
      await page.keyboard.press("Escape");
      await page.locator('[data-testid="home-adv-submit"]:visible').first().click();
      await page.waitForURL(/fuel_type_ids=/);
      await expect(page.getByTestId("applied-filters")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await shoot(page, "o6-1440-active-filters");

      // badge close-ups from the live boost-first grid
      await page.goto("/elanlar?category=CAR");
      await expect(page.getByTestId("promoted-card").first()).toBeVisible();
      const dual = page.locator(`[data-testid="promoted-card"]:has([data-public-id="${s.boosted[0]}"])`).first();
      await expect(dual).toContainText("Premium");
      await expect(dual).toContainText("Boost");
      await dual.screenshot({ path: `${OUT}/o6-premium-boost-badges.png` });
      const single = page.locator('[data-testid="promoted-card"]', { hasNot: page.getByText("Premium") }).first();
      await single.screenshot({ path: `${OUT}/o6-boost-badge.png` });
    } finally {
      await sql`delete from listing_promotions where payment_id in (select id from payments where idempotency_key like 'o6cap:%')`;
      await sql`delete from payments where idempotency_key like 'o6cap:%'`;
      await sql.end();
    }
  });
});
