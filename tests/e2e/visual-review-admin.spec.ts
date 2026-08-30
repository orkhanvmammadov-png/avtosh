import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { seed } from "./helpers";
import { loginAs } from "./auth-helpers";
import { insertListingFixture } from "./seller-helpers";

/**
 * Admin-panel screenshots for human design review (artifacts only —
 * test-results/visual-review/ is gitignored). Serial: earlier
 * fixtures feed later shots.
 */
const OUT = "test-results/visual-review";
const ADMIN_PHONE = "+994508890007";
const SELLER_PHONE = "+994508890008";
const BLOCK_TARGET_PHONE = "+994508890009";

let sellerId = "";
let blockTargetId = "";
let suspendedListingId = "";
let paymentId = "";

test.describe.configure({ mode: "serial" });

test.describe("admin visual review artifacts", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
    await loginAs(context, ADMIN_PHONE, { roles: ["ADMIN"] });
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

  test("dashboard, users, user detail, block flow", async ({ page }) => {
    const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
    for (const phone of [SELLER_PHONE, BLOCK_TARGET_PHONE]) {
      const [row] = await sql`
        insert into users (phone_e164) values (${phone})
        on conflict (phone_e164) do update set last_login_at = now() returning id
      `;
      await sql`insert into user_roles (user_id, role_id) select ${row.id}, id from roles where code = 'USER' on conflict do nothing`;
      if (phone === SELLER_PHONE) sellerId = row.id as string;
      else blockTargetId = row.id as string;
    }
    const active = await insertListingFixture(sellerId, { status: "ACTIVE", complete: true, images: 3 });
    suspendedListingId = (await insertListingFixture(sellerId, { status: "SUSPENDED", complete: true, images: 3 })).id;
    await insertListingFixture(sellerId, { status: "PENDING_MODERATION", complete: true, images: 0 });
    await sql`
      insert into listing_reports (listing_id, reason_code, note, status)
      values (${active.id}, 'FRAUD_SUSPECTED', 'Qiymət real deyil, satıcı fərqli məbləğ istəyir.', 'OPEN')
    `;
    const [payment] = await sql`
      insert into payments (user_id, listing_id, type, amount_minor, currency, idempotency_key, status, provider)
      values (${sellerId}, ${active.id}, 'PREMIUM', 500, 'AZN', ${`visual:${randomUUID()}`}, 'PENDING', 'KAPITAL')
      returning id
    `;
    paymentId = payment.id as string;
    await sql`
      insert into payment_provider_attempts (payment_id, provider, provider_order_id, provider_status)
      values (${paymentId}, 'KAPITAL', ${`vis-${randomUUID().slice(0, 8)}`}, 'Preparing')
    `;
    await sql.end();

    await shootBothWidths(page, "admin-dashboard", "/admin");
    await shootBothWidths(page, "admin-users", `/admin/istifadeciler?phone=${encodeURIComponent("+99450889")}`);
    await shootBothWidths(page, "admin-user-detail", `/admin/istifadeciler/${sellerId}`);

    // deliberate confirmation for the block command, then the blocked state
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/admin/istifadeciler/${blockTargetId}`);
    await page.getByTestId("user-block").click();
    await page.getByTestId("user-block-reason").fill("Şikayətlər üzrə yoxlama");
    await expect(page.getByTestId("user-block-confirm")).toBeVisible();
    await page.screenshot({ path: `${OUT}/admin-block-confirm-desktop-1440.png`, fullPage: false });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/block")),
      page.getByTestId("user-block-submit").click(),
    ]);
    await expect(page.getByTestId("user-status")).toContainText("Bloklanıb");
    await page.screenshot({ path: `${OUT}/admin-user-blocked-desktop-1440.png`, fullPage: false });
  });

  test("staff, listings, listing detail with restore command", async ({ page }) => {
    await shootBothWidths(page, "admin-staff", "/admin/emekdaslar");
    await shootBothWidths(page, "admin-listings", "/admin/elanlar?status=SUSPENDED");
    await shootBothWidths(page, "admin-listing-detail", `/admin/elanlar/${suspendedListingId}`, async (p) => {
      await expect(p.getByTestId("listing-unsuspend")).toBeVisible();
    });
  });

  test("payments list and detail", async ({ page }) => {
    await shootBothWidths(page, "admin-payments", "/admin/odenisler");
    await shootBothWidths(page, "admin-payment-detail", `/admin/odenisler/${paymentId}`, async (p) => {
      await expect(p.getByTestId("refund-blocked")).toBeVisible();
    });
  });

  test("packages with price edit and deactivation confirm", async ({ page }) => {
    await shootBothWidths(page, "admin-packages", "/admin/tesviq-paketleri");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/tesviq-paketleri");
    const row = page.locator('[data-package="PREMIUM-7"]');
    await row.getByTestId("pkg-price-input").fill("12");
    await page.screenshot({ path: `${OUT}/admin-package-price-edit-desktop-1440.png`, fullPage: false });
    await row.getByTestId("pkg-deactivate").click();
    await expect(row.getByTestId("pkg-confirm")).toBeVisible();
    await page.screenshot({ path: `${OUT}/admin-package-confirm-desktop-1440.png`, fullPage: false });
  });

  test("settings, reports, audit", async ({ page }) => {
    await shootBothWidths(page, "admin-settings", "/admin/tenzimlemeler");
    await shootBothWidths(page, "admin-reports", "/admin/hesabatlar");
    await shootBothWidths(page, "admin-audit", "/admin/audit");
  });
});
