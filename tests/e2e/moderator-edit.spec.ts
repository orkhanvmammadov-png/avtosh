import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import { insertListingFixture } from "./seller-helpers";

/**
 * O.12 Stage D — moderator edit review end to end: real seller edits
 * through the Stage C UI, real queue/claim/diff/decisions through the
 * portal, and the seller/public consequences of every decision.
 */

async function saveSettled(page: Page) {
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
}

async function openSection(page: Page, key: string) {
  const section = page.getByTestId(`axin-section-${key}`);
  if ((await section.getAttribute("data-state")) !== "open") {
    await section.click();
  }
  await expect(section).toHaveAttribute("data-state", "open");
}

/** Real seller journey: enter edit, change price (+ optional extras),
    submit — leaves a PENDING revision behind. */
async function sellerSubmitsEdit(
  page: Page,
  listingId: string,
  options: { equipment?: boolean; description?: string } = {},
): Promise<void> {
  await page.goto("/profil/elanlar");
  await page
    .locator(`[data-testid="owner-listing-card"][data-listing-id="${listingId}"]`)
    .getByTestId("owner-edit")
    .click();
  await page.waitForURL(/\/redakte$/);
  await openSection(page, "sale");
  await page.getByTestId("wizard-price").fill("26500");
  await saveSettled(page);
  if (options.description !== undefined) {
    await openSection(page, "info-contact");
    await page.getByTestId("wizard-description").fill(options.description);
    await saveSettled(page);
  }
  if (options.equipment === true) {
    await openSection(page, "info-contact");
    await page.getByTestId("wizard-features-toggle").click();
    await page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]').first().check();
    await saveSettled(page);
  }
  await openSection(page, "review");
  await page.getByTestId("wizard-submit").click();
  await expect(page.getByTestId("edit-result")).toHaveAttribute("data-outcome", "SUBMITTED");
}

/** The merged queue is oldest-first and paginated — walk "Daha çox
    göstər" until the fixture's row is on screen (bounded, no sleeps). */
async function revealQueueRow(page: Page, listingId: string) {
  const row = page.locator(`[data-testid="queue-item"][data-listing-id="${listingId}"]`);
  const items = page.locator('[data-testid="queue-item"]');
  for (let i = 0; i < 40; i += 1) {
    if ((await row.count()) > 0) break;
    const more = page.getByTestId("queue-load-more");
    if ((await more.count()) === 0) break;
    const before = await items.count();
    await more.click();
    await expect.poll(async () => items.count()).toBeGreaterThan(before);
  }
  await expect(row).toBeVisible();
  return row;
}

async function submitDecision(page: Page, endpoint: string): Promise<number> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/moderator/listings/") && r.url().endsWith(`/${endpoint}`),
    ),
    page.getByTestId("decision-submit").click(),
  ]);
  return response.status();
}

test("approve flow: queue tag → claim → diff → Təsdiqlə → new content public, no new period", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 170));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  await sellerSubmitsEdit(page, listing.id, { description: "Moderasiya üçün yeni təsvir", equipment: true });

  // moderator sees ONE queue with the type tag
  await loginAs(context, testPhone(project.name, 171), { roles: ["MODERATOR"] });
  await page.goto("/moderator/elanlar");
  const row = await revealQueueRow(page, listing.id);
  await expect(row.getByTestId("queue-type-tag")).toHaveText("ELAN REDAKTƏSİ");
  await expect(row.getByTestId("queue-type-tag")).toHaveAttribute("data-type", "LISTING_EDIT");

  await row.click();
  await page.waitForURL(new RegExp(`/moderator/elanlar/${listing.id}$`));
  // changed-first diff with the approved header/legend and real values
  const diff = page.getByTestId("edit-review-diff");
  await expect(diff).toBeVisible();
  await expect(diff).toContainText("Dəyişikliklərin müqayisəsi");
  await expect(diff).toContainText("Mövcud elan → Təklif olunan dəyişiklik");
  await expect(diff.getByTestId("edit-diff-price")).toContainText("25 000 AZN");
  await expect(diff.getByTestId("edit-diff-price")).toContainText("26 500 AZN");
  await expect(diff.getByTestId("edit-diff-description")).toContainText("Əvvəl");
  await expect(diff.getByTestId("edit-diff-description")).toContainText("Moderasiya üçün yeni təsvir");
  await expect(diff.getByTestId("equipment-added")).toContainText("Əlavə edildi:");
  // unchanged context lives behind the collapsed section, not as changes
  await expect(diff.getByTestId("edit-diff-unchanged")).toContainText("Digər məlumatlar (dəyişməyib)");

  // claim → approve through the existing decision flow
  await page.getByTestId("claim-button").click();
  await page.waitForLoadState("load");
  await page.getByTestId("action-approve").click();
  expect(await submitDecision(page, "approve")).toBe(200);
  await expect(page.getByTestId("decision-done")).toContainText("Dəyişikliklər təsdiqləndi.");

  // §35: new content public, same publicId, listing still ACTIVE
  await page.goto(`/elan/${listing.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("26 500");
  await expect(page.getByTestId("listing-detail")).toContainText("Moderasiya üçün yeni təsvir");

  // seller card: pending chip gone, fresh edit offered
  await loginAs(context, testPhone(project.name, 170));
  await page.goto("/profil/elanlar");
  const card = page.locator(`[data-testid="owner-listing-card"][data-listing-id="${listing.id}"]`);
  await expect(card.getByTestId("owner-status")).toHaveText("Aktiv");
  await expect(card.getByTestId("owner-edit-chip")).toHaveCount(0);
  await expect(card.getByTestId("owner-edit")).toHaveText("Redaktə et");
});

test("correction flow: real reason reaches the seller, same revision resubmits into the queue", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 172));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  await sellerSubmitsEdit(page, listing.id);

  await loginAs(context, testPhone(project.name, 173), { roles: ["MODERATOR"] });
  await page.goto(`/moderator/elanlar/${listing.id}`);
  await page.getByTestId("claim-button").click();
  await page.waitForLoadState("load");
  await page.getByTestId("action-correction").click();
  await page.getByTestId("decision-reason").selectOption("INVALID_PHOTOS");
  await page.getByTestId("decision-note").fill("Şəkillər qaranlıqdır, yenidən çəkin.");
  expect(await submitDecision(page, "request-correction")).toBe(200);
  await expect(page.getByTestId("decision-done")).toContainText("Düzəliş tələbi satıcıya göndərildi.");

  // seller: real edit-scoped correction — chip, action, feedback
  await loginAs(context, testPhone(project.name, 172));
  await page.goto("/profil/elanlar");
  const card = page.locator(`[data-testid="owner-listing-card"][data-listing-id="${listing.id}"]`);
  await expect(card.getByTestId("owner-status")).toHaveText("Aktiv"); // §30: old version stays live
  await expect(card.getByTestId("owner-edit-chip")).toHaveText("Redaktəyə düzəliş tələb olunur");
  await expect(card.getByTestId("owner-edit-link")).toHaveText("Düzəliş et");
  await card.getByTestId("owner-edit-link").click();
  await page.waitForURL(/\/redakte$/);
  const banner = page.getByTestId("wizard-feedback");
  await expect(banner).toContainText("Redaktəyə düzəliş tələb olunur");
  await expect(banner).toContainText("Şəkillər uyğun deyil");
  await expect(banner).toContainText("Şəkillər qaranlıqdır, yenidən çəkin.");

  // fix and resubmit the SAME revision
  await openSection(page, "sale");
  await page.getByTestId("wizard-price").fill("26900");
  await saveSettled(page);
  await openSection(page, "review");
  await page.getByTestId("wizard-submit").click();
  await expect(page.getByTestId("edit-result")).toHaveAttribute("data-outcome", "SUBMITTED");

  // the queue receives the resubmission again as ELAN REDAKTƏSİ
  await loginAs(context, testPhone(project.name, 173), { roles: ["MODERATOR"] });
  await page.goto("/moderator/elanlar");
  const row = await revealQueueRow(page, listing.id);
  await expect(row.getByTestId("queue-type-tag")).toHaveText("ELAN REDAKTƏSİ");
});

test("reject flow: old content stays public, intent-free terminal revision, fresh edit allowed", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 174));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  await sellerSubmitsEdit(page, listing.id);

  await loginAs(context, testPhone(project.name, 175), { roles: ["MODERATOR"] });
  await page.goto(`/moderator/elanlar/${listing.id}`);
  await page.getByTestId("claim-button").click();
  await page.waitForLoadState("load");
  await page.getByTestId("action-reject").click();
  await page.getByTestId("decision-reason").selectOption("MISLEADING_INFO");
  expect(await submitDecision(page, "reject")).toBe(200);
  await expect(page.getByTestId("decision-done")).toContainText("Dəyişikliklər rədd edildi.");

  // public: OLD approved content remains live
  await page.goto(`/elan/${listing.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("25 000");
  await expect(page.getByTestId("detail-price")).not.toContainText("26 500");

  // seller: card plainly Aktiv, terminal revision, fresh edit possible
  await loginAs(context, testPhone(project.name, 174));
  await page.goto("/profil/elanlar");
  const card = page.locator(`[data-testid="owner-listing-card"][data-listing-id="${listing.id}"]`);
  await expect(card.getByTestId("owner-status")).toHaveText("Aktiv");
  await expect(card.getByTestId("owner-edit-chip")).toHaveCount(0);
  await card.getByTestId("owner-edit").click();
  await page.waitForURL(/\/redakte$/);
  // the fresh revision starts from the APPROVED snapshot, not the rejected one
  await openSection(page, "sale");
  await expect(page.getByTestId("wizard-price")).toHaveValue("25000");
});

test("responsive/a11y: diff readable at 1024/768/390, textual badges, no overflow (desktop engine)", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "viewport emulation runs once, on the desktop engine");
  const { userId } = await loginAs(context, testPhone(project.name, 176));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  await sellerSubmitsEdit(page, listing.id, { description: "Responsiv yoxlama təsviri", equipment: true });

  await loginAs(context, testPhone(project.name, 177), { roles: ["MODERATOR"] });
  for (const [width, height] of [[1024, 768], [768, 1024], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/moderator/elanlar");
    await expectNoHorizontalOverflow(page);
    const row = await revealQueueRow(page, listing.id);
    await expect(row.getByTestId("queue-type-tag")).toHaveText("ELAN REDAKTƏSİ");
    await page.goto(`/moderator/elanlar/${listing.id}`);
    await expectNoHorizontalOverflow(page);
    const diff = page.getByTestId("edit-review-diff");
    await expect(diff).toBeVisible();
    // old value, arrow and new value readable in DOM order — never color-only
    await expect(diff.getByTestId("edit-diff-price")).toContainText("25 000 AZN");
    await expect(diff.getByTestId("edit-diff-price")).toContainText("→");
    await expect(diff.getByTestId("edit-diff-price")).toContainText("26 500 AZN");
    await expect(diff.getByTestId("equipment-added")).toContainText("Əlavə edildi:");
    await expect(diff.getByTestId("edit-diff-description")).toContainText("Əvvəl");
    await expect(diff.getByTestId("edit-diff-description")).toContainText("Sonra");
    // decision controls reachable
    await expect(page.getByTestId("claim-state")).toBeVisible();
  }
});
