import { expect, test } from "@playwright/test";
import { seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import { insertListingFixture } from "./seller-helpers";

/**
 * Phase 4.17O.2 — deterministic captures for owner UAT (artifacts
 * only; test-results/visual-review is gitignored).
 */
const OUT = "test-results/visual-review";

async function expandHome(page: import("@playwright/test").Page) {
  await page.getByTestId("home-advanced-toggle").click();
  await expect(page.getByTestId("home-advanced-panel")).toBeVisible();
}

test.describe("advanced search visual artifacts", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
  });

  for (const [name, width, height, expand] of [
    ["asv2-home-390-collapsed", 390, 844, false],
    ["asv2-home-390-expanded", 390, 844, true],
    ["asv2-home-768-expanded", 768, 1024, true],
    ["asv2-home-1024-expanded", 1024, 800, true],
    ["asv2-home-1440-collapsed", 1440, 900, false],
    ["asv2-home-1440-expanded", 1440, 900, true],
  ] as const) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      if (expand) await expandHome(page);
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    });
  }

  test("asv2-home-1440-selected + color panel with swatches", async ({ page }) => {
    const s = seed();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expandHome(page);
    await page.getByTestId("home-brand").selectOption(s.toyotaBrandId);
    await page.getByTestId("home-adv-city").selectOption(s.bakuCityId);
    await page.getByTestId("home-adv-price-min").fill("27350");
    await page.getByTestId("home-adv-year-min").selectOption("2015");
    await page.getByTestId("home-adv-engine-min").selectOption("1000");
    await page.getByTestId("home-adv-fuel_type-toggle").click();
    await page.getByTestId("home-adv-fuel_type-opt-PETROL").check();
    await page.getByTestId("home-adv-fuel_type-opt-HYBRID").check();
    await page.getByTestId("home-adv-fuel_type-toggle").click();
    await page.getByTestId("home-adv-no-accident").check();
    await page.getByTestId("home-adv-not-repainted").check();
    await page.screenshot({ path: `${OUT}/asv2-home-1440-selected.png`, fullPage: true });
    // color multi-select open with circular swatches
    await page.getByTestId("home-adv-color-toggle").click();
    await expect(page.getByTestId("home-adv-color-opt-BLACK")).toBeVisible();
    await page.screenshot({ path: `${OUT}/asv2-color-swatches-open-1440.png`, fullPage: true });
  });

  for (const [name, width, height] of [
    ["asv2-search-390-multi", 390, 844],
    ["asv2-search-1024-multi", 1024, 800],
    ["asv2-search-1440-multi", 1440, 900],
  ] as const) {
    test(name, async ({ page }) => {
      const s = seed();
      await page.setViewportSize({ width, height });
      await page.goto(
        `/elanlar?category=CAR&city_id=${s.bakuCityId}&year_min=2015&no_accident=true&not_repainted=true&engine_cc_min=1000`,
      );
      await page.waitForLoadState("networkidle");
      if (width < 1024) {
        await page.getByTestId("filters-open").click();
        await expect(page.getByTestId("filters-drawer")).toBeVisible();
      }
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: width >= 1024 });
    });
  }

  test("asv2-seller-condition-fields-1440", async ({ page, context }) => {
    await loginAs(context, testPhone("desktop", 46));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/elan-yerlesdir");
    await page.getByTestId("create-category-CAR").check();
    await page.getByTestId("create-listing-button").click();
    await page.waitForURL(/\/elan-yerlesdir\/[0-9a-f-]{36}$/);
    await page.getByTestId("wizard-step-2").click();
    await expect(page.getByTestId("wizard-no-accident")).toBeVisible();
    await page.screenshot({ path: `${OUT}/asv2-seller-condition-fields-1440.png`, fullPage: true });
  });

  test("asv2-detail-condition-claims-1440", async ({ page, context }) => {
    const { userId } = await loginAs(context, testPhone("desktop", 47));
    const claimed = await insertListingFixture(userId, {
      status: "ACTIVE", complete: true, images: 1, noAccident: true, notRepainted: true,
    });
    await context.clearCookies();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/elan/${claimed.publicId}`);
    await expect(page.getByTestId("specs")).toContainText("Vuruğu yoxdur");
    await page.screenshot({ path: `${OUT}/asv2-detail-condition-claims-1440.png`, fullPage: true });
  });

  test("asv2-moderator-condition-review-1440", async ({ page, context }) => {
    const seller = await loginAs(context, testPhone("desktop", 48));
    const fixture = await insertListingFixture(seller.userId, {
      status: "PENDING_MODERATION", complete: true, images: 1, noAccident: true,
    });
    await context.clearCookies();
    await loginAs(context, testPhone("desktop", 49), { roles: ["MODERATOR"] });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/moderator/elanlar/${fixture.id}`);
    await expect(page.getByTestId("review-specs")).toContainText("Qeyd edilib");
    await page.screenshot({ path: `${OUT}/asv2-moderator-condition-review-1440.png`, fullPage: true });
  });
});
