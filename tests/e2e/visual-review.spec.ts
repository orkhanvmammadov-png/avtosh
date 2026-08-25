import { test } from "@playwright/test";
import { seed } from "./helpers";

/**
 * Deterministic screenshots for human design review (artifacts only —
 * written to test-results/visual-review/, which is gitignored).
 * Not a pixel-diff regression system.
 */
const OUT = "test-results/visual-review";

test.describe("visual review artifacts", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
  });

  const shots: { name: string; width: number; height: number; path: (s: ReturnType<typeof seed>) => string; before?: (page: import("@playwright/test").Page) => Promise<void> }[] = [
    { name: "home-mobile-390", width: 390, height: 844, path: () => "/" },
    { name: "home-tablet-768", width: 768, height: 1024, path: () => "/" },
    { name: "home-desktop-1440", width: 1440, height: 900, path: () => "/" },
    { name: "search-mobile-390", width: 390, height: 844, path: () => "/elanlar?category=CAR" },
    { name: "search-desktop-1440", width: 1440, height: 900, path: () => "/elanlar?category=CAR" },
    {
      name: "search-mobile-390-filters-open", width: 390, height: 844, path: () => "/elanlar?category=CAR",
      before: async (page) => { await page.getByTestId("filters-open").click(); await page.getByTestId("filters-close").waitFor(); },
    },
    { name: "detail-mobile-390", width: 390, height: 844, path: (s) => `/elan/${s.activeCar}` },
    { name: "detail-desktop-1440", width: 1440, height: 900, path: (s) => `/elan/${s.activeCar}` },
    { name: "detail-sold-desktop-1440", width: 1440, height: 900, path: (s) => `/elan/${s.sold}` },
  ];

  for (const shot of shots) {
    test(shot.name, async ({ page }) => {
      await page.setViewportSize({ width: shot.width, height: shot.height });
      await page.goto(shot.path(seed()));
      await page.waitForLoadState("networkidle");
      if (shot.before) await shot.before(page);
      await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: !shot.name.includes("filters-open") });
    });
  }
});
