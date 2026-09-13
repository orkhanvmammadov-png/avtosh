import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./auth-helpers";
import { expectNoHorizontalOverflow, seed } from "./helpers";
import { consumeFreePublications, insertListingFixture, makeTestJpeg } from "./seller-helpers";

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

  /** Stage F — contact, review, fee and promotion-intent states. */
  test("o9-stagef-captures", async ({ page, context }) => {
    test.setTimeout(240_000);
    const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
    let cleanup: (() => Promise<void>) | null = null;
    try {
      const { userId } = await loginAs(context, "+994508890004");
      await page.setViewportSize({ width: 1440, height: 900 });

      // contact — empty / error / filled
      const contactDraft = await insertListingFixture(userId, { status: "DRAFT", complete: false });
      await page.goto(`/elan-yerlesdir/${contactDraft.id}`);
      await openSection(page, "contact");
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o9-stagef-1440-contact-empty.png`, fullPage: true });
      await page.getByTestId("wizard-seller-name").click();
      await page.getByTestId("wizard-contact-phone").fill("010 21");
      await page.getByTestId("wizard-seller-name").click();
      await page.getByTestId("axin-section-contact").click(); // blur phone
      await expect(page.getByText("Nömrə natamamdır", { exact: false })).toBeVisible();
      await page.screenshot({ path: `${OUT}/o9-stagef-1440-contact-error.png`, fullPage: true });
      await page.getByTestId("wizard-seller-name").fill("Orxan M.");
      await page.getByTestId("wizard-contact-phone").fill("010 218 41 91");
      await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
      await page.screenshot({ path: `${OUT}/o9-stagef-1440-contact-filled.png`, fullPage: true });

      // review — promotion unavailable (packages deactivated briefly)
      const freeDraft = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
      await sql`update promotion_packages set is_active = false where is_active`;
      cleanup = async () => {
        await sql`update promotion_packages set is_active = true`;
      };
      await page.goto(`/elan-yerlesdir/${freeDraft.id}`);
      await openSection(page, "review");
      await expect(page.getByTestId("promo-intent-unavailable")).toBeVisible();
      await page.screenshot({ path: `${OUT}/o9-stagef-1440-promotion-unavailable.png`, fullPage: true });
      await cleanup(); // seeded ACTIVE packages back for the remaining states
      cleanup = null;

      // review FREE + promotion none
      await page.reload();
      await openSection(page, "review");
      await expect(page.getByTestId("promo-intent")).toBeVisible();
      await expect(page.getByTestId("review-fee-value")).toHaveText("Pulsuz");
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o9-stagef-1440-review-free.png`, fullPage: true });
      await page.screenshot({ path: `${OUT}/o9-stagef-1440-promotion-none.png`, fullPage: true });
      await page.getByTestId("review-contact").screenshot({ path: `${OUT}/o9-stagef-1440-review-contact.png` });

      // Premium selected
      await page.getByTestId("promo-intent-PREMIUM-3").click();
      await expect(page.getByTestId("promo-intent-PREMIUM")).toHaveAttribute("data-selected", "true");
      await page.screenshot({ path: `${OUT}/o9-stagef-1440-promotion-premium.png`, fullPage: true });
      // Dual
      await page.getByTestId("promo-intent-BOOST-1").click();
      await expect(page.getByTestId("promo-intent-BOOST")).toHaveAttribute("data-selected", "true");
      await page.screenshot({ path: `${OUT}/o9-stagef-1440-promotion-dual.png`, fullPage: true });
      // Boost only
      await page.getByTestId("promo-intent-PREMIUM-3").click();
      await expect(page.getByTestId("promo-intent-PREMIUM")).toHaveAttribute("data-selected", "false");
      await page.screenshot({ path: `${OUT}/o9-stagef-1440-promotion-boost.png`, fullPage: true });

      // review PAID (4th publication) — 2 AZN fee line, separate from promo
      const payer = await loginAs(context, "+994508890005");
      await consumeFreePublications(payer.userId, 3);
      const paidDraft = await insertListingFixture(payer.userId, { status: "DRAFT", complete: true, images: 3 });
      await page.goto(`/elan-yerlesdir/${paidDraft.id}`);
      await openSection(page, "review");
      await expect(page.getByTestId("review-fee-value")).toHaveText("2 AZN");
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o9-stagef-1440-review-paid.png`, fullPage: true });
    } finally {
      if (cleanup !== null) await cleanup();
      await sql.end();
    }
  });

  /** Stage G — 1024 / 768 / 390 responsive states. */
  test("o9-stageg-captures", async ({ page, context }) => {
    test.setTimeout(300_000);
    const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
    try {
      const { userId } = await loginAs(context, "+994508890006");
      const rich = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });

      // 1024 + 768: main / contact / review / promotion
      for (const [w, h, tag] of [[1024, 800, "1024"], [768, 1024, "768"]] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`/elan-yerlesdir/${rich.id}`);
        await expect(page.getByTestId("axin-flow")).toBeVisible();
        await page.waitForLoadState("networkidle");
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: `${OUT}/o9-stageg-${tag}-main.png`, fullPage: true });
        await openSection(page, "contact");
        await page.screenshot({ path: `${OUT}/o9-stageg-${tag}-contact.png`, fullPage: true });
        await openSection(page, "review");
        await expect(page.getByTestId("promo-intent")).toBeVisible();
        await page.screenshot({ path: `${OUT}/o9-stageg-${tag}-review.png`, fullPage: true });
        await page.getByTestId("promo-intent").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${OUT}/o9-stageg-${tag}-promotion.png` });
      }

      // 390 — quick start + brand/model overlay
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/elan-yerlesdir");
      await expect(page.getByTestId("quick-start")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o9-stageg-390-quick-start.png`, fullPage: true });
      const brand = page.getByTestId("quick-start-brand");
      await brand.click();
      await brand.fill("To");
      await expect(page.getByTestId("quick-start-brand-listbox")).toBeVisible();
      await page.screenshot({ path: `${OUT}/o9-stageg-390-brand-model.png` });
      await page.keyboard.press("Escape");

      // 390 — main / photos / contact / validation / review / promotion states
      await page.goto(`/elan-yerlesdir/${rich.id}`);
      await expect(page.getByTestId("axin-flow")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o9-stageg-390-main.png`, fullPage: true });
      await openSection(page, "photos");
      await expect(page.locator('[data-testid="wizard-image"]')).toHaveCount(3);
      await page.screenshot({ path: `${OUT}/o9-stageg-390-photos.png`, fullPage: true });
      await openSection(page, "contact");
      await page.screenshot({ path: `${OUT}/o9-stageg-390-contact.png`, fullPage: true });
      // inline validation with the sticky bar visible
      await page.getByTestId("wizard-contact-phone").fill("010 21");
      await page.getByTestId("wizard-seller-name").click();
      await expect(page.getByText("Nömrə natamamdır", { exact: false })).toBeVisible();
      await page.screenshot({ path: `${OUT}/o9-stageg-390-validation.png`, fullPage: true });
      await page.getByTestId("wizard-contact-phone").fill("010 218 41 91");
      await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
      // keyboard proxies: focused numeric/phone field above the bar
      await openSection(page, "sale");
      await page.getByTestId("wizard-price").click();
      await page.screenshot({ path: `${OUT}/o9-stageg-390-keyboard-price.png` });
      await openSection(page, "contact");
      await page.getByTestId("wizard-contact-phone").click();
      await page.screenshot({ path: `${OUT}/o9-stageg-390-keyboard-phone.png` });
      // review + promotion states
      await openSection(page, "review");
      await expect(page.getByTestId("review-fee-value")).toHaveText("Pulsuz");
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${OUT}/o9-stageg-390-review.png`, fullPage: true });
      await page.getByTestId("promo-intent").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/o9-stageg-390-promotion.png` });
      await page.getByTestId("promo-intent-PREMIUM-3").click();
      await page.getByTestId("promo-intent-BOOST-1").click();
      await expect(page.getByTestId("promo-intent-BOOST")).toHaveAttribute("data-selected", "true");
      await page.screenshot({ path: `${OUT}/o9-stageg-390-promotion-dual.png` });

      // 390 — FREE result screen
      await page.getByTestId("wizard-submit-skip-promo").click();
      await expect(page.getByTestId("wizard-result")).toHaveAttribute("data-outcome", "MODERATION", { timeout: 20_000 });
      await page.screenshot({ path: `${OUT}/o9-stageg-390-listing-free.png`, fullPage: true });

      // 390 — PAID result screen (4th publication)
      const payer = await loginAs(context, "+994508890007");
      await consumeFreePublications(payer.userId, 3);
      const paid = await insertListingFixture(payer.userId, { status: "DRAFT", complete: true, images: 3 });
      await page.goto(`/elan-yerlesdir/${paid.id}`);
      await openSection(page, "review");
      await expect(page.getByTestId("review-fee-value")).toHaveText("2 AZN");
      await page.getByTestId("wizard-submit").click();
      await expect(page.getByTestId("wizard-result")).toHaveAttribute("data-outcome", "PAYMENT", { timeout: 20_000 });
      await page.screenshot({ path: `${OUT}/o9-stageg-390-listing-paid.png`, fullPage: true });
    } finally {
      await sql`delete from payments where idempotency_key like 'o9g:%'`;
      await sql.end();
    }
  });
});
