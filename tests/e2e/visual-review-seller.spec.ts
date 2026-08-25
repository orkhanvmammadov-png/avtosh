import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./auth-helpers";
import { insertListingFixture, makeTestJpeg } from "./seller-helpers";

/**
 * Seller-experience screenshots for human design review (artifacts
 * only — test-results/visual-review/ is gitignored). Serial: earlier
 * steps prepare the listing later shots reuse.
 */
const OUT = "test-results/visual-review";
const PHONE = "+994508890001";

let wizardListingId = "";
let correctionListingId = "";

test.describe.configure({ mode: "serial" });

test.describe("seller visual review artifacts", () => {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
    await loginAs(context, PHONE);
  });

  async function shoot(page: Page, name: string, width: number, height: number, path: string, ready?: (page: Page) => Promise<void>) {
    await page.setViewportSize({ width, height });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    if (ready) await ready(page);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  }

  test("prepare wizard listing with real uploaded photos", async ({ page, context }) => {
    const { userId } = await loginAs(context, PHONE);
    const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });
    wizardListingId = fixture.id;
    correctionListingId = (
      await insertListingFixture(userId, {
        status: "CORRECTION_REQUIRED",
        complete: true,
        images: 0,
        review: { decision: "CORRECTION_REQUESTED", reasonCode: "INVALID_PHOTOS", note: "Şəkillər aydın deyil, yenidən çəkin." },
      })
    ).id;
    await page.goto(`/elan-yerlesdir/${wizardListingId}?addim=3`);
    await page.getByTestId("wizard-photos-input").setInputFiles([
      { name: "a.jpg", mimeType: "image/jpeg", buffer: await makeTestJpeg(800, 600, 40) },
      { name: "b.jpg", mimeType: "image/jpeg", buffer: await makeTestJpeg(800, 600, 120) },
      { name: "c.jpg", mimeType: "image/jpeg", buffer: await makeTestJpeg(800, 600, 200) },
    ]);
    await expect(page.locator('[data-testid="wizard-image"]')).toHaveCount(3, { timeout: 60_000 });
  });

  const wizardShots: { name: string; width: number; height: number; step: number }[] = [
    { name: "wizard-vehicle-desktop-1440", width: 1440, height: 900, step: 1 },
    { name: "wizard-vehicle-mobile-390", width: 390, height: 844, step: 1 },
    { name: "wizard-details-desktop-1440", width: 1440, height: 900, step: 2 },
    { name: "wizard-details-mobile-390", width: 390, height: 844, step: 2 },
    { name: "wizard-photos-desktop-1440", width: 1440, height: 900, step: 3 },
    { name: "wizard-photos-mobile-390", width: 390, height: 844, step: 3 },
    { name: "wizard-preview-desktop-1440", width: 1440, height: 900, step: 5 },
    { name: "wizard-preview-mobile-390", width: 390, height: 844, step: 5 },
  ];
  for (const shot of wizardShots) {
    test(shot.name, async ({ page }) => {
      await shoot(page, shot.name, shot.width, shot.height, `/elan-yerlesdir/${wizardListingId}?addim=${shot.step}`, async (p) => {
        if (shot.step === 3) {
          await expect(p.locator('[data-testid="wizard-image"]')).toHaveCount(3);
        }
        if (shot.step === 5) {
          await expect(p.getByTestId("wizard-quota")).toBeVisible();
        }
      });
    });
  }

  for (const [name, width, height] of [
    ["wizard-correction-desktop-1440", 1440, 900],
    ["wizard-correction-mobile-390", 390, 844],
  ] as const) {
    test(name, async ({ page }) => {
      await shoot(page, name, width, height, `/elan-yerlesdir/${correctionListingId}`, async (p) => {
        await expect(p.getByTestId("wizard-feedback")).toBeVisible();
      });
    });
  }

  test("wizard-free-success-desktop-1440", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/elan-yerlesdir/${wizardListingId}?addim=5`);
    await page.getByTestId("wizard-submit").click();
    await expect(page.getByTestId("wizard-result")).toHaveAttribute("data-outcome", "MODERATION", { timeout: 20_000 });
    await page.screenshot({ path: `${OUT}/wizard-free-success-desktop-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${OUT}/wizard-free-success-mobile-390.png`, fullPage: true });
  });

  test("payment-required screens", async ({ page, context }) => {
    const { userId } = await loginAs(context, PHONE);
    const paid = await insertListingFixture(userId, { status: "PAYMENT_REQUIRED", complete: true, images: 3 });
    await shoot(page, "wizard-payment-required-desktop-1440", 1440, 900, `/elan-yerlesdir/${paid.id}`, async (p) => {
      await expect(p.getByTestId("wizard-status-payment")).toBeVisible();
    });
    await shoot(page, "wizard-payment-required-mobile-390", 390, 844, `/elan-yerlesdir/${paid.id}`);
  });

  test("my-listings screens", async ({ page, context }) => {
    const { userId } = await loginAs(context, PHONE);
    await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 1 });
    await shoot(page, "my-listings-desktop-1440", 1440, 900, "/profil/elanlar", async (p) => {
      await expect(p.locator('[data-testid="owner-listing-card"]').first()).toBeVisible();
    });
    await shoot(page, "my-listings-mobile-390", 390, 844, "/profil/elanlar");
    await shoot(page, "my-listings-correction-desktop-1440", 1440, 900, "/profil/elanlar?filter=correction", async (p) => {
      await expect(p.locator('[data-testid="owner-listing-card"][data-status="CORRECTION_REQUIRED"]').first()).toBeVisible();
    });
  });
});
