import { expect, test, type Page } from "@playwright/test";
import { loginAs, testPhone } from "./auth-helpers";
import { expectNoHorizontalOverflow } from "./helpers";
import { insertListingFixture } from "./seller-helpers";

/**
 * O.11 Stage B — grouped searchable seller equipment selector inside
 * sealed Stage 5 (4a — O.11 EQUIPMENT CATALOG UX). Selection stays
 * UUID-backed through the existing draft PATCH; search/disclosure are
 * pure client UI state.
 */

const GROUPS = [
  "SAFETY",
  "DRIVER_ASSISTANCE",
  "PARKING_CAMERA",
  "COMFORT",
  "CLIMATE_INTERIOR",
  "MULTIMEDIA",
  "LIGHTING_EXTERIOR",
];

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

async function openSelector(page: Page) {
  await openSection(page, "info-contact");
  const toggle = page.getByTestId("wizard-features-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(page.getByTestId("wizard-features")).toBeVisible();
}

test("CAR selector: seven groups, default disclosure, honest counts, UUID persistence, reload", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "single-source matrix; one project");
  test.setTimeout(240_000);
  const { userId } = await loginAs(context, testPhone("desktop", 64));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);

  // collapsed disclosure with the zero-selected summary; zero
  // equipment never gates Davam et (contact is valid on this fixture)
  await openSection(page, "info-contact");
  const toggle = page.getByTestId("wizard-features-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("equipment-summary")).toHaveText("Təchizat seçilməyib");
  await expect(page.getByTestId("axin-continue-info-contact")).toBeEnabled();

  // open: search + SAFETY expanded by default, the other six collapsed
  await toggle.click();
  await expect(page.getByTestId("wizard-features")).toBeVisible();
  await expect(page.getByTestId("equipment-search")).toBeVisible();
  await expect(page.getByTestId("equipment-group-SAFETY")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("equipment-options-SAFETY")).toBeVisible();
  for (const code of GROUPS.slice(1)) {
    await expect(page.getByTestId(`equipment-group-${code}`)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId(`equipment-options-${code}`)).toHaveCount(0);
  }
  // never a Digər bucket for the normal CAR catalog
  await expect(page.getByText("Digər", { exact: true })).toHaveCount(0);

  // all 58 items across exactly the seven groups
  for (const code of GROUPS.slice(1)) {
    await page.getByTestId(`equipment-group-${code}`).click();
  }
  await expect(page.getByTestId("wizard-features").locator('input[type="checkbox"]')).toHaveCount(58);

  // select ABS (first SAFETY option) — total + group count update
  const absBox = page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]').first();
  await absBox.click();
  await expect(absBox).toBeChecked();
  await saveSettled(page);
  await expect(page.getByTestId("equipment-summary")).toHaveText("1 təchizat seçilib");
  await expect(page.getByTestId("equipment-group-count-SAFETY")).toHaveText("1 seçilib");

  // second selection in another group counts independently
  const carplayBox = page.getByTestId("equipment-options-MULTIMEDIA").locator('input[type="checkbox"]').first();
  await carplayBox.click();
  await expect(carplayBox).toBeChecked();
  await saveSettled(page);
  await expect(page.getByTestId("equipment-summary")).toHaveText("2 təchizat seçilib");
  await expect(page.getByTestId("equipment-group-count-MULTIMEDIA")).toHaveText("1 seçilib");
  await expect(page.getByTestId("equipment-group-count-SAFETY")).toHaveText("1 seçilib");

  // deselect — counts stay honest, zero-count pill disappears
  await absBox.click();
  await expect(absBox).not.toBeChecked();
  await saveSettled(page);
  await expect(page.getByTestId("equipment-summary")).toHaveText("1 təchizat seçilib");
  await expect(page.getByTestId("equipment-group-count-SAFETY")).toHaveCount(0);

  // reload — UUID-backed selection rehydrates; disclosure resets to default
  await page.reload();
  await openSelector(page);
  await expect(page.getByTestId("equipment-summary")).toHaveText("1 təchizat seçilib");
  await expect(page.getByTestId("equipment-group-count-MULTIMEDIA")).toHaveText("1 seçilib");
  await expect(page.getByTestId("equipment-group-SAFETY")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("equipment-group-MULTIMEDIA")).toHaveAttribute("aria-expanded", "false");
});

test("equipment search: AZ + ASCII matching, group auto-reveal, no-results, state restore", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "single-source matrix; one project");
  test.setTimeout(240_000);
  const { userId } = await loginAs(context, testPhone("desktop", 65));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSelector(page);

  // user opens COMFORT manually — this state must survive a search
  await page.getByTestId("equipment-group-COMFORT").click();
  await expect(page.getByTestId("equipment-group-COMFORT")).toHaveAttribute("aria-expanded", "true");

  // AZ term: only camera-bearing group stays, options visible without clicks
  const search = page.getByTestId("equipment-search");
  await search.fill("kamera");
  await expect(page.getByTestId("equipment-group-PARKING_CAMERA")).toBeVisible();
  await expect(page.getByTestId("equipment-options-PARKING_CAMERA").locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(page.getByTestId("equipment-group-SAFETY")).toHaveCount(0); // zero-match hidden
  await expect(page.getByTestId("equipment-group-COMFORT")).toHaveCount(0);

  // ASCII-normalized term finds the AZ label
  await search.fill("goruntu");
  const matches = page.getByTestId("equipment-options-PARKING_CAMERA").locator('input[type="checkbox"]');
  await expect(matches).toHaveCount(1);

  // selecting during search persists and survives clearing
  await matches.first().click();
  await expect(matches.first()).toBeChecked();
  await saveSettled(page);
  await page.getByTestId("equipment-search-clear").click();
  await expect(search).toHaveValue("");
  await expect(page.getByTestId("equipment-summary")).toHaveText("1 təchizat seçilib");
  await expect(page.getByTestId("equipment-group-count-PARKING_CAMERA")).toHaveText("1 seçilib");

  // pre-search disclosure state restored: SAFETY (default) + COMFORT
  // (user) open, PARKING_CAMERA still collapsed
  await expect(page.getByTestId("equipment-group-SAFETY")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("equipment-group-COMFORT")).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("equipment-group-PARKING_CAMERA")).toHaveAttribute("aria-expanded", "false");

  // no-results state with its own clear action
  await search.fill("zzz-yoxdur");
  await expect(page.getByTestId("equipment-no-results")).toBeVisible();
  await expect(page.getByTestId("equipment-no-results")).toContainText("Heç nə tapılmadı");
  await page.getByTestId("equipment-no-results-clear").click();
  await expect(search).toHaveValue("");
  await expect(page.getByTestId("equipment-no-results")).toHaveCount(0);
  await expect(page.getByTestId("equipment-summary")).toHaveText("1 təchizat seçilib"); // selection untouched
  await expect(page.getByTestId("axin-section-info-contact")).toHaveAttribute("data-state", "open");

  // Escape clears only the equipment query
  await search.fill("kamera");
  await search.press("Escape");
  await expect(search).toHaveValue("");
});

test("MOTORCYCLE: ABS only under Təhlükəsizlik, no search, CAR-only selection pruned on switch", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "single-source matrix; one project");
  test.setTimeout(240_000);
  const { userId } = await loginAs(context, testPhone("desktop", 66));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSelector(page);

  // select ABS (global) + one CAR-only multimedia feature
  const absBox = page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]').first();
  await absBox.click();
  await expect(absBox).toBeChecked();
  await page.getByTestId("equipment-group-MULTIMEDIA").click();
  const carOnly = page.getByTestId("equipment-options-MULTIMEDIA").locator('input[type="checkbox"]').first();
  await carOnly.click();
  await expect(carOnly).toBeChecked();
  await saveSettled(page);
  await expect(page.getByTestId("equipment-summary")).toHaveText("2 təchizat seçilib");

  // switch the category to MOTORCYCLE through the sealed O.4 contract
  await openSection(page, "quickstart");
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("wizard-category").selectOption("MOTORCYCLE");
  await expect(page.getByTestId("wizard-brand")).toHaveValue("", { timeout: 15_000 });

  // MOTO selector: single Təhlükəsizlik group with ABS, no search, no
  // empty CAR groups — and the CAR-only selection was pruned
  // server-side while global ABS survived
  await openSelector(page);
  await expect(page.getByTestId("equipment-search")).toHaveCount(0);
  await expect(page.getByTestId("equipment-group-SAFETY")).toBeVisible();
  await expect(page.getByTestId("equipment-group-SAFETY")).toContainText("Təhlükəsizlik");
  for (const code of GROUPS.slice(1)) {
    await expect(page.getByTestId(`equipment-group-${code}`)).toHaveCount(0);
  }
  const motoBoxes = page.getByTestId("wizard-features").locator('input[type="checkbox"]');
  await expect(motoBoxes).toHaveCount(1);
  await expect(motoBoxes.first()).toBeChecked(); // ABS retained
  await expect(page.getByTestId("equipment-summary")).toHaveText("1 təchizat seçilib");
});

test("390: selector, search and no-results stay overflow-free; sticky CTA never obscures", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "explicit viewport; one project");
  test.setTimeout(240_000);
  const { userId } = await loginAs(context, testPhone("desktop", 67));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSelector(page);
  await expectNoHorizontalOverflow(page);

  // touch targets: group rows ≥ 44px at 390
  const row = (await page.getByTestId("equipment-group-DRIVER_ASSISTANCE").boundingBox())!;
  expect(row.height).toBeGreaterThanOrEqual(43);

  const search = page.getByTestId("equipment-search");
  await search.fill("kamera");
  await expectNoHorizontalOverflow(page);
  await search.fill("zzz-yoxdur");
  await expect(page.getByTestId("equipment-no-results")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("equipment-no-results-clear").click();

  // the open selector never traps Description/Contact behind the
  // sticky bar — both stay reachable by scrolling
  await page.getByTestId("wizard-description").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("wizard-description")).toBeVisible();
  await page.getByTestId("wizard-contact-phone").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("wizard-contact-phone")).toBeVisible();
  const phoneBox = (await page.getByTestId("wizard-contact-phone").boundingBox())!;
  const bar = (await page.getByTestId("axin-continue-info-contact").boundingBox())!;
  expect(phoneBox.y + phoneBox.height).toBeLessThanOrEqual(bar.y + 1);
  await expectNoHorizontalOverflow(page);
});
