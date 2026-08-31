import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { seed } from "./helpers";
import { loginAs } from "./auth-helpers";
import { insertListingFixture } from "./seller-helpers";

/**
 * Coverage the Phase 4.17 audit found missing: auth (phone + OTP),
 * favorites, and representative 768/1024 layouts. Artifacts only —
 * test-results/visual-review/ is gitignored.
 */
const OUT = "test-results/visual-review";
const FAVORITES_PHONE = "+994508890015";
const SELLER_PHONE = "+994508890016";
const OTP_PHONE = "+994508890017";

test.describe.configure({ mode: "serial" });

test.describe("extra visual review artifacts", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
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

  test("login phone step and OTP step", async ({ page }) => {
    await shootBothWidths(page, "auth-login", "/giris");
    // real OTP request against the dev provider → verification step
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/giris");
    await page.getByTestId("login-phone").fill(OTP_PHONE);
    await page.getByTestId("login-request").click();
    await expect(page.getByTestId("login-otp")).toBeVisible();
    await page.screenshot({ path: `${OUT}/auth-otp-desktop-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${OUT}/auth-otp-mobile-390.png`, fullPage: true });
  });

  test("favorites page with saved listings", async ({ page, context }) => {
    const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
    const [sellerRow] = await sql`
      insert into users (phone_e164) values (${SELLER_PHONE})
      on conflict (phone_e164) do update set last_login_at = now() returning id
    `;
    const listing = await insertListingFixture(sellerRow.id as string, { status: "ACTIVE", images: 3 });
    const { userId } = await loginAs(context, FAVORITES_PHONE);
    await sql`
      insert into favorites (user_id, listing_id)
      values (${userId}, ${listing.id})
      on conflict do nothing
    `;
    await sql.end();
    await shootBothWidths(page, "favorites", "/profil/secilmisler");
  });

  test("search and admin at 768 and 1024", async ({ page, context }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/elanlar?category=CAR");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/search-tablet-768.png`, fullPage: true });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/search-laptop-1024.png`, fullPage: true });

    await loginAs(context, "+994508890007", { roles: ["ADMIN"] });
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/admin-dashboard-tablet-768.png`, fullPage: true });
    await page.goto("/admin/elanlar");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/admin-listings-tablet-768.png`, fullPage: true });
  });
});
