import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, pickBrand } from "./helpers";

/**
 * Mobile focus-zoom regression guard: iOS Safari auto-zooms the page
 * when a focused text input or select computes under 16px, so every
 * visible focusable text-entry control on the search surfaces must
 * be >= 16px at mobile widths (and keep the approved 13px at desk).
 * Chromium cannot emulate the zoom itself — this pins the trigger
 * condition; the zoom's absence is confirmed by physical-iPhone UAT.
 */

const MOBILE_WIDTHS = [360, 390];
const FOCUSABLE = 'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select';

async function assertVisibleControlFonts(page: Page, minPx: number, label: string): Promise<void> {
  const sizes = await page.evaluate((selector) => {
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
      })
      .map((el) => ({
        id: el.getAttribute("data-testid") ?? el.id ?? el.getAttribute("name") ?? el.tagName,
        px: parseFloat(getComputedStyle(el).fontSize),
      }));
  }, FOCUSABLE);
  expect(sizes.length, `${label}: no focusable controls found`).toBeGreaterThan(0);
  for (const { id, px } of sizes) {
    expect(px, `${label}: ${id} computes ${px}px`).toBeGreaterThanOrEqual(minPx);
  }
}

test.describe("mobile search controls never trigger iOS focus zoom", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "runs once with explicit viewports");
  });

  for (const width of MOBILE_WIDTHS) {
    test(`all visible search inputs/selects are >= 16px at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      for (const path of ["/", "/elanlar?category=CAR", "/elanlar?category=MOTORCYCLE"]) {
        await page.goto(path);
        await expect(page.locator("#home-brand")).toBeVisible();
        // Expand the advanced zone so year/engine/mileage/price/city
        // and category-specific selects are measured too.
        const toggle = page.getByTestId("home-advanced-toggle");
        if (await toggle.isVisible()) await toggle.click();
        await expect(page.getByTestId("home-adv-city")).toBeVisible();
        await assertVisibleControlFonts(page, 16, `${path}@${width}`);
      }
    });
  }

  test("brand → model family expansion → variant selection stays inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await pickBrand(page, "Toyota");
    await expectNoHorizontalOverflow(page);
    await page.getByTestId("home-model-toggle").click();
    await expect(page.getByTestId("home-model-panel")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByTestId("home-model-expand-tree-family").click();
    await page.getByTestId("home-model-variant-tree-100").check();
    await expectNoHorizontalOverflow(page);
    // The open panel itself must fit the 375px viewport.
    const panel = await page.getByTestId("home-model-panel").boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(375);
  });

  test("desktop typography is unchanged (13px search controls at 1440px)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const toggle = page.getByTestId("home-advanced-toggle");
    if (await toggle.isVisible()) await toggle.click();
    const brandFont = await page
      .locator("#home-brand")
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(brandFont).toBe("13px");
    const cityFont = await page
      .getByTestId("home-adv-city")
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(cityFont).toBe("13px");
  });
});
