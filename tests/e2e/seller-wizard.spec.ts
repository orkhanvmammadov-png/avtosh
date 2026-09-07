import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import {
  bumpListingRevision,
  consumeFreePublications,
  getListingEngineCc,
  getListingYear,
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

test("condition claims: check → autosave → reload → uncheck → null (4.17O.2)", async ({ page, context }, { project }) => {
  await loginAs(context, testPhone(project.name, 38));
  await page.goto("/elan-yerlesdir");
  await page.getByTestId("create-category-CAR").check();
  await page.getByTestId("create-listing-button").click();
  await page.waitForURL(/\/elan-yerlesdir\/[0-9a-f-]{36}$/);
  await page.getByTestId("wizard-step-2").click();
  await page.getByTestId("wizard-no-accident").check();
  await page.getByTestId("wizard-not-repainted").check();
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
  // claims survive a full reload (stored as TRUE)
  await page.reload();
  await page.getByTestId("wizard-step-2").click();
  await expect(page.getByTestId("wizard-no-accident")).toBeChecked();
  await expect(page.getByTestId("wizard-not-repainted")).toBeChecked();
  // removing a claim returns it to NULL (no negative claim stored)
  await page.getByTestId("wizard-not-repainted").uncheck();
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
  await page.reload();
  await page.getByTestId("wizard-step-2").click();
  await expect(page.getByTestId("wizard-no-accident")).toBeChecked();
  await expect(page.getByTestId("wizard-not-repainted")).not.toBeChecked();
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
  await page.getByTestId("wizard-year").click();
  await page.getByTestId("wizard-year-opt-2021").click();
  await saveSettled(page);

  // refresh retains draft state (server persistence, not local state)
  await page.reload();
  await expect(page.getByTestId("wizard-year")).toContainText("2021");
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
  await expect(page.getByTestId("wizard-year")).toContainText("2021");
  // Interactivity gate: the brand select is server-rendered DISABLED
  // and enables only after hydration + the catalog fetch effect —
  // interact only once the editor is provably live.
  await expect(page.getByTestId("wizard-brand")).toBeEnabled();

  await bumpListingRevision(fixture.id); // "another window" edits → server at N+1
  const stalePatch = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && r.url().includes(`/api/v1/me/listings/${fixture.id}`),
  );
  await page.getByTestId("wizard-year").click();
  await page.getByTestId("wizard-year-opt-2019").click();
  // the stale expected_revision is rejected by the SERVER, not the UI
  expect((await stalePatch).status()).toBe(409);
  const conflict = page.getByTestId("wizard-conflict");
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("Elan başqa pəncərədə dəyişdirilib.");

  // further edits are frozen — nothing silently retried or overwritten
  await page.getByTestId("wizard-year").click();
  await page.getByTestId("wizard-year-opt-2015").click();
  await expect(page.getByTestId("wizard-save-state")).not.toContainText("Yadda saxlanıldı");

  // explicit reload adopts the server version and reactivates editing
  await page.getByTestId("wizard-conflict-reload").click();
  await expect(conflict).toHaveCount(0);
  await expect(page.getByTestId("wizard-year")).toContainText("2021"); // local 2019 dropped
  await page.getByTestId("wizard-year").click();
  await page.getByTestId("wizard-year-opt-2018").click();
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
  expect(await getListingYear(fixture.id)).toBe(2018); // editing works again, on the fresh revision
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
  await expect(result.getByTestId("pay-button")).toBeVisible(); // real checkout action, no fake completion
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

test("vehicle attribute dropdowns: year policy, engine sequence, color palette (4.17O.3)", async ({ page, context }, { project }) => {
  test.setTimeout(120_000);
  const { userId } = await loginAs(context, testPhone(project.name, 37));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);

  // YEAR — single-select dropdown, not a manual text input
  const year = page.getByTestId("wizard-year");
  await expect(year).toContainText("2021"); // fixture restore
  expect(await year.evaluate((el) => el.tagName)).toBe("BUTTON");
  const yearMax = new Date().getFullYear() + 1; // = listingYearMax(); never hard-coded
  await year.click();
  const yearPanel = page.getByTestId("wizard-year-panel");
  await expect(yearPanel).toBeVisible();
  // newest first: currentYear+1 leads, 1900 closes the list
  await expect(yearPanel.locator('[role="option"]').first()).toHaveText(String(yearMax));
  await expect(yearPanel.locator('[role="option"]').last()).toHaveText("1900");
  await expect(page.getByTestId(`wizard-year-opt-${yearMax}`)).toBeAttached();
  await expect(page.getByTestId("wizard-year-opt-1900")).toBeAttached();
  await page.getByTestId("wizard-year-opt-2024").click();
  await expect(yearPanel).toBeHidden();
  await saveSettled(page);
  await expect(year).toContainText("2024");
  expect(await getListingYear(fixture.id)).toBe(2024);

  // ENGINE — single-select dropdown backed by engineCcOptions()
  await page.getByTestId("wizard-step-2").click();
  const engine = page.getByTestId("wizard-engine");
  expect(await engine.evaluate((el) => el.tagName)).toBe("BUTTON");
  await engine.click();
  const enginePanel = page.getByTestId("wizard-engine-panel");
  await expect(enginePanel).toBeVisible();
  await expect(page.getByTestId("wizard-engine-opt-0")).toBeAttached(); // literal 0 is a REAL option
  await expect(page.getByTestId("wizard-engine-opt-1800")).toHaveText("1 800");
  await expect(page.getByTestId("wizard-engine-opt-7000")).toBeAttached();
  await expect(page.getByTestId("wizard-engine-opt-16000")).toHaveText("16 000");
  await page.getByTestId("wizard-engine-opt-2000").click();
  await expect(enginePanel).toBeHidden();
  await saveSettled(page);
  await expect(engine).toContainText("2 000");
  expect(await getListingEngineCc(fixture.id)).toBe(2000);

  // COLOR — palette single-select: 20 approved options, swatch + label
  const color = page.getByTestId("wizard-color_id");
  await expect(color).toContainText("Rəng seçin"); // neutral state
  await color.click();
  const colorPanel = page.getByTestId("wizard-color_id-panel");
  await expect(colorPanel).toBeVisible();
  await expect(colorPanel.locator('[role="option"]')).toHaveCount(20);
  // swatch pipeline: catalog metadata.swatch reaches the rendered row
  const black = page.getByTestId("wizard-color_id-opt-BLACK");
  await expect(black).toContainText("Qara");
  await expect(black.locator("[data-swatch]")).toHaveAttribute("data-swatch", "#1B1E24");
  const white = page.getByTestId("wizard-color_id-opt-WHITE");
  await expect(white).toContainText("Ağ");
  await expect(white.locator("[data-swatch]")).toHaveAttribute("data-swatch", "#FFFFFF");
  // light swatches stay visible through a real (non-transparent) border
  const whiteBorder = await white
    .locator("[data-swatch]")
    .evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(whiteBorder).not.toBe("rgba(0, 0, 0, 0)");

  // selecting Qara closes the palette and fills the trigger
  await black.click();
  await expect(colorPanel).toBeHidden();
  await saveSettled(page);
  await expect(color).toContainText("Qara");
  // single-select semantics: Ağ REPLACES Qara — exactly one selected
  await color.click();
  await expect(colorPanel.locator('[aria-selected="true"]')).toHaveCount(1);
  await expect(black).toHaveAttribute("aria-selected", "true");
  await white.click();
  await saveSettled(page);
  await expect(color).toContainText("Ağ");
  await color.click();
  await expect(colorPanel.locator('[aria-selected="true"]')).toHaveCount(1);
  await expect(white).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(colorPanel).toBeHidden();

  // Next / Back keeps all three. Each navigation commits its addim
  // URL update asynchronously — wait for the URL AND the settled
  // network before the next click (a click during the in-flight
  // router.replace stream aborts it; the dev server then surfaces an
  // error overlay that intercepts pointer events).
  await page.getByTestId("wizard-next").click();
  await page.waitForURL(/addim=3/);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("wizard-back").click();
  await page.waitForURL(/addim=2/);
  await page.waitForLoadState("networkidle");
  await expect(engine).toContainText("2 000");
  await expect(color).toContainText("Ağ");
  await page.getByTestId("wizard-step-1").click();
  await page.waitForURL(/addim=1/);
  await page.waitForLoadState("networkidle");
  await expect(year).toContainText("2024");

  // reload / reopen restores all three from the server
  await page.reload();
  await expect(year).toContainText("2024");
  await page.getByTestId("wizard-step-2").click();
  await page.waitForURL(/addim=2/);
  await page.waitForLoadState("networkidle");
  await expect(engine).toContainText("2 000");
  await expect(color).toContainText("Ağ");

  // clear returns color to the neutral state (color_id → null)
  await page.getByTestId("wizard-color_id-clear").click();
  await saveSettled(page);
  await expect(color).toContainText("Rəng seçin");
  await page.reload();
  await expect(color).toContainText("Rəng seçin");
});

test("legacy engine_cc outside the sequence is preserved, never normalized (4.17O.3)", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 39));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, engineCc: 1998 });
  await page.goto(`/elan-yerlesdir/${fixture.id}?addim=2`);

  // the historical value is visibly selected, injected into the list
  const engine = page.getByTestId("wizard-engine");
  await expect(engine).toContainText("1 998");
  await engine.click();
  const legacyOption = page.getByTestId("wizard-engine-opt-1998");
  await expect(legacyOption).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");

  // an unrelated edit + autosave must not rewrite it
  await page.getByTestId("wizard-mileage").fill("65000");
  await saveSettled(page);
  expect(await getListingEngineCc(fixture.id)).toBe(1998);

  // Next / Back / reload all keep the literal value (wait for the
  // committed addim URL and the settled network after each navigation
  // so the reload deterministically lands back on step 2 and no
  // aborted router stream raises the dev error overlay)
  await page.getByTestId("wizard-next").click();
  await page.waitForURL(/addim=3/);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("wizard-back").click();
  await page.waitForURL(/addim=2/);
  await page.waitForLoadState("networkidle");
  await expect(engine).toContainText("1 998");
  await page.reload();
  await expect(engine).toContainText("1 998");

  // only a DELIBERATE standard selection replaces it — and the
  // temporary option then disappears
  await engine.click();
  await page.getByTestId("wizard-engine-opt-2000").click();
  await saveSettled(page);
  expect(await getListingEngineCc(fixture.id)).toBe(2000);
  await engine.click();
  await expect(page.getByTestId("wizard-engine-opt-1998")).toHaveCount(0);
});

test("motorcycle drafts use the same year/engine/color controls (4.17O.3)", async ({ page, context }, { project }) => {
  await loginAs(context, testPhone(project.name, 40));
  await page.goto("/elan-yerlesdir");
  await page.getByTestId("create-category-MOTORCYCLE").check();
  await page.getByTestId("create-listing-button").click();
  await page.waitForURL(/\/elan-yerlesdir\/[0-9a-f-]{36}$/);

  await page.getByTestId("wizard-year").click();
  await page.getByTestId("wizard-year-opt-2022").click();
  await saveSettled(page);
  await expect(page.getByTestId("wizard-year")).toContainText("2022");

  await page.getByTestId("wizard-step-2").click();
  await page.waitForURL(/addim=2/);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("wizard-engine").click();
  await page.getByTestId("wizard-engine-opt-600").click();
  await saveSettled(page);
  await expect(page.getByTestId("wizard-engine")).toContainText("600");

  await page.getByTestId("wizard-color_id").click();
  await expect(page.getByTestId("wizard-color_id-panel").locator('[role="option"]')).toHaveCount(20);
  await page.getByTestId("wizard-color_id-opt-RED").click();
  await saveSettled(page);
  await expect(page.getByTestId("wizard-color_id")).toContainText("Qırmızı");

  // values survive a reload for the motorcycle draft too (reload
  // lands on step 2 per the committed addim URL)
  await page.reload();
  await expect(page.getByTestId("wizard-engine")).toContainText("600");
  await expect(page.getByTestId("wizard-color_id")).toContainText("Qırmızı");
  await page.getByTestId("wizard-step-1").click();
  await expect(page.getByTestId("wizard-year")).toContainText("2022");
});
