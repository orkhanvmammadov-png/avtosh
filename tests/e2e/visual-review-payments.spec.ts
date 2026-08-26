import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./auth-helpers";
import { insertListingFixture, paymentInfoForListing } from "./seller-helpers";

/**
 * Payment-experience screenshots for human design review (artifacts
 * only — test-results/visual-review/ is gitignored). Uses the fake
 * HPP; no card-entry pages are ever captured. Serial: flows prepare
 * the states later shots reuse.
 */
const OUT = "test-results/visual-review";
const PHONE = "+994508890002";

test.describe.configure({ mode: "serial" });

test.describe("payment visual review artifacts", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
    await loginAs(context, PHONE);
  });

  async function shootBothWidths(page: Page, name: string, url: string) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/${name}-desktop-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/${name}-mobile-390.png`, fullPage: true });
  }

  async function newPaidFixture(context: import("@playwright/test").BrowserContext) {
    const { userId } = await loginAs(context, PHONE);
    return insertListingFixture(userId, {
      status: "PAYMENT_REQUIRED",
      complete: true,
      images: 3,
      feeMinor: 200,
    });
  }

  test("checkout initiation loading state", async ({ page, context }) => {
    const fixture = await newPaidFixture(context);
    await page.setViewportSize({ width: 1440, height: 900 });
    // hold the checkout response briefly so the busy state is capturable
    await page.route("**/payment/checkout", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await page.goto(`/elan-yerlesdir/${fixture.id}`);
    await expect(page.getByTestId("pay-button")).toBeVisible();
    await page.getByTestId("pay-button").click();
    await expect(page.getByTestId("pay-button")).toBeDisabled();
    await page.screenshot({ path: `${OUT}/payment-checkout-loading-desktop-1440.png`, fullPage: true });
    await page.unroute("**/payment/checkout");
  });

  test("payment success state", async ({ page, context }) => {
    const fixture = await newPaidFixture(context);
    await page.goto(`/elan-yerlesdir/${fixture.id}`);
    await page.getByTestId("pay-button").click();
    await page.waitForURL(/dev-kapital\/hpp/);
    await page.getByTestId("fake-hpp-pay").click();
    await page.waitForURL(/odenis\/kapital\/netice/);
    await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
    await shootBothWidths(page, "payment-success", page.url());
  });

  test("payment pending / unconfirmed state", async ({ page, context }) => {
    const fixture = await newPaidFixture(context);
    await page.goto(`/elan-yerlesdir/${fixture.id}`);
    await page.getByTestId("pay-button").click();
    await page.waitForURL(/dev-kapital\/hpp/);
    const info = await paymentInfoForListing(fixture.id);
    await shootBothWidths(
      page,
      "payment-pending",
      `/odenis/kapital/netice?ID=${info.providerOrderId}&STATUS=FullyPaid`,
    );
  });

  test("payment failed / declined state", async ({ page, context }) => {
    const fixture = await newPaidFixture(context);
    await page.goto(`/elan-yerlesdir/${fixture.id}`);
    await page.getByTestId("pay-button").click();
    await page.waitForURL(/dev-kapital\/hpp/);
    await page.getByTestId("fake-hpp-decline").click();
    await page.waitForURL(/odenis\/kapital\/netice/);
    await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "RETRYABLE");
    await shootBothWidths(page, "payment-failed", page.url());
  });
});
