import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import {
  insertEditRevisionFixture,
  insertListingFixture,
  makeTestJpeg,
  setListingSellerLifecycle,
} from "./seller-helpers";

/**
 * O.12 Stage C — revision-backed AXIN edit mode, end to end through
 * the real auth/session, HTTP APIs and UI. RELEASE-BLOCKING invariant
 * exercised throughout: the approved public listing never changes
 * before moderator approval.
 */

async function openEdit(page: Page, listingId: string): Promise<void> {
  await page.goto("/profil/elanlar");
  await page
    .locator(`[data-testid="owner-listing-card"][data-listing-id="${listingId}"]`)
    .getByTestId("owner-edit")
    .click();
  await page.waitForURL(new RegExp(`/profil/elanlar/${listingId}/redakte$`));
  await expect(page.getByTestId("axin-flow")).toBeVisible();
}

async function saveSettled(page: Page) {
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
}

/** Opens an AXIN section card (no-op when it is already open). */
async function openSection(page: Page, key: string) {
  const section = page.getByTestId(`axin-section-${key}`);
  if ((await section.getAttribute("data-state")) !== "open") {
    await section.click();
  }
  await expect(section).toHaveAttribute("data-state", "open");
}

test("ACTIVE edit journey: change, resume, submit — public stays old until approval", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 77));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  const card = page.locator(`[data-testid="owner-listing-card"][data-listing-id="${listing.id}"]`);

  await openEdit(page, listing.id);
  // approved edit-mode shell: header, ONE context strip, no fee/promo
  await expect(page.getByTestId("axin-header-title")).toHaveText("Elanı redaktə et");
  const strip = page.getByTestId("edit-context-strip");
  await expect(strip).toHaveAttribute("data-variant", "active");
  await expect(strip).toContainText("Dəyişikliklər moderasiyadan sonra elanda görünəcək.");
  // complete snapshot resumes straight on Review with the edit CTA —
  // and no fee/quota line, no promotion module in edit mode
  await expect(page.getByTestId("axin-section-review")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("wizard-submit")).toHaveText("Dəyişiklikləri moderasiyaya göndər");
  await expect(page.getByTestId("wizard-quota")).toHaveCount(0);
  await expect(page.getByTestId("promo-intent")).toHaveCount(0);
  await expect(page.getByTestId("promo-intent-unavailable")).toHaveCount(0);

  // price + description + equipment changes across stages
  await openSection(page, "sale");
  await page.getByTestId("wizard-price").fill("26500");
  await saveSettled(page);
  await openSection(page, "info-contact");
  await page.getByTestId("wizard-description").fill("Redaktə edilmiş təsvir");
  await saveSettled(page);
  await page.getByTestId("wizard-features-toggle").click();
  const absBox = page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]').first();
  await absBox.check();
  await expect(absBox).toBeChecked();
  await saveSettled(page);

  // resume proof: a full reload restores every saved value
  await page.goto(`/profil/elanlar/${listing.id}/redakte`);
  await openSection(page, "sale");
  await expect(page.getByTestId("wizard-price")).toHaveValue("26500");
  await openSection(page, "info-contact");
  await expect(page.getByTestId("wizard-description")).toHaveValue("Redaktə edilmiş təsvir");

  // submit from Review
  await openSection(page, "review");
  await page.getByTestId("wizard-submit").click();
  const result = page.getByTestId("edit-result");
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("data-outcome", "SUBMITTED");
  await expect(result).toContainText("Dəyişikliklər moderasiyaya göndərildi");

  // card: primary Aktiv, secondary pending chip, read-only entry
  await page.goto("/profil/elanlar");
  await expect(card.getByTestId("owner-status")).toHaveText("Aktiv");
  await expect(card.getByTestId("owner-edit-chip")).toHaveText("Dəyişiklik moderasiyadadır");
  await expect(card.getByTestId("owner-edit-link")).toHaveText("Redaktəyə bax");

  // §36/§39: fresh public read still serves the OLD approved version
  await page.goto(`/elan/${listing.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("25 000");
  await expect(page.getByTestId("detail-price")).not.toContainText("26 500");
  await expect(page.getByTestId("listing-detail")).not.toContainText("Redaktə edilmiş təsvir");
});

test("deactivated + draft: Aktiv et routes into edit; combined CTA submits and records intent", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 78));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  const card = page.locator(`[data-testid="owner-listing-card"][data-listing-id="${listing.id}"]`);

  // deactivate through the real dialog
  await page.goto("/profil/elanlar");
  await card.getByTestId("owner-deactivate").click();
  await page.getByTestId("deactivate-confirm").click();
  await expect(card.getByTestId("owner-status")).toHaveText("Deaktiv");

  // start an edit, then leave — the card now carries the draft
  await card.getByTestId("owner-edit").click();
  await page.waitForURL(/\/redakte$/);
  await expect(page.getByTestId("edit-context-strip")).toHaveAttribute("data-variant", "deactivated");
  await page.goto("/profil/elanlar");
  await expect(card.getByTestId("owner-edit-chip")).toHaveText("Redaktə tamamlanmayıb");
  await expect(card.getByTestId("owner-edit-link")).toHaveText("Redaktəyə davam et");

  // Aktiv et NEVER publishes the old version: it routes into the edit
  await card.getByTestId("owner-reactivate").click();
  await page.waitForURL(/\/redakte\?aktivlesdir=1$/);
  await expect(page.getByTestId("edit-activate-notice")).toHaveText(
    "Elanı aktivləşdirmək üçün dəyişiklikləri tamamlayın və moderasiyaya göndərin.",
  );
  await expect(page.getByTestId("edit-context-strip")).toHaveAttribute("data-variant", "deactivated-requested");
  await expect(page.getByTestId("wizard-submit")).toHaveText("Dəyişiklikləri moderasiyaya göndər və aktivləşdir");

  // make a change, then the combined submit
  await openSection(page, "sale");
  await page.getByTestId("wizard-price").fill("27000");
  await saveSettled(page);
  await openSection(page, "review");
  await page.getByTestId("wizard-submit").click();
  await expect(page.getByTestId("edit-result")).toHaveAttribute("data-outcome", "SUBMITTED");
  await expect(page.getByTestId("edit-result")).toContainText("Moderasiya sonrası aktivləşəcək");

  // card: still Deaktiv + pending chip + awaiting line (intent recorded)
  await page.goto("/profil/elanlar");
  await expect(card.getByTestId("owner-status")).toHaveText("Deaktiv");
  await expect(card.getByTestId("owner-edit-chip")).toHaveText("Dəyişiklik moderasiyadadır");
  await expect(card.getByTestId("owner-awaiting-activation")).toHaveText("Moderasiya sonrası aktivləşəcək");
  await expect(card.getByTestId("owner-reactivate")).toHaveCount(0);

  // §37: still hidden publicly — even after submit
  const hidden = await page.goto(`/elan/${listing.publicId}`);
  expect(hidden?.status()).toBe(404);
});

test("cancel edit keeps the approved listing and allows a fresh start", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 79));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  const card = page.locator(`[data-testid="owner-listing-card"][data-listing-id="${listing.id}"]`);

  await openEdit(page, listing.id);
  await openSection(page, "sale");
  await page.getByTestId("wizard-price").fill("29999");
  await saveSettled(page);

  // cancel: dialog copy, outlined-danger confirm, Geri qayıt secondary
  await page.getByTestId("edit-cancel").click();
  const dialog = page.getByTestId("cancel-edit-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toContainText("Redaktəni ləğv etmək istəyirsiniz?");
  await expect(dialog).toContainText("Saxlanılmış dəyişikliklər silinəcək və mövcud təsdiqlənmiş elan dəyişməyəcək.");
  // back path first: nothing is lost
  await dialog.getByTestId("cancel-edit-back").click();
  await expect(dialog).not.toBeVisible();
  await page.getByTestId("edit-cancel").click();
  await dialog.getByTestId("cancel-edit-confirm").click();
  await expect(page.getByTestId("edit-result")).toHaveAttribute("data-outcome", "CANCELLED");
  await expect(page.getByTestId("edit-result")).toContainText("Redaktə ləğv edildi");
  await page.getByTestId("edit-result").getByRole("link").click();
  await page.waitForURL(/\/profil\/elanlar$/);

  // approved listing untouched, chip gone, public price unchanged
  await expect(card.getByTestId("owner-status")).toHaveText("Aktiv");
  await expect(card.getByTestId("owner-edit-chip")).toHaveCount(0);
  await page.goto(`/elan/${listing.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("25 000");

  // a NEW edit starts clean from the approved snapshot
  await openEdit(page, listing.id);
  await openSection(page, "sale");
  await expect(page.getByTestId("wizard-price")).toHaveValue("25000");
});

test("pending revision opens read-only: no inputs, no save, no submit, no cancel", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 80));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  const card = page.locator(`[data-testid="owner-listing-card"][data-listing-id="${listing.id}"]`);

  await openEdit(page, listing.id);
  await page.getByTestId("wizard-submit").click();
  await expect(page.getByTestId("edit-result")).toHaveAttribute("data-outcome", "SUBMITTED");

  await page.goto("/profil/elanlar");
  await card.getByTestId("owner-edit-link").click();
  await page.waitForURL(/\/redakte$/);
  const view = page.getByTestId("pending-edit-view");
  await expect(view).toBeVisible();
  await expect(page.getByTestId("pending-edit-bar")).toContainText("Moderasiya gözləyir");
  await expect(page.getByTestId("pending-edit-bar")).toContainText("göndərilib:");
  // same proposed content, zero mutation surfaces
  await expect(page.getByTestId("pending-title")).not.toHaveText("");
  await expect(page.getByTestId("pending-price")).toContainText("25 000");
  expect(await view.locator("input, textarea, select, [contenteditable='true']").count()).toBe(0);
  await expect(page.getByTestId("edit-cancel")).toHaveCount(0);
  await expect(page.getByTestId("wizard-submit")).toHaveCount(0);
  await expect(page.getByTestId("axin-autosave")).toHaveCount(0);
  // back navigation works
  await page.getByTestId("pending-back").click();
  await page.waitForURL(/\/profil\/elanlar$/);
});

test("rapid revision edits persist every final intent (scalars + cross-group equipment)", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 81));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });

  await openEdit(page, listing.id);
  // rapid scalar sequence — no waits between edits
  await openSection(page, "sale");
  await page.getByTestId("wizard-price").fill("31000");
  await page.getByTestId("wizard-mileage").fill("70500");
  // rapid cross-group equipment right after, still without waiting
  await openSection(page, "info-contact");
  await page.getByTestId("wizard-features-toggle").click();
  const safety = page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]');
  await safety.nth(0).check();
  await safety.nth(1).check();
  await page.getByTestId("equipment-group-COMFORT").click();
  const comfort = page.getByTestId("equipment-options-COMFORT").locator('input[type="checkbox"]');
  await comfort.nth(0).check();
  // then deselect one immediately (final intent: SAFETY[1] + COMFORT[0])
  await safety.nth(0).uncheck();
  await saveSettled(page);

  // reload: the REVISION holds exactly the final intent
  await page.goto(`/profil/elanlar/${listing.id}/redakte`);
  await openSection(page, "sale");
  await expect(page.getByTestId("wizard-price")).toHaveValue("31000");
  await expect(page.getByTestId("wizard-mileage")).toHaveValue("70500");
  await openSection(page, "info-contact");
  await page.getByTestId("wizard-features-toggle").click();
  await expect(page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]').nth(0)).not.toBeChecked();
  await expect(page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]').nth(1)).toBeChecked();
  await page.getByTestId("equipment-group-COMFORT").click(); // collapsed by default
  await expect(page.getByTestId("equipment-options-COMFORT").locator('input[type="checkbox"]').nth(0)).toBeChecked();
});

test("staged image operations stay revision-scoped; the public gallery never changes", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 82));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });

  // public gallery BEFORE (approved images)
  await page.goto(`/elan/${listing.publicId}`);
  const publicImagesBefore = await page.getByTestId("gallery").locator("img").count();

  await openEdit(page, listing.id);
  await openSection(page, "photos");
  await expect(page.getByTestId("wizard-image-grid")).toBeVisible();
  await expect(page.getByTestId("wizard-image")).toHaveCount(3);

  // add a revision-only 4th image
  await page.getByTestId("wizard-photos-input").setInputFiles({
    name: "staged.jpg",
    mimeType: "image/jpeg",
    buffer: await makeTestJpeg(800, 600, 200),
  });
  await expect(page.getByTestId("wizard-image")).toHaveCount(4);

  // make the new image primary, then move it left once
  await page.getByTestId("wizard-image").nth(3).getByTestId("image-make-primary").click();
  await expect(page.getByTestId("wizard-image").nth(3)).toHaveAttribute("data-primary", "true");
  await page.getByTestId("wizard-image").nth(3).getByTestId("image-move-left").click();
  await expect(page.getByTestId("wizard-image").nth(2)).toHaveAttribute("data-primary", "true");

  // remove one approved-snapshot image from the revision
  await page.getByTestId("wizard-image").first().getByTestId("image-delete").click();
  await expect(page.getByTestId("wizard-image")).toHaveCount(3);

  // reload persistence of the staged gallery
  await page.goto(`/profil/elanlar/${listing.id}/redakte`);
  await openSection(page, "photos");
  await expect(page.getByTestId("wizard-image")).toHaveCount(3);
  await expect(page.locator('[data-testid="wizard-image"][data-primary="true"]')).toHaveCount(1);

  // §36: the public gallery is untouched throughout
  await page.goto(`/elan/${listing.publicId}`);
  expect(await page.getByTestId("gallery").locator("img").count()).toBe(publicImagesBefore);
});

test("1024 explicit run: edit shell, cards and dialogs hold the layout (desktop project only)", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "1024 emulation runs once, on the desktop engine");
  await page.setViewportSize({ width: 1024, height: 768 });
  const { userId } = await loginAs(context, testPhone(project.name, 83));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  const other = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  await insertEditRevisionFixture(other.id, "PENDING_MODERATION");
  await setListingSellerLifecycle(other.id, { deactivated: true });

  // cards: pills, chips, action hierarchy at 1024 without overflow
  await page.goto("/profil/elanlar");
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(`[data-listing-id="${other.id}"]`).getByTestId("owner-edit-chip")).toBeVisible();
  await expect(page.locator(`[data-listing-id="${other.id}"]`).getByTestId("owner-edit-link")).toBeVisible();

  // edit shell: header, context strip, six stages, Review CTA, cancel
  await openEdit(page, listing.id);
  await expectNoHorizontalOverflow(page);
  await expect(page.getByTestId("edit-context-strip")).toBeVisible();
  for (const key of ["quickstart", "details", "sale", "photos", "info-contact", "review"]) {
    await expect(page.getByTestId(`axin-section-${key}`)).toBeVisible();
  }
  await expect(page.getByTestId("wizard-submit")).toBeVisible();
  await openSection(page, "photos");
  await expect(page.getByTestId("wizard-image-grid")).toBeVisible();
  await openSection(page, "info-contact");
  await page.getByTestId("wizard-features-toggle").click();
  await expect(page.getByTestId("equipment-search")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // cancel dialog is the centered 400px variant at 1024
  await page.getByTestId("edit-cancel").click();
  const dialog = page.getByTestId("cancel-edit-dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(Math.round(box!.width)).toBe(400);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expectNoHorizontalOverflow(page);
});
