import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./auth-helpers";
import { expectNoHorizontalOverflow } from "./helpers";
import { insertListingFixture, makeTestJpeg } from "./seller-helpers";

async function openSection(page: Page, key: string) {
  const section = page.getByTestId(`axin-section-${key}`);
  if ((await section.getAttribute("data-state")) !== "open") {
    await section.click();
  }
  await expect(section).toHaveAttribute("data-state", "open");
}

/**
 * Phase 4.17O.9 Stage B — AXIN Quick Start / shell captures for Owner
 * review (artifacts land in the gitignored test-results/visual-review/).
 */
const OUT = "test-results/visual-review";

test.describe("O.9 AXIN visual review (Stage B — 1440)", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
  });

  test("o9-stageb-captures", async ({ page, context }) => {
    test.setTimeout(180_000);
    await loginAs(context, "+994508890002");
    await page.setViewportSize({ width: 1440, height: 900 });

    // Quick Start — empty
    await page.goto("/elan-yerlesdir");
    await expect(page.getByTestId("quick-start")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `${OUT}/o9-stageb-quickstart-empty.png`, fullPage: true });

    // Brand selected (typeahead open first, then chosen)
    const brand = page.getByTestId("quick-start-brand");
    await brand.click();
    await brand.fill("Toy");
    await expect(page.getByTestId("quick-start-brand-listbox")).toBeVisible();
    await page.screenshot({ path: `${OUT}/o9-stageb-quickstart-brand-open.png` });
    await page.getByTestId("quick-start-brand-listbox").getByText("Toyota", { exact: true }).click();
    await page.screenshot({ path: `${OUT}/o9-stageb-quickstart-brand-selected.png` });

    // Brand + Model
    const model = page.getByTestId("quick-start-model");
    await model.click();
    await model.fill("Co");
    await page.getByTestId("quick-start-model-listbox").getByText("Corolla", { exact: true }).click();
    await page.screenshot({ path: `${OUT}/o9-stageb-quickstart-brand-model.png` });

    // Completed (year chosen, Başla enabled)
    await page.getByTestId("quick-start-year").click();
    await page.getByTestId("quick-start-year-opt-2021").click();
    await expect(page.getByTestId("quick-start-begin")).toBeEnabled();
    await page.screenshot({ path: `${OUT}/o9-stageb-quickstart-complete.png`, fullPage: true });

    // Main AXIN shell after Quick Start
    await page.getByTestId("quick-start-begin").click();
    await page.waitForURL(/\/elan-yerlesdir\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("axin-flow")).toBeVisible();
    await expect(page.getByTestId("axin-summary-quickstart")).toContainText("Toyota");
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `${OUT}/o9-stageb-shell.png`, fullPage: true });
  });

  /** Stage D — progressive sections, photos and extras states. */
  test("o9-staged-captures", async ({ page, context }) => {
    test.setTimeout(240_000);
    const { userId } = await loginAs(context, "+994508890003");
    const car = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });
    await page.setViewportSize({ width: 1440, height: 900 });

    // main form (shell with real data)
    await page.goto(`/elan-yerlesdir/${car.id}`);
    await expect(page.getByTestId("axin-flow")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/o9-staged-1440-main-form.png`, fullPage: true });

    // Detallar — CAR
    await openSection(page, "details");
    await expect(page.getByTestId("wizard-engine")).toBeVisible();
    await page.screenshot({ path: `${OUT}/o9-staged-1440-details-car.png`, fullPage: true });

    // Satış məlumatı (chips + condensed price/mileage)
    await openSection(page, "sale");
    await expect(page.getByTestId("wizard-no-accident-chip")).toBeVisible();
    await page.screenshot({ path: `${OUT}/o9-staged-1440-sale.png`, fullPage: true });

    // Şəkillər — empty state with dashed add tile + minimum guidance
    await openSection(page, "photos");
    await expect(page.getByTestId("wizard-photo-add")).toBeVisible();
    await expect(page.getByTestId("wizard-photo-count")).toContainText("0/3");
    await page.screenshot({ path: `${OUT}/o9-staged-1440-photos-empty.png`, fullPage: true });

    // uploading state — the signed-URL PUTs are held until captured
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/dev-storage/**", async (route) => {
      if (route.request().method() === "PUT") await hold;
      await route.continue();
    });
    await page.getByTestId("wizard-photos-input").setInputFiles([
      { name: "a.jpg", mimeType: "image/jpeg", buffer: await makeTestJpeg(800, 600, 40) },
      { name: "b.jpg", mimeType: "image/jpeg", buffer: await makeTestJpeg(800, 600, 120) },
      { name: "c.jpg", mimeType: "image/jpeg", buffer: await makeTestJpeg(800, 600, 200) },
    ]);
    await expect(page.getByTestId("wizard-upload-queue").locator('[data-state="uploading"]').first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/o9-staged-1440-photos-uploading.png`, fullPage: true });
    release();

    // complete grid + primary chip
    await expect(page.locator('[data-testid="wizard-image"]')).toHaveCount(3, { timeout: 60_000 });
    await page.screenshot({ path: `${OUT}/o9-staged-1440-photos-complete.png`, fullPage: true });
    await expect(page.locator('[data-testid="wizard-image"][data-primary="true"]')).toHaveCount(1);
    await page.locator('[data-testid="wizard-image"][data-primary="true"]').screenshot({
      path: `${OUT}/o9-staged-1440-photo-primary.png`,
    });

    // Əlavə — features expander open + description with counter
    await openSection(page, "extras");
    await page.getByTestId("wizard-features-toggle").click();
    await expect(page.getByTestId("wizard-features")).toBeVisible();
    await page.screenshot({ path: `${OUT}/o9-staged-1440-features.png`, fullPage: true });
    await page.getByTestId("wizard-description").fill("Əla vəziyyətdə avtomobil. Bir sahib, tam servis tarixi.");
    await page.screenshot({ path: `${OUT}/o9-staged-1440-description.png`, fullPage: true });

    // 390 sanity — photos grid on mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await openSection(page, "photos");
    await expect(page.locator('[data-testid="wizard-image"]')).toHaveCount(3);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `${OUT}/o9-staged-390-photos.png`, fullPage: true });

    // Detallar — MOTORCYCLE (quick-start created)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/elan-yerlesdir");
    await page.getByTestId("quick-start-category-MOTORCYCLE").click();
    const brand = page.getByTestId("quick-start-brand");
    await brand.click();
    await brand.fill("Yam");
    await page.getByTestId("quick-start-brand-listbox").getByText("Yamaha", { exact: true }).click();
    const model = page.getByTestId("quick-start-model");
    await model.click();
    await model.fill("MT");
    await page.getByTestId("quick-start-model-listbox").getByText("MT-07", { exact: true }).click();
    await page.getByTestId("quick-start-year").click();
    await page.getByTestId("quick-start-year-opt-2022").click();
    await page.getByTestId("quick-start-begin").click();
    await page.waitForURL(/\/elan-yerlesdir\/[0-9a-f-]{36}$/);
    await openSection(page, "details");
    await expect(page.getByTestId("wizard-motorcycle_type_id")).toBeVisible();
    await expect(page.getByTestId("wizard-drive_type_id")).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/o9-staged-1440-details-moto.png`, fullPage: true });
  });
});
