import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import {
  insertListingFixture,
  listingCounts,
  listingStatus,
} from "./seller-helpers";

/** My Listings: statuses, filters, actions, isolation, correction flow. */

test("anonymous visitors are redirected into login with intent", async ({ page }) => {
  await page.goto("/profil/elanlar");
  await expect(page).toHaveURL(/\/giris\?return_to=%2Fprofil%2Felanlar$/);
});

test("owner sees every lifecycle state with Azerbaijani labels and matching actions", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 40));
  const fixtures: [string, string, string | null][] = [
    ["DRAFT", "Qaralama", "Davam et"],
    ["PENDING_MODERATION", "Moderasiyadadır", "Ətraflı"],
    ["PAYMENT_REQUIRED", "Ödəniş tələb olunur", "Ətraflı"],
    ["ACTIVE", "Aktiv", "Elana bax"],
    ["CORRECTION_REQUIRED", "Düzəliş tələb olunur", "Düzəliş et"],
    ["REJECTED", "Rədd edilib", "Redaktə et"],
    ["SOLD", "Satılıb", "Elana bax"],
    ["EXPIRED", "Müddəti bitib", "Elana bax"],
    ["SUSPENDED", "Dayandırılıb", null],
  ];
  for (const [status] of fixtures) {
    await insertListingFixture(userId, {
      status,
      complete: true,
      images: 1,
      review:
        status === "CORRECTION_REQUIRED"
          ? { decision: "CORRECTION_REQUESTED", reasonCode: "INVALID_PHOTOS", note: "Şəkillər aydın deyil." }
          : status === "REJECTED"
            ? { decision: "REJECTED", reasonCode: "PROHIBITED_ITEM", note: null }
            : undefined,
    });
  }

  await page.goto("/profil/elanlar");
  await expectNoHorizontalOverflow(page);
  for (const [status, label, action] of fixtures) {
    const card = page.locator(`[data-testid="owner-listing-card"][data-status="${status}"]`).first();
    await expect(card).toBeVisible();
    await expect(card.getByTestId("owner-status")).toHaveText(label);
    if (action !== null) {
      await expect(card.getByTestId("owner-action")).toHaveText(action);
    } else {
      await expect(card.getByTestId("owner-action")).toHaveCount(0);
    }
  }
  // raw enum strings never reach the customer
  await expect(page.getByTestId("my-listings-list")).not.toContainText("PENDING_MODERATION");
  // seller-safe moderation feedback is shown on returned listings
  const correction = page.locator('[data-testid="owner-listing-card"][data-status="CORRECTION_REQUIRED"]').first();
  await expect(correction.getByTestId("owner-feedback")).toContainText("Şəkillər uyğun deyil");
  await expect(correction.getByTestId("owner-feedback")).toContainText("Şəkillər aydın deyil.");
});

test("filters narrow the list without a seller search engine", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 41));
  await insertListingFixture(userId, { status: "DRAFT" });
  await insertListingFixture(userId, { status: "ACTIVE", images: 1 });
  await insertListingFixture(userId, { status: "PENDING_MODERATION", images: 1 });
  await insertListingFixture(userId, {
    status: "CORRECTION_REQUIRED",
    images: 1,
    review: { decision: "CORRECTION_REQUESTED", reasonCode: "OTHER", note: null },
  });

  await page.goto("/profil/elanlar");
  await expect(page.locator('[data-testid="owner-listing-card"]')).toHaveCount(4);
  await page.getByTestId("filter-draft").click();
  await expect(page.locator('[data-testid="owner-listing-card"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="owner-listing-card"]').first()).toHaveAttribute("data-status", "DRAFT");
  await page.getByTestId("filter-correction").click();
  await expect(page.locator('[data-testid="owner-listing-card"]').first()).toHaveAttribute("data-status", "CORRECTION_REQUIRED");
  await page.getByTestId("filter-all").click();
  await expect(page.locator('[data-testid="owner-listing-card"]')).toHaveCount(4);
});

test("another user's listings never appear", async ({ page, context }, { project }) => {
  const other = await loginAs(context, testPhone(project.name, 42));
  await insertListingFixture(other.userId, { status: "ACTIVE", images: 1 });
  await context.clearCookies();
  await loginAs(context, testPhone(project.name, 43));
  await page.goto("/profil/elanlar");
  await expect(page.getByTestId("my-listings-empty")).toBeVisible();
});

test("correction round trip: feedback → edit → resubmit → PENDING_MODERATION, no new publication/payment", async ({ page, context }, { project }) => {
  test.setTimeout(120_000);
  const { userId } = await loginAs(context, testPhone(project.name, 44));
  const fixture = await insertListingFixture(userId, {
    status: "CORRECTION_REQUIRED",
    complete: true,
    images: 3,
    review: { decision: "CORRECTION_REQUESTED", reasonCode: "SUSPICIOUS_PRICE", note: "Qiyməti dəqiqləşdirin." },
  });
  const before = await listingCounts(userId);

  // seller discovers the correction from My Listings
  await page.goto("/profil/elanlar");
  const card = page.locator(`[data-testid="owner-listing-card"][data-status="CORRECTION_REQUIRED"]`).first();
  await expect(card.getByTestId("owner-feedback")).toContainText("Şübhəli qiymət");
  await card.getByTestId("owner-action").click();
  await expect(page).toHaveURL(new RegExp(`/elan-yerlesdir/${fixture.id}`));

  // the wizard shows the seller-safe feedback and allows editing
  await expect(page.getByTestId("wizard-feedback")).toContainText("Şübhəli qiymət");
  await expect(page.getByTestId("wizard-feedback")).toContainText("Qiyməti dəqiqləşdirin.");
  await page.getByTestId("wizard-step-2").click();
  await page.getByTestId("wizard-price").fill("21500");
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });

  // resubmit (never a second initial submission)
  await page.getByTestId("wizard-step-5").click();
  await expect(page.getByTestId("wizard-submit")).toHaveText("Yenidən göndər");
  await page.getByTestId("wizard-submit").click();
  await expect(page.getByTestId("wizard-result")).toHaveAttribute("data-outcome", "MODERATION", { timeout: 20_000 });

  expect(await listingStatus(fixture.id)).toBe("PENDING_MODERATION");
  const after = await listingCounts(userId);
  expect(after.publications).toBe(before.publications); // unchanged
  expect(after.payments).toBe(before.payments); // unchanged
});
