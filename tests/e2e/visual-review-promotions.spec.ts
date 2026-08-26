import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./auth-helpers";
import { expireListingPromotions, insertListingFixture } from "./seller-helpers";

/**
 * Promotion-experience screenshots for human design review (artifacts
 * only — test-results/visual-review/ is gitignored). Fake HPP only;
 * no card-entry pages. Serial: flows prepare states later shots use.
 */
const OUT = "test-results/visual-review";
const PHONE = "+994508890003";

let listingId = "";
let publicId = "";

test.describe.configure({ mode: "serial" });

test.describe("promotion visual review artifacts", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
    await loginAs(context, PHONE);
  });

  async function shootBothWidths(page: Page, name: string, url: string, ready?: (page: Page) => Promise<void>) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    if (ready) await ready(page);
    await page.screenshot({ path: `${OUT}/${name}-desktop-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForLoadState("networkidle");
    if (ready) await ready(page);
    await page.screenshot({ path: `${OUT}/${name}-mobile-390.png`, fullPage: true });
  }

  test("active listing with promote action", async ({ page, context }) => {
    const { userId } = await loginAs(context, PHONE);
    const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
    listingId = fixture.id;
    publicId = fixture.publicId;
    await shootBothWidths(page, "promotion-my-listing-actions", "/profil/elanlar");
  });

  test("package selection — Premium", async ({ page }) => {
    await shootBothWidths(page, "promotion-packages-premium", `/profil/elanlar/${listingId}/tesviq`, async (p) => {
      await p.getByTestId("promo-package-3").check();
    });
  });

  test("checkout confirmation — Boost", async ({ page }) => {
    await shootBothWidths(page, "promotion-confirm-boost", `/profil/elanlar/${listingId}/tesviq`, async (p) => {
      await p.getByTestId("promo-type-BOOST").click();
      await p.getByTestId("promo-package-3").check();
      await expect(p.getByTestId("promo-confirmation")).toBeVisible();
    });
  });

  test("Premium payment success", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/profil/elanlar/${listingId}/tesviq`);
    await page.getByTestId("promo-package-3").check();
    await page.getByTestId("promo-pay").click();
    await page.waitForURL(/dev-kapital\/hpp/);
    await page.getByTestId("fake-hpp-pay").click();
    await page.waitForURL(/odenis\/kapital\/netice/);
    await expect(page.getByTestId("payment-result")).toContainText("Premium aktiv edildi");
    await shootBothWidths(page, "promotion-success-premium", page.url());
  });

  test("Boost payment success", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/profil/elanlar/${listingId}/tesviq`);
    await page.getByTestId("promo-type-BOOST").click();
    await page.getByTestId("promo-package-3").check();
    await page.getByTestId("promo-pay").click();
    await page.waitForURL(/dev-kapital\/hpp/);
    await page.getByTestId("fake-hpp-pay").click();
    await page.waitForURL(/odenis\/kapital\/netice/);
    await expect(page.getByTestId("payment-result")).toContainText("Boost aktiv edildi");
    await shootBothWidths(page, "promotion-success-boost", page.url());
  });

  test("owner and public views with both promotions active", async ({ page }) => {
    await shootBothWidths(page, "promotion-both-active-my-listings", "/profil/elanlar", async (p) => {
      await expect(p.getByTestId("owner-premium-until").first()).toBeVisible();
      await expect(p.getByTestId("owner-boost-until").first()).toBeVisible();
    });
    await shootBothWidths(page, "promotion-both-active-public-detail", `/elan/${publicId}`);
    await expireListingPromotions(listingId); // keep shared public specs seed-only
  });
});
