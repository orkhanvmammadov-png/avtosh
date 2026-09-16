import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import {
  bumpListingRevision,
  clearListingContact,
  consumeFreePublications,
  getContactIsolation,
  getListingCatalogIds,
  getUserDisplayName,
  setUserDisplayName,
  getListingEngineCc,
  getListingYear,
  insertListingFixture,
  listingCounts,
  setListingSaleFields,
  makeTestJpeg,
  setListingFeeMinor,
} from "./seller-helpers";

/**
 * O.9 AXIN seller flow through the real owner APIs (Quick Start →
 * one-page section cards). Image uploads run the genuine signed-URL →
 * direct PUT → confirm pipeline against the local dev storage driver.
 * Sealed O.3/O.4 attribute-control contracts are re-asserted inside
 * the new sections.
 */

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

/** Types into a typeahead and picks the named option. */
async function pickTypeahead(page: Page, id: string, query: string, optionName: string) {
  const input = page.getByTestId(id);
  await input.click();
  await input.fill(query);
  await page.getByTestId(`${id}-listbox`).getByText(optionName, { exact: true }).click();
  await expect(input).toHaveValue(optionName);
}

/** Runs the navy Quick Start end-to-end and lands in the AXIN flow. */
async function quickStartCreate(
  page: Page,
  input: { category: "CAR" | "MOTORCYCLE"; brand: string; model: string; year: number },
) {
  await page.goto("/elan-yerlesdir");
  await expect(page.getByTestId("quick-start")).toBeVisible();
  await page.getByTestId(`quick-start-category-${input.category}`).click();
  await pickTypeahead(page, "quick-start-brand", input.brand.slice(0, 3), input.brand);
  await pickTypeahead(page, "quick-start-model", input.model.slice(0, 2), input.model);
  await page.getByTestId("quick-start-year").click();
  await page.getByTestId(`quick-start-year-opt-${input.year}`).click();
  await page.getByTestId("quick-start-begin").click();
  await page.waitForURL(/\/elan-yerlesdir\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("axin-flow")).toBeVisible();
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

test("blocked seller sees a safe status message, no quick start", async ({ page, context }, { project }) => {
  await loginAs(context, testPhone(project.name, 30), { blocked: true });
  await page.goto("/elan-yerlesdir");
  await expect(page.getByTestId("seller-blocked")).toBeVisible();
  await expect(page.getByTestId("quick-start")).toHaveCount(0);
});

test("quick start: dependency, no-results, keyboard; nothing persists before Başla", async ({ page, context }, { project }) => {
  await loginAs(context, testPhone(project.name, 38));
  await page.goto("/elan-yerlesdir");
  const qs = page.getByTestId("quick-start");
  await expect(qs).toBeVisible();
  // model gated on brand with the approved hint
  await expect(page.getByTestId("quick-start-model")).toBeDisabled();
  await expect(page.getByTestId("quick-start-model")).toHaveAttribute("placeholder", "Marka seçin");
  // begin is disabled until all four selections exist
  await expect(page.getByTestId("quick-start-begin")).toBeDisabled();
  // typeahead: filter, no-results row, keyboard selection
  const brand = page.getByTestId("quick-start-brand");
  await brand.click();
  await brand.fill("zzz-yoxdur");
  await expect(page.getByTestId("quick-start-brand-empty")).toHaveText("Nəticə tapılmadı");
  await brand.fill("Toy");
  // synchronize on REAL readiness: the option must be rendered before
  // keyboard navigation can select it (the async brand catalog can
  // land after fill on a slow worker)
  await expect(page.getByTestId("quick-start-brand-listbox").getByText("Toyota", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(brand).toHaveValue(/Toyota/);
  // brand change clears the chosen model
  await pickTypeahead(page, "quick-start-model", "Co", "Corolla");
  await brand.click();
  await brand.fill("Toy");
  await page.getByTestId("quick-start-brand-listbox").getByText("Toyota", { exact: true }).click();
  await expect(page.getByTestId("quick-start-model")).toHaveValue("");
});

test("O.10 frontier Continue is index+1 — later-valid data never causes a jump", async ({ page, context }, { project }) => {
  await loginAs(context, testPhone(project.name, 55));
  await quickStartCreate(page, { category: "CAR", brand: "Toyota", model: "Corolla", year: 2020 });
  const listingId = page.url().match(/([0-9a-f-]{36})$/)![1];
  await expect(page.getByTestId("axin-section-details")).toHaveAttribute("data-state", "open");
  // make the NEXT stage (Satış) fully valid behind the scenes — a
  // next-incomplete scan would now skip it straight to Şəkillər
  await setListingSaleFields(listingId);
  await page.getByTestId("axin-continue-details").click();
  await expect(page.getByTestId("axin-section-sale")).toHaveAttribute("data-state", "open"); // +1, no jump
  await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 3 / 6");
  // upcoming stages are non-interactive — clicking changes nothing
  const upcoming = page.getByTestId("axin-section-review");
  await expect(upcoming).toHaveAttribute("data-state", "upcoming");
  await upcoming.click({ force: true });
  await expect(page.getByTestId("axin-section-sale")).toHaveAttribute("data-state", "open");
  await expect(upcoming).toHaveAttribute("data-state", "upcoming");
});

test("condition claims: check → autosave → reload → uncheck → null (4.17O.2)", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 38));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSection(page, "sale");
  // O.9 chips: the visible chip is the click target; the underlying
  // REAL checkbox keeps the state contract for assertions.
  await page.getByTestId("wizard-no-accident-chip").click();
  await page.getByTestId("wizard-not-repainted-chip").click();
  await saveSettled(page);
  // claims survive a full reload (stored as TRUE)
  await page.reload();
  await openSection(page, "sale");
  await expect(page.getByTestId("wizard-no-accident")).toBeChecked();
  await expect(page.getByTestId("wizard-not-repainted")).toBeChecked();
  // removing a claim returns it to NULL (no negative claim stored)
  await page.getByTestId("wizard-not-repainted-chip").click();
  await saveSettled(page);
  await page.reload();
  await openSection(page, "sale");
  await expect(page.getByTestId("wizard-no-accident")).toBeChecked();
  await expect(page.getByTestId("wizard-not-repainted")).not.toBeChecked();
});

test("full seller journey: quick start → sections → photos → review → FREE submit", async ({ page, context }, { project }) => {
  test.setTimeout(180_000);
  await loginAs(context, testPhone(project.name, 31));

  // explicit creation through the navy Quick Start — never on page load
  await page.goto("/elan-yerlesdir");
  await expect(page.getByTestId("seller-entry")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await quickStartCreate(page, { category: "CAR", brand: "Toyota", model: "Corolla", year: 2021 });

  // O.10 HARD REQUIREMENT: after Başla, DETALLAR is CURRENT — the
  // optional stage is never auto-skipped for a fresh NEW listing.
  await expect(page.getByTestId("axin-section-details")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 2 / 6");
  await expect(page.getByTestId("axin-summary-quickstart")).toContainText("Toyota");
  await expect(page.getByTestId("axin-summary-quickstart")).toContainText("2021");
  // later stages are UPCOMING — never ✓ merely because they are optional
  await expect(page.getByTestId("axin-section-info-contact")).toHaveAttribute("data-state", "upcoming");
  await expect(page.getByTestId("axin-section-review")).toHaveAttribute("data-state", "upcoming");

  // refresh retains draft state AND lands back on Detallar (resume)
  await page.reload();
  await expect(page.getByTestId("axin-section-details")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("axin-summary-quickstart")).toContainText("Toyota");

  // Detallar fully EMPTY → Davam et → Satış (sequential, never skipped)
  await page.getByTestId("axin-continue-details").click();
  await expect(page.getByTestId("axin-section-sale")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 3 / 6");
  await expect(page.getByTestId("axin-section-details")).toHaveAttribute("data-state", "visited"); // visited ≠ data entered

  // Satış — required trio gates its own Davam et
  await expect(page.getByTestId("axin-continue-sale")).toBeDisabled();
  await page.getByTestId("wizard-price").fill("25000");
  await page.getByTestId("wizard-mileage").fill("64000");
  await page.getByTestId("wizard-city").selectOption(seed().bakuCityId);
  await saveSettled(page);
  await page.getByTestId("axin-continue-sale").click();
  await expect(page.getByTestId("axin-section-photos")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 4 / 6");

  // MONOTONIC PROGRESS: backward Dəyiş reopens Detallar but the
  // journey position does NOT collapse; its Davam et returns forward
  // to the furthest stage without re-traversing.
  await page.getByTestId("axin-section-details").click();
  await expect(page.getByTestId("axin-section-details")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 4 / 6");
  await page.getByTestId("axin-continue-details").click();
  await expect(page.getByTestId("axin-section-photos")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 4 / 6");

  // Şəkillər — amber minimum guidance; Davam et blocked below 3
  await expect(page.getByTestId("wizard-photo-count")).toContainText("0/3 minimum");
  await expect(page.getByTestId("axin-continue-photos")).toBeDisabled();
  await expect(page.getByTestId("wizard-photo-add")).toBeVisible();
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
  await expect(page.getByTestId("wizard-photo-count")).toContainText("3 / 20"); // minimum satisfied
  await page.getByTestId("axin-continue-photos").click();

  // Stage 5 — combined Əlavə məlumat və əlaqə (ONE stage, ONE Davam et)
  await expect(page.getByTestId("axin-section-info-contact")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 5 / 6");
  await expect(page.getByTestId("axin-continue-info-contact")).toBeDisabled(); // contact required
  // ONE combined card, TWO subgroups (combined-stage.md)
  await expect(page.getByTestId("subgroup-extras")).toContainText("istəyə bağlıdır");
  await expect(page.getByTestId("subgroup-contact")).toContainText("mütləqdir");
  await expect(page.getByTestId("axin-continue-info-contact")).toHaveCount(1); // one CTA only
  const featuresToggle = page.getByTestId("wizard-features-toggle");
  await expect(featuresToggle).toHaveAttribute("aria-expanded", "false");
  await featuresToggle.click();
  await expect(page.getByTestId("wizard-features")).toBeVisible();
  // the checkbox is CONTROLLED by the server DTO — click, then await
  // the round-trip state (check() would assert synchronously)
  const firstFeature = page.getByTestId("wizard-features").locator('input[type="checkbox"]').first();
  await firstFeature.click();
  await expect(firstFeature).toBeChecked();
  await saveSettled(page);
  await expect(featuresToggle).toContainText("1 təchizat seçilib"); // O.11 honest summary
  await page.getByTestId("wizard-description").fill("Əla vəziyyətdə Toyota Corolla. E2E test elanı.");
  await expect(page.getByTestId("wizard-description-count")).toContainText("/5000");
  await page.getByTestId("wizard-seller-name").fill("E2E Satıcı");
  await page.getByTestId("wizard-contact-phone").fill("+994501234567");
  await saveSettled(page);
  // AUTH ISOLATION (mandatory): the LISTING contact differs from the
  // login phone; users.phone_e164 is never touched by the seller flow.
  const listingId = page.url().match(/([0-9a-f-]{36})$/)![1];
  {
    const iso = await getContactIsolation(listingId, (await loginAs(context, testPhone(project.name, 31))).userId);
    expect(iso.userPhone).toBe(testPhone(project.name, 31)); // login identity untouched
    expect(iso.listingContact).toBe("+994501234567"); // listing-level contact
    expect(iso.sellerName).toBe("E2E Satıcı"); // listing-level name only
  }
  await page.getByTestId("axin-continue-info-contact").click();
  await expect(page.getByTestId("axin-section-review")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 6 / 6");

  // Baxış — preview shows entered data + advisory quota; FREE submit
  await openSection(page, "review");
  await expect(page.getByTestId("wizard-completeness")).toContainText("hazırdır");
  await expect(page.getByTestId("wizard-preview")).toContainText("Toyota Corolla 2021");
  await expect(page.getByTestId("wizard-preview")).toContainText("25 000 AZN");
  await expect(page.getByTestId("wizard-quota")).toContainText("pulsuz");
  await expect(page.getByTestId("review-fee-value")).toHaveText("Pulsuz");
  // the ƏLAQƏ review block catches wrong name/phone before submit
  await expect(page.getByTestId("review-contact-name")).toHaveText("E2E Satıcı");
  await expect(page.getByTestId("review-contact-phone")).toHaveText("050 123 45 67"); // friendly local format
  // Dəyiş jumps straight to the owning COMBINED stage and back —
  // contact fields and extras both route to infoContact
  await page.getByTestId("review-edit-contact").click();
  await expect(page.getByTestId("axin-section-info-contact")).toHaveAttribute("data-state", "open");
  await openSection(page, "review");
  await page.getByTestId("review-edit-extras").click();
  await expect(page.getByTestId("axin-section-info-contact")).toHaveAttribute("data-state", "open");
  await openSection(page, "review");
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("wizard-submit").click();
  await expect(page.getByTestId("wizard-result")).toHaveAttribute("data-outcome", "MODERATION", { timeout: 20_000 });

  // the new state is visible in My Listings
  await page.goto("/profil/elanlar");
  await expect(page.locator('[data-testid="owner-listing-card"][data-status="PENDING_MODERATION"]').first()).toBeVisible();
});

test("contact section: O.1 local phone UX, login-phone suggestion, inline validation (O.9E)", async ({ page, context }, { project }) => {
  const authPhone = testPhone(project.name, 45);
  const { userId } = await loginAs(context, authPhone);
  // O.10: the combined stage must be REACHED — use a draft whose
  // journey resume lands there (all prior stages data-complete,
  // contact cleared).
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await clearListingContact(fixture.id);
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSection(page, "info-contact");
  await expect(page.getByTestId("axin-section-info-contact")).toContainText("yalnız bu elan üçün");
  // name required — inline, on blur, no modal
  await page.getByTestId("wizard-seller-name").click();
  await page.getByTestId("wizard-contact-phone").click(); // blur name
  await expect(page.getByText("Ad mütləqdir")).toBeVisible();
  await page.getByTestId("wizard-seller-name").fill("  Orxan M.  ");
  await saveSettled(page);
  // phone: live O.1 local grouping while typing
  const phone = page.getByTestId("wizard-contact-phone");
  await phone.fill("0102184191");
  await expect(phone).toHaveValue("010 218 41 91");
  await saveSettled(page);
  // incomplete number → the approved inline message
  await phone.fill("010 21");
  await page.getByTestId("wizard-seller-name").click(); // blur phone
  await expect(page.getByText("Nömrə natamamdır", { exact: false })).toBeVisible();
  // an invalid pending phone blocks advancing: the flush inside Davam
  // et fails (server rejects), navigation refuses, save-error shows —
  // Review stays unreachable and nothing fake is stored
  await page.getByTestId("axin-continue-info-contact").click();
  await expect(page.getByTestId("axin-section-info-contact")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanmadı. Yenidən cəhd edin.");
  // one-tap login-phone suggestion appears only for an EMPTY unsaved field
  await phone.fill("");
  await saveSettled(page); // contact cleared server-side
  await expect(page.getByTestId("axin-continue-info-contact")).toBeDisabled(); // name+phone both required
  const chip = page.getByTestId("contact-use-login-phone");
  await expect(chip).toBeVisible();
  await chip.click();
  await saveSettled(page);
  const iso = await getContactIsolation(fixture.id, userId);
  expect(iso.listingContact).toBe(authPhone); // explicit action persisted it
  expect(iso.userPhone).toBe(authPhone); // auth identity merely read, never written
  expect(iso.sellerName).toBe("Orxan M."); // trimmed listing-level name
  // reload restores the friendly display from the server value
  await page.reload();
  await openSection(page, "info-contact");
  await expect(page.getByTestId("wizard-seller-name")).toHaveValue("Orxan M.");
  const display = await page.getByTestId("wizard-contact-phone").inputValue();
  expect(display.replace(/\s/g, "")).toBe(`0${authPhone.slice(4)}`); // 0XX XXX XX XX of the same number
});

test("profile display name is an explicit suggestion, never phantom-completed listing data (O.9E)", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 50));
  await setUserDisplayName(userId, "Seller A");
  try {
    const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
    await clearListingContact(fixture.id);
    await page.goto(`/elan-yerlesdir/${fixture.id}`);
    await openSection(page, "info-contact");
    // the field is NOT falsely prefilled while listings.seller_name is
    // NULL — persisted state and UI can never disagree
    await expect(page.getByTestId("wizard-seller-name")).toHaveValue("");
    await expect(page.getByTestId("axin-section-info-contact")).not.toHaveAttribute("data-state", "complete");
    const chip = page.getByTestId("contact-use-profile-name");
    await expect(chip).toContainText("Seller A");
    // explicit acceptance persists through the normal PATCH
    await chip.click();
    await expect(page.getByTestId("wizard-seller-name")).toHaveValue("Seller A");
    await saveSettled(page);
    expect((await getContactIsolation(fixture.id, userId)).sellerName).toBe("Seller A");
    // reload restores from the LISTING, chip no longer offered
    await page.reload();
    await openSection(page, "info-contact");
    await expect(page.getByTestId("wizard-seller-name")).toHaveValue("Seller A");
    await expect(page.getByTestId("contact-use-profile-name")).toHaveCount(0);
    // the account-level name was only read, never written
    expect(await getUserDisplayName(userId)).toBe("Seller A");
  } finally {
    await setUserDisplayName(userId, null);
  }
});

test("failed upload is a real retryable state, never a phantom photo", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 44));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSection(page, "photos");
  // the first signed-URL PUT is aborted (network failure); the retry
  // goes through the real pipeline unchanged
  let failedOnce = false;
  await page.route("**/api/dev-storage/**", (route) => {
    if (route.request().method() === "PUT" && !failedOnce) {
      failedOnce = true;
      return route.abort();
    }
    return route.continue();
  });
  await uploadJpegs(page, 1);
  const errorTile = page.getByTestId("wizard-upload-queue").locator('[data-state="error"]');
  await expect(errorTile).toBeVisible();
  await expect(page.locator('[data-testid="wizard-image"]')).toHaveCount(0); // no phantom confirmed photo
  await page.getByTestId("image-retry").click();
  await expect(page.locator('[data-testid="wizard-image"]')).toHaveCount(1, { timeout: 60_000 });
  await expect(errorTile).toHaveCount(0);
});

test("category change clears dependent brand/model via the server", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 32));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSection(page, "quickstart");
  await expect(page.getByTestId("wizard-brand")).toHaveValue("Toyota");
  // data would be lost → the approved confirmation appears
  page.on("dialog", (dialog) => void dialog.accept());
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
  await openSection(page, "quickstart");
  await expect(page.getByTestId("wizard-year")).toContainText("2021");
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
  await openSection(page, "quickstart");
  await expect(page.getByTestId("wizard-year")).toContainText("2021"); // local 2019 dropped
  await page.getByTestId("wizard-year").click();
  await page.getByTestId("wizard-year-opt-2018").click();
  await saveSettled(page);
  expect(await getListingYear(fixture.id)).toBe(2018); // editing works again, on the fresh revision
});

test("paid boundary: 4th publication submits into PAYMENT_REQUIRED with the server fee", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 34));
  await consumeFreePublications(userId, 3);
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSection(page, "review");
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

  // YEAR — single-select dropdown in Quick Start, not a manual input
  await openSection(page, "quickstart");
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
  await openSection(page, "details");
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

  // switching between sections keeps all three (one-page flow)
  await openSection(page, "sale");
  await openSection(page, "details");
  await expect(engine).toContainText("2 000");
  await expect(color).toContainText("Ağ");
  await openSection(page, "quickstart");
  await expect(year).toContainText("2024");

  // reload / reopen restores all three from the server
  await page.reload();
  await openSection(page, "quickstart");
  await expect(year).toContainText("2024");
  await openSection(page, "details");
  await expect(engine).toContainText("2 000");
  await expect(color).toContainText("Ağ");

  // clear returns color to the neutral state (color_id → null)
  await page.getByTestId("wizard-color_id-clear").click();
  await saveSettled(page);
  await expect(color).toContainText("Rəng seçin");
  await page.reload();
  await openSection(page, "details");
  await expect(color).toContainText("Rəng seçin");
});

test("legacy engine_cc outside the sequence is preserved, never normalized (4.17O.3)", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 39));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, engineCc: 1998 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSection(page, "details");

  // the historical value is visibly selected, injected into the list
  const engine = page.getByTestId("wizard-engine");
  await expect(engine).toContainText("1 998");
  await engine.click();
  const legacyOption = page.getByTestId("wizard-engine-opt-1998");
  await expect(legacyOption).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");

  // an unrelated edit + autosave must not rewrite it
  await openSection(page, "sale");
  await page.getByTestId("wizard-mileage").fill("65000");
  await saveSettled(page);
  expect(await getListingEngineCc(fixture.id)).toBe(1998);

  // section switches and reload all keep the literal value
  await openSection(page, "details");
  await expect(engine).toContainText("1 998");
  await page.reload();
  await openSection(page, "details");
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

test("motorcycle quick start uses the same year/engine/color controls (4.17O.3)", async ({ page, context }, { project }) => {
  await loginAs(context, testPhone(project.name, 40));
  await quickStartCreate(page, { category: "MOTORCYCLE", brand: "Yamaha", model: "MT-07", year: 2022 });

  await openSection(page, "quickstart");
  await expect(page.getByTestId("wizard-year")).toContainText("2022");

  await openSection(page, "details");
  // MOTORCYCLE relevance: no CAR-only controls, not even disabled
  await expect(page.getByTestId("wizard-drive_type_id")).toHaveCount(0);
  await expect(page.getByTestId("wizard-body_type_id")).toHaveCount(0);
  await page.getByTestId("wizard-engine").click();
  await page.getByTestId("wizard-engine-opt-600").click();
  await saveSettled(page);
  await expect(page.getByTestId("wizard-engine")).toContainText("600");

  await page.getByTestId("wizard-color_id").click();
  await expect(page.getByTestId("wizard-color_id-panel").locator('[role="option"]')).toHaveCount(20);
  await page.getByTestId("wizard-color_id-opt-RED").click();
  await saveSettled(page);
  await expect(page.getByTestId("wizard-color_id")).toContainText("Qırmızı");

  // values survive a reload for the motorcycle draft too
  await page.reload();
  await openSection(page, "details");
  await expect(page.getByTestId("wizard-engine")).toContainText("600");
  await expect(page.getByTestId("wizard-color_id")).toContainText("Qırmızı");
  await openSection(page, "quickstart");
  await expect(page.getByTestId("wizard-year")).toContainText("2022");
});

test("catalog option selects persist UUIDs, not codes — CAR (4.17O.4)", async ({ page, context }, { project }) => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/;
  const { userId } = await loginAs(context, testPhone(project.name, 41));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });
  // the defect made these PATCHes die at Zod with 400 — record any
  const badPatches: string[] = [];
  page.on("response", (r) => {
    if (r.request().method() === "PATCH" && r.url().includes("/api/v1/me/listings/") && r.status() === 400) {
      badPatches.push(r.url());
    }
  });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSection(page, "details");

  await page.getByTestId("wizard-body_type_id").selectOption({ label: "Sedan" });
  await saveSettled(page);
  await page.getByTestId("wizard-fuel_type_id").selectOption({ label: "Benzin" });
  await saveSettled(page);
  await page.getByTestId("wizard-transmission_id").selectOption({ label: "Avtomat (AT)" });
  await saveSettled(page);
  await page.getByTestId("wizard-drive_type_id").selectOption({ label: "Tam" });
  await saveSettled(page);
  expect(badPatches).toEqual([]);

  // DB holds the option UUIDs (never SEDAN/PETROL/AUTOMATIC codes),
  // and they equal exactly what the selects submitted
  const ids = await getListingCatalogIds(fixture.id);
  expect(ids.body_type_id).toMatch(uuid);
  expect(ids.fuel_type_id).toMatch(uuid);
  expect(ids.transmission_id).toMatch(uuid);
  expect(ids.drive_type_id).toMatch(uuid);
  expect(ids.body_type_id).toBe(await page.getByTestId("wizard-body_type_id").inputValue());
  expect(ids.fuel_type_id).toBe(await page.getByTestId("wizard-fuel_type_id").inputValue());

  // reload restore: persisted UUID → matching option renders selected
  await page.reload();
  await openSection(page, "details");
  await expect(page.getByTestId("wizard-body_type_id")).toHaveValue(ids.body_type_id!);
  await expect(page.getByTestId("wizard-fuel_type_id")).toHaveValue(ids.fuel_type_id!);
  await expect(page.getByTestId("wizard-transmission_id")).toHaveValue(ids.transmission_id!);
  await expect(page.getByTestId("wizard-drive_type_id")).toHaveValue(ids.drive_type_id!);
});

test("catalog option selects persist UUIDs — MOTORCYCLE (4.17O.4)", async ({ page, context }, { project }) => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/;
  await loginAs(context, testPhone(project.name, 42));
  await quickStartCreate(page, { category: "MOTORCYCLE", brand: "Yamaha", model: "MT-07", year: 2020 });
  const listingId = page.url().match(/([0-9a-f-]{36})$/)![1];

  await openSection(page, "details");
  await page.getByTestId("wizard-motorcycle_type_id").selectOption({ label: "Sport" });
  await saveSettled(page);
  await page.getByTestId("wizard-fuel_type_id").selectOption({ label: "Benzin" });
  await saveSettled(page);
  await page.getByTestId("wizard-transmission_id").selectOption({ label: "Avtomat (AT)" });
  await saveSettled(page);

  const ids = await getListingCatalogIds(listingId);
  expect(ids.motorcycle_type_id).toMatch(uuid);
  expect(ids.fuel_type_id).toMatch(uuid);
  expect(ids.transmission_id).toMatch(uuid);

  await page.reload();
  await openSection(page, "details");
  await expect(page.getByTestId("wizard-motorcycle_type_id")).toHaveValue(ids.motorcycle_type_id!);
  await expect(page.getByTestId("wizard-fuel_type_id")).toHaveValue(ids.fuel_type_id!);
  await expect(page.getByTestId("wizard-transmission_id")).toHaveValue(ids.transmission_id!);
});

test("category switch clears persisted CAR body type; category stays code-backed (4.17O.4)", async ({ page, context }, { project }) => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/;
  const { userId } = await loginAs(context, testPhone(project.name, 43));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSection(page, "details");
  await page.getByTestId("wizard-body_type_id").selectOption({ label: "Sedan" });
  await saveSettled(page);
  expect((await getListingCatalogIds(fixture.id)).body_type_id).toMatch(uuid);

  // category PATCH still sends the CODE ("MOTORCYCLE") — the switch
  // succeeding at the server proves the code contract survives
  await openSection(page, "quickstart");
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("wizard-category").selectOption("MOTORCYCLE");
  await expect(page.getByTestId("wizard-brand")).toHaveValue("", { timeout: 15_000 });
  await expect(page.getByTestId("wizard-category")).toHaveValue("MOTORCYCLE");

  // server-side clearing removed the CAR-scoped value — no stale UUID
  expect((await getListingCatalogIds(fixture.id)).body_type_id).toBeNull();

  // the CAR-only control is gone; the MOTORCYCLE control is available
  await openSection(page, "details");
  await expect(page.getByTestId("wizard-motorcycle_type_id")).toBeVisible();
  await expect(page.getByTestId("wizard-body_type_id")).toHaveCount(0);
});
