import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./auth-helpers";
import { addListingFeatures, insertListingFixture } from "./seller-helpers";

/**
 * O.13.5A visual artifacts — the moderator full-review read surfaces
 * for BOTH moderation types at the four approved widths (1440 / 1024 /
 * 768 / 390), compared by a human against
 * design_handoff_avtosh/o13_moderator_full_review_edit/. Artifacts
 * only (test-results/visual-review/ is gitignored); the LISTING_EDIT
 * fixture is produced through the real seller edit journey.
 */
const OUT = "test-results/visual-review";
const MOD_PHONE = "+994508890007";
const SELLER_PHONE = "+994508890008";
const WIDTHS: [number, number][] = [
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [390, 844],
];

let sellerId = "";
let newListingId = "";
let editListingId = "";

test.describe.configure({ mode: "serial" });

async function shootAllWidths(page: Page, name: string, url: string) {
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
  }
}

test.describe("O.13.5A full review visual artifacts", () => {
  test("NEW_LISTING full review at all approved widths", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
    const seller = await loginAs(context, SELLER_PHONE);
    sellerId = seller.userId;
    newListingId = (
      await insertListingFixture(sellerId, {
        status: "PENDING_MODERATION",
        complete: true,
        images: 3,
        noAccident: true,
      })
    ).id;
    await addListingFeatures(newListingId, ["ABS", "REAR_CAMERA", "CRUISE_CONTROL"]);
    await loginAs(context, MOD_PHONE, { roles: ["MODERATOR"] });
    await shootAllWidths(page, "o13a-new-full-review", `/moderator/elanlar/${newListingId}`);
  });

  test("LISTING_EDIT full review at all approved widths", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
    editListingId = (
      await insertListingFixture(sellerId, { status: "ACTIVE", complete: true, images: 3 })
    ).id;
    await addListingFeatures(editListingId, ["ABS"]);
    // real seller edit journey → PENDING revision
    await loginAs(context, SELLER_PHONE);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/profil/elanlar");
    await page
      .locator(`[data-testid="owner-listing-card"][data-listing-id="${editListingId}"]`)
      .getByTestId("owner-edit")
      .click();
    await page.waitForURL(/\/redakte$/);
    const sale = page.getByTestId("axin-section-sale");
    if ((await sale.getAttribute("data-state")) !== "open") {
      await sale.click();
    }
    await page.getByTestId("wizard-price").fill("27900");
    await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
    const review = page.getByTestId("axin-section-review");
    if ((await review.getAttribute("data-state")) !== "open") {
      await review.click();
    }
    await page.getByTestId("wizard-submit").click();
    await expect(page.getByTestId("edit-result")).toHaveAttribute("data-outcome", "SUBMITTED");

    await loginAs(context, MOD_PHONE, { roles: ["MODERATOR"] });
    await shootAllWidths(page, "o13a-edit-full-review", `/moderator/elanlar/${editListingId}`);
    // the collapsed current approved layer, expanded
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/moderator/elanlar/${editListingId}`);
    await page.getByTestId("edit-current-data").locator("summary").click();
    await page.screenshot({ path: `${OUT}/o13a-edit-current-layer-1440.png`, fullPage: true });
  });
});
