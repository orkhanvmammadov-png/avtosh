import { expect, test } from "@playwright/test";
import { seed } from "./helpers";

/**
 * Phase 4.17O.2 — deterministic captures of the inline Home advanced
 * search (artifacts only; test-results/visual-review is gitignored).
 */
const OUT = "test-results/visual-review";

test.describe("home advanced search visual artifacts", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
  });

  for (const [name, width, height, expand] of [
    ["home-advanced-390-collapsed", 390, 844, false],
    ["home-advanced-390-expanded", 390, 844, true],
    ["home-advanced-768-expanded", 768, 1024, true],
    ["home-advanced-1024-expanded", 1024, 800, true],
    ["home-advanced-1440-collapsed", 1440, 900, false],
    ["home-advanced-1440-expanded", 1440, 900, true],
  ] as const) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      if (expand) {
        await page.getByTestId("home-advanced-toggle").click();
        await expect(page.getByTestId("home-advanced-panel")).toBeVisible();
      }
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    });
  }

  test("home-advanced-1440-selected", async ({ page }) => {
    const s = seed();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByTestId("home-advanced-toggle").click();
    await page.getByTestId("home-brand").selectOption(s.toyotaBrandId);
    await page.getByTestId("home-adv-city").selectOption(s.bakuCityId);
    await page.getByTestId("home-adv-price-min").fill("5000");
    await page.getByTestId("home-adv-year-min").selectOption("2015");
    await page.getByTestId("home-adv-credit").check();
    await page.screenshot({ path: `${OUT}/home-advanced-1440-selected.png`, fullPage: true });
  });
});
