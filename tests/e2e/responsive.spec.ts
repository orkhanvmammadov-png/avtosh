import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";

const WIDTHS = [360, 390, 768, 1024, 1200, 1440];

test.describe("Responsive layout invariants", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "runs once with explicit viewports");
  });

  for (const width of WIDTHS) {
    test(`no overflow and key controls available at ${width}px`, async ({ page }) => {
      const s = seed();
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expectNoHorizontalOverflow(page);
      await expect(page.getByTestId("home-search-submit")).toBeVisible();
      if (width < 768) await expect(page.getByTestId("mobile-menu-button")).toBeVisible();
      else await expect(page.getByRole("navigation", { name: "Əsas naviqasiya" })).toBeVisible();

      await page.goto("/elanlar?category=CAR");
      await expectNoHorizontalOverflow(page);
      // Phase 4.17O.6: unified search card at every width — no sidebar.
      await expect(page.getByTestId("home-advanced-toggle")).toBeVisible();
      await expect(page.getByTestId("filters-desktop")).toHaveCount(0);
      await expect(page.getByTestId("sort-select")).toBeVisible();
      const card = page.getByTestId("listing-card").first();
      // approved design card imagery: 16:10 mobile, 16:11 at md+
      const box = await card.locator(".aspect-gallery").first().boundingBox();
      expect(box).not.toBeNull();
      const expectedRatio = width < 768 ? 16 / 10 : 16 / 11;
      expect(Math.abs((box!.width / box!.height) - expectedRatio)).toBeLessThan(0.05);

      await page.goto(`/elan/${s.activeCar}`);
      await expectNoHorizontalOverflow(page);
      await expect(page.getByTestId("contact-reveal")).toBeVisible();
      await expect(page.getByTestId("detail-price")).toBeVisible();
    });
  }
});
