import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { seed } from "./helpers";
import { loginAs } from "./auth-helpers";
import { insertListingFixture } from "./seller-helpers";

/**
 * Phase 4.16 screenshots for human design review (artifacts only —
 * test-results/visual-review/ is gitignored). Serial: earlier
 * fixtures feed later shots.
 */
const OUT = "test-results/visual-review";
const SELLER_PHONE = "+994508890013";
const REPORTER_SELLER_PHONE = "+994508890014";

let expiredListingId = "";
let reportPublicId = "";

test.describe.configure({ mode: "serial" });

test.describe("lifecycle visual review artifacts", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
    await loginAs(context, SELLER_PHONE);
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

  test("expired card and renewal confirmation", async ({ page, context }) => {
    const { userId } = await loginAs(context, SELLER_PHONE);
    const fixture = await insertListingFixture(userId, { status: "ACTIVE", images: 3 });
    expiredListingId = fixture.id;
    const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
    await sql`
      update listings set status = 'EXPIRED', current_expires_at = now() - interval '3 days'
      where id = ${fixture.id}
    `;
    await sql`
      insert into listing_periods (listing_id, period_number, source, starts_at, ends_at, status)
      values (${fixture.id}, 1, 'INITIAL', now() - interval '33 days', now() - interval '3 days', 'EXPIRED')
    `;
    await sql.end();
    await shootBothWidths(page, "lifecycle-expired-my-listing", "/profil/elanlar");
    await shootBothWidths(page, "lifecycle-renewal-confirm", `/profil/elanlar/${fixture.id}/yenile`);
  });

  test("renewal checkout, success, renewed state", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/profil/elanlar/${expiredListingId}/yenile`);
    await page.getByTestId("renewal-pay").click();
    await page.waitForURL(/\/api\/dev-kapital\/hpp\?/);
    await page.screenshot({ path: `${OUT}/lifecycle-renewal-checkout-desktop-1440.png`, fullPage: true });
    await page.getByTestId("fake-hpp-pay").click();
    await page.waitForURL(/\/odenis\/kapital\/netice\?/);
    await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
    await page.screenshot({ path: `${OUT}/lifecycle-renewal-success-desktop-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
    await page.screenshot({ path: `${OUT}/lifecycle-renewal-success-mobile-390.png`, fullPage: true });
    await shootBothWidths(page, "lifecycle-renewed-my-listing", "/profil/elanlar");
  });

  test("report form, submitted, rate-limited", async ({ page }) => {
    const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
    const [sellerRow] = await sql`
      insert into users (phone_e164) values (${REPORTER_SELLER_PHONE})
      on conflict (phone_e164) do update set last_login_at = now() returning id
    `;
    const fixture = await insertListingFixture(sellerRow.id as string, { status: "ACTIVE", images: 3 });
    reportPublicId = fixture.publicId;
    await sql.end();

    await shootBothWidths(page, "lifecycle-report-form", `/elan/${reportPublicId}`, async (p) => {
      await p.getByTestId("report-open").click();
      await p.getByTestId("report-note").fill("Elan məlumatları real vəziyyətlə uyğun gəlmir.");
      await expect(p.getByTestId("report-form")).toBeVisible();
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/elan/${reportPublicId}`);
    await page.getByTestId("report-open").click();
    await page.getByTestId("report-reason").selectOption("WRONG_INFORMATION");
    await page.getByTestId("report-submit").click();
    await expect(page.getByTestId("report-success")).toBeVisible();
    await page.screenshot({ path: `${OUT}/lifecycle-report-submitted-desktop-1440.png`, fullPage: false });

    // second same-source attempt → rate-limited state
    await page.reload();
    await page.getByTestId("report-open").click();
    await page.getByTestId("report-submit").click();
    await expect(page.getByTestId("report-rate-limited")).toBeVisible();
    await page.screenshot({ path: `${OUT}/lifecycle-report-rate-limited-desktop-1440.png`, fullPage: false });
  });
});
