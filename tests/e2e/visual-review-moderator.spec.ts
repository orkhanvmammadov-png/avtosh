import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { seed } from "./helpers";
import { loginAs } from "./auth-helpers";
import {
  bumpListingRevision,
  claimListingAs,
  insertListingFixture,
} from "./seller-helpers";

/**
 * Moderator-portal screenshots for human design review (artifacts
 * only — test-results/visual-review/ is gitignored). Serial: earlier
 * fixtures feed later shots.
 */
const OUT = "test-results/visual-review";
const MOD_PHONE = "+994508890004";
const RIVAL_PHONE = "+994508890005";
const SELLER_PHONE = "+994508890006";

let reviewListingId = "";
let rivalListingId = "";
let activeListingId = "";

test.describe.configure({ mode: "serial" });

test.describe("moderator visual review artifacts", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
    await loginAs(context, MOD_PHONE, { roles: ["MODERATOR"] });
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

  test("queue and review detail", async ({ page }) => {
    const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
    const [sellerRow] = await sql`
      insert into users (phone_e164) values (${SELLER_PHONE})
      on conflict (phone_e164) do update set last_login_at = now() returning id
    `;
    await sql`insert into user_roles (user_id, role_id) select ${sellerRow.id}, id from roles where code = 'USER' on conflict do nothing`;
    await sql.end();
    const sellerId = sellerRow.id as string;
    reviewListingId = (await insertListingFixture(sellerId, { status: "PENDING_MODERATION", complete: true, images: 3 })).id;
    rivalListingId = (await insertListingFixture(sellerId, { status: "PENDING_MODERATION", complete: true, images: 0 })).id;
    activeListingId = (await insertListingFixture(sellerId, { status: "ACTIVE", complete: true, images: 3 })).id;
    await shootBothWidths(page, "moderator-queue", "/moderator/elanlar");
    await shootBothWidths(page, "moderator-review", `/moderator/elanlar/${reviewListingId}`);
  });

  test("claimed-by-me with approve confirmation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/moderator/elanlar/${reviewListingId}`);
    await page.getByTestId("claim-button").click();
    await expect(page.getByTestId("claim-state")).toHaveAttribute("data-claim", "mine");
    await page.screenshot({ path: `${OUT}/moderator-claimed-by-me-desktop-1440.png`, fullPage: false });
    await page.getByTestId("action-approve").click();
    await expect(page.getByTestId("decision-confirm")).toBeVisible();
    await page.screenshot({ path: `${OUT}/moderator-approve-confirm-desktop-1440.png`, fullPage: false });
    await page.getByTestId("decision-cancel").click();
  });

  test("correction form", async ({ page }) => {
    await shootBothWidths(page, "moderator-correction-form", `/moderator/elanlar/${reviewListingId}`, async (p) => {
      await p.getByTestId("action-correction").click();
      await p.getByTestId("decision-note").fill("Şəkillər aydın deyil, yenidən çəkin.");
      await expect(p.getByTestId("decision-confirm")).toBeVisible();
    });
  });

  test("reject form and claimed-by-other state", async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/moderator/elanlar/${reviewListingId}`);
    await page.getByTestId("action-reject").click();
    await expect(page.getByTestId("decision-confirm")).toBeVisible();
    await page.screenshot({ path: `${OUT}/moderator-reject-form-desktop-1440.png`, fullPage: false });
    // rival moderator holds the claim on the other listing
    const rival = await loginAs(context, RIVAL_PHONE, { roles: ["MODERATOR"] });
    await claimListingAs(rivalListingId, rival.userId);
    await loginAs(context, MOD_PHONE, { roles: ["MODERATOR"] });
    await page.goto(`/moderator/elanlar/${rivalListingId}`);
    await expect(page.getByTestId("claim-state")).toHaveAttribute("data-claim", "other");
    await page.screenshot({ path: `${OUT}/moderator-claimed-by-other-desktop-1440.png`, fullPage: false });
  });

  test("stale conflict, history, suspension", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/moderator/elanlar/${reviewListingId}`);
    await page.reload();
    await bumpListingRevision(reviewListingId);
    await page.getByTestId("action-correction").click();
    await page.getByTestId("decision-note").fill("Qeyd");
    await page.getByTestId("decision-submit").click();
    await expect(page.getByTestId("decision-conflict")).toBeVisible();
    await page.screenshot({ path: `${OUT}/moderator-stale-conflict-desktop-1440.png`, fullPage: false });
    await page.getByTestId("conflict-refresh").click();
    // complete a correction so history has an entry
    await page.getByTestId("action-correction").click();
    await page.getByTestId("decision-note").fill("Şəkilləri yeniləyin.");
    await page.getByTestId("decision-submit").click();
    await expect(page.getByTestId("decision-done")).toBeVisible();
    await shootBothWidths(page, "moderator-history", `/moderator/elanlar/${reviewListingId}`);
    // suspension of an ACTIVE listing
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/moderator/elanlar/${activeListingId}`);
    await page.getByTestId("action-suspend").click();
    await expect(page.getByTestId("decision-confirm")).toBeVisible();
    await page.screenshot({ path: `${OUT}/moderator-suspend-confirm-desktop-1440.png`, fullPage: false });
    await page.getByTestId("decision-submit").click();
    await expect(page.getByTestId("decision-done")).toBeVisible();
    await page.reload();
    await page.screenshot({ path: `${OUT}/moderator-suspended-state-desktop-1440.png`, fullPage: false });
  });
});
