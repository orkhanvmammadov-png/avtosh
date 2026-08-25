import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import {
  bumpListingRevision,
  consumeFreePublications,
  insertListingFixture,
  listingCounts,
  makeTestJpeg,
  setListingFeeMinor,
} from "./seller-helpers";

/**
 * Seller wizard flows through the real owner APIs. Image uploads run
 * the genuine signed-URL → direct PUT → confirm pipeline against the
 * local dev storage driver.
 */

async function saveSettled(page: Page) {
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
}

async function uploadJpegs(page: Page, count: number, startColor = 40) {
  const files = [];
  for (let i = 0; i < count; i += 1) {
    files.push({
      name: `photo-${startColor + i}.jpg`,
      mimeType: "image/jpeg",
      buffer: await makeTestJpeg(800, 600, startColor + i * 30),
    });
  }
  await page.getByTestId("wizard-photos-input").setInputFiles(files);
}

test("anonymous seller entry routes through login intent", async ({ page }) => {
  await page.goto("/elan-yerlesdir");
  await expect(page).toHaveURL(/\/giris\?return_to=%2Felan-yerlesdir$/);
});

test("blocked seller sees a safe status message, no wizard", async ({ page, context }, { project }) => {
  await loginAs(context, testPhone(project.name, 30), { blocked: true });
  await page.goto("/elan-yerlesdir");
  await expect(page.getByTestId("seller-blocked")).toBeVisible();
  await expect(page.getByTestId("create-listing")).toHaveCount(0);
});

test("full seller journey: create → fill → photos → preview → FREE submit", async ({ page, context }, { project }) => {
  test.setTimeout(180_000);
  const s = seed();
  await loginAs(context, testPhone(project.name, 31));

  // explicit creation — never on page load
  await page.goto("/elan-yerlesdir");
  await expect(page.getByTestId("seller-entry")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("create-category-CAR").check();
  await page.getByTestId("create-listing-button").click();
  await expect(page).toHaveURL(/\/elan-yerlesdir\/[0-9a-f-]{36}$/);

  // step 1 — vehicle (selects save immediately)
  await page.getByTestId("wizard-brand").selectOption(s.toyotaBrandId);
  await page.getByTestId("wizard-model").selectOption(s.corollaModelId);
  await page.getByTestId("wizard-year").fill("2021");
  await saveSettled(page);

  // refresh retains draft state (server persistence, not local state)
  await page.reload();
  await expect(page.getByTestId("wizard-year")).toHaveValue("2021");
  await expect(page.getByTestId("wizard-model")).toHaveValue(s.corollaModelId);

  // step 2 — details (price entered in AZN)
  await page.getByTestId("wizard-step-2").click();
  await page.getByTestId("wizard-price").fill("25000");
  await page.getByTestId("wizard-mileage").fill("64000");
  await page.getByTestId("wizard-city").selectOption(s.bakuCityId);
  await saveSettled(page);

  // step 4 first — description & contact (so the only submit blocker
  // left is the image minimum, exercised below)
  await page.getByTestId("wizard-step-4").click();
  await page.getByTestId("wizard-description").fill("Əla vəziyyətdə Toyota Corolla. E2E test elanı.");
  await page.getByTestId("wizard-contact-phone").fill("+994501234567");
  await saveSettled(page);

  // premature submit (0 photos) must fail safely via the backend
  await page.getByTestId("wizard-step-5").click();
  await page.getByTestId("wizard-submit").click();
  await expect(page.getByTestId("wizard-submit-error")).toContainText("Şəkil sayı kifayət deyil");

  // step 3 — photos: unsupported file rejected client-side with a clear message
  await page.getByTestId("wizard-step-3").click();
  await page.getByTestId("wizard-photos-input").setInputFiles({
    name: "document.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-fake"),
  });
  await expect(page.getByTestId("wizard-upload-queue")).toContainText("Bu format dəstəklənmir");

  // real uploads through the signed-URL pipeline
  await uploadJpegs(page, 3);
  await expect(page.getByTestId("wizard-image-grid").locator('[data-testid="wizard-image"]')).toHaveCount(3, { timeout: 60_000 });
  await expect(page.locator('[data-testid="wizard-image"][data-primary="true"]')).toHaveCount(1);

  // reorder + explicit primary + delete/reupload
  const grid = page.getByTestId("wizard-image-grid");
  const firstId = await grid.locator('[data-testid="wizard-image"]').first().getAttribute("data-image-id");
  await grid.locator('[data-testid="image-move-right"]').first().click();
  await expect(grid.locator('[data-testid="wizard-image"]').nth(1)).toHaveAttribute("data-image-id", firstId!);
  await grid.locator('[data-testid="image-make-primary"]').first().click();
  await expect(grid.locator('[data-testid="wizard-image"]').first()).toHaveAttribute("data-primary", "true", { timeout: 15_000 });
  await grid.locator('[data-testid="image-delete"]').last().click();
  await expect(grid.locator('[data-testid="wizard-image"]')).toHaveCount(2, { timeout: 15_000 });
  await uploadJpegs(page, 1, 200);
  await expect(grid.locator('[data-testid="wizard-image"]')).toHaveCount(3, { timeout: 60_000 });

  // step 5 — preview shows entered data + advisory quota; FREE submit
  await page.getByTestId("wizard-step-5").click();
  await expect(page.getByTestId("wizard-completeness")).toContainText("hazırdır");
  await expect(page.getByTestId("wizard-preview")).toContainText("Toyota Corolla 2021");
  await expect(page.getByTestId("wizard-preview")).toContainText("25 000 AZN");
  await expect(page.getByTestId("wizard-quota")).toContainText("pulsuz");
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("wizard-submit").click();
  await expect(page.getByTestId("wizard-result")).toHaveAttribute("data-outcome", "MODERATION", { timeout: 20_000 });

  // the new state is visible in My Listings
  await page.goto("/profil/elanlar");
  await expect(page.locator('[data-testid="owner-listing-card"][data-status="PENDING_MODERATION"]').first()).toBeVisible();
});

test("category change clears dependent brand/model via the server", async ({ page, context }, { project }) => {
  const s = seed();
  const { userId } = await loginAs(context, testPhone(project.name, 32));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await expect(page.getByTestId("wizard-brand")).toHaveValue(s.toyotaBrandId);
  await page.getByTestId("wizard-category").selectOption("MOTORCYCLE");
  // server clears brand/model; the UI adopts the response DTO
  await expect(page.getByTestId("wizard-brand")).toHaveValue("", { timeout: 15_000 });
  await expect(page.getByTestId("wizard-model")).toHaveValue("");
  await expect(page.getByTestId("wizard-model")).toBeDisabled();
});

test("stale revision conflict freezes editing until explicit reload", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 33));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await expect(page.getByTestId("wizard-year")).toHaveValue("2021");

  await bumpListingRevision(fixture.id); // "another window" edits
  await page.getByTestId("wizard-year").fill("2019");
  const conflict = page.getByTestId("wizard-conflict");
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await expect(conflict).toContainText("Elan başqa pəncərədə dəyişdirilib.");

  // further edits are frozen — nothing silently retried or overwritten
  await page.getByTestId("wizard-year").fill("2015");
  await expect(page.getByTestId("wizard-save-state")).not.toContainText("Yadda saxlanıldı");

  // explicit reload adopts the server version and reactivates editing
  await page.getByTestId("wizard-conflict-reload").click();
  await expect(conflict).toHaveCount(0);
  await expect(page.getByTestId("wizard-year")).toHaveValue("2021"); // local 2019 dropped
  await page.getByTestId("wizard-year").fill("2018");
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
});

test("paid boundary: 4th publication submits into PAYMENT_REQUIRED with the server fee", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 34));
  await consumeFreePublications(userId, 3);
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await page.goto(`/elan-yerlesdir/${fixture.id}?addim=5`);
  await expect(page.getByTestId("wizard-quota")).toContainText("2 AZN");
  const before = await listingCounts(userId);
  await page.getByTestId("wizard-submit").click();
  const result = page.getByTestId("wizard-result");
  await expect(result).toHaveAttribute("data-outcome", "PAYMENT", { timeout: 20_000 });
  await expect(page.getByTestId("wizard-payment-amount")).toHaveText("2 AZN");
  await expect(result).toContainText("Onlayn ödəniş tezliklə"); // no fake checkout
  const after = await listingCounts(userId);
  expect(after.publications).toBe(before.publications + 1);
  expect(after.payments).toBe(before.payments + 1); // CREATED intent only

  // revisiting the listing shows the payment-required state, not the editor
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await expect(page.getByTestId("wizard-status-payment")).toBeVisible();
  await expect(page.getByTestId("payment-intent-amount")).toHaveText("2 AZN");

  // REGRESSION: raising the publication-fee setting AFTER the intent
  // was created must not change the seller's existing debt display.
  try {
    await setListingFeeMinor(300);
    await page.reload();
    await expect(page.getByTestId("wizard-status-payment")).toBeVisible();
    await expect(page.getByTestId("payment-intent-amount")).toHaveText("2 AZN");
    await expect(page.getByTestId("wizard-status-payment")).not.toContainText("3 AZN");
  } finally {
    await setListingFeeMinor(200);
  }
});

test("wizard route is owner-scoped — foreign listings 404", async ({ page, context }, { project }) => {
  const victim = await loginAs(context, testPhone(project.name, 35));
  const fixture = await insertListingFixture(victim.userId, { status: "DRAFT", complete: true });
  await context.clearCookies();
  await loginAs(context, testPhone(project.name, 36));
  const response = await page.goto(`/elan-yerlesdir/${fixture.id}`);
  expect(response?.status()).toBe(404);
});
