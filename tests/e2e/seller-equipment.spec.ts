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

  // 360 narrow-mobile safety (no redesign — just proven usable)
  await page.setViewportSize({ width: 360, height: 780 });
  await expectNoHorizontalOverflow(page);
  const row360 = (await page.getByTestId("equipment-group-DRIVER_ASSISTANCE").boundingBox())!;
  expect(row360.height).toBeGreaterThanOrEqual(43);
  expect(row360.x + row360.width).toBeLessThanOrEqual(360.5);
  await search.fill("kamera");
  await expect(page.getByTestId("equipment-group-PARKING_CAMERA")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("equipment-search-clear").click();
  // count pill stays within the viewport with a selection present
  const safety360 = page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]').first();
  await safety360.click();
  await expect(safety360).toBeChecked();
  const pill = (await page.getByTestId("equipment-group-count-SAFETY").boundingBox())!;
  expect(pill.x + pill.width).toBeLessThanOrEqual(360.5);
  await expectNoHorizontalOverflow(page);
});

test("keyboard-only operation: disclosure, search, groups, rapid checkbox toggles, truthful search-mode semantics", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "keyboard/AT contract; one project");
  test.setTimeout(240_000);
  const { userId } = await loginAs(context, testPhone("desktop", 73));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSection(page, "info-contact");

  // open the outer disclosure with the keyboard
  const toggle = page.getByTestId("wizard-features-toggle");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("wizard-features")).toBeVisible();

  // search: type + Escape-clear without focus loss
  const search = page.getByTestId("equipment-search");
  await search.focus();
  await page.keyboard.type("kamera");
  await expect(page.getByTestId("equipment-group-PARKING_CAMERA")).toBeVisible();
  // search-mode headers are plain rows — no fake no-op disclosure
  // button, no aria-expanded claim while collapse is bypassed
  const searchHeader = page.getByTestId("equipment-group-PARKING_CAMERA");
  expect(await searchHeader.evaluate((el) => el.tagName)).toBe("DIV");
  expect(await searchHeader.getAttribute("aria-expanded")).toBeNull();
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("equipment-search");

  // group disclosure: real button, Space toggles, aria-controls only
  // while the region exists
  const group = page.getByTestId("equipment-group-MULTIMEDIA");
  expect(await group.evaluate((el) => el.tagName)).toBe("BUTTON");
  expect(await group.getAttribute("aria-controls")).toBeNull(); // collapsed → no dangling id
  await group.focus();
  await page.keyboard.press("Space");
  await expect(group).toHaveAttribute("aria-expanded", "true");
  const controls = await group.getAttribute("aria-controls");
  expect(controls).not.toBeNull();
  expect(await page.locator(`[id="${controls}"]`).count()).toBe(1); // valid reference

  // RAPID KEYBOARD SELECTION under held persistence — Space on four
  // checkboxes with no per-toggle waits; every intent must survive
  let release!: () => void;
  const hold = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/v1/me/listings/**", async (route) => {
    if (route.request().method() === "PATCH") await hold;
    await route.continue();
  });
  const safety = page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]');
  for (let i = 0; i < 4; i++) {
    await safety.nth(i).focus();
    await page.keyboard.press("Space");
  }
  for (let i = 0; i < 4; i++) await expect(safety.nth(i)).toBeChecked();
  await expect(page.getByTestId("equipment-summary")).toHaveText("4 təchizat seçilib");
  release();
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
  for (let i = 0; i < 4; i++) await expect(safety.nth(i)).toBeChecked();
  await page.unroute("**/api/v1/me/listings/**");
  await page.reload();
  await openSelector(page);
  await expect(page.getByTestId("equipment-summary")).toHaveText("4 təchizat seçilib"); // persisted set == visible set
});

test("rapid same-group multi-select loses nothing while persistence is in flight", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "deterministic race harness; one project");
  test.setTimeout(240_000);
  const { userId } = await loginAs(context, testPhone("desktop", 68));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSelector(page);

  // hold EVERY draft PATCH until released — clicks intentionally race
  // unresolved persistence (the exact reported failure mode)
  let release!: () => void;
  const hold = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/v1/me/listings/**", async (route) => {
    if (route.request().method() === "PATCH") await hold;
    await route.continue();
  });

  const safety = page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]');
  // ABS, ESC, ISOFIX(#6)? — first four SAFETY rows, clicked with NO
  // per-click round-trip waits
  for (let i = 0; i < 4; i++) await safety.nth(i).click();

  // optimistic state is already honest while the first PATCH hangs
  for (let i = 0; i < 4; i++) await expect(safety.nth(i)).toBeChecked();
  await expect(page.getByTestId("equipment-summary")).toHaveText("4 təchizat seçilib");
  await expect(page.getByTestId("equipment-group-count-SAFETY")).toHaveText("4 seçilib");

  release();
  await saveSettled(page);
  // settled server truth equals the visible state — nothing lost
  for (let i = 0; i < 4; i++) await expect(safety.nth(i)).toBeChecked();
  await expect(page.getByTestId("equipment-summary")).toHaveText("4 təchizat seçilib");
  await expect(page.getByTestId("equipment-group-count-SAFETY")).toHaveText("4 seçilib");

  // draft persistence: reload rehydrates all four UUIDs
  await page.unroute("**/api/v1/me/listings/**");
  await page.reload();
  await openSelector(page);
  await expect(page.getByTestId("equipment-summary")).toHaveText("4 təchizat seçilib");
  await expect(page.getByTestId("equipment-group-count-SAFETY")).toHaveText("4 seçilib");
  const rehydrated = page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]');
  for (let i = 0; i < 4; i++) await expect(rehydrated.nth(i)).toBeChecked();
});

test("rapid cross-group select, mixed toggle and rapid deselect stay consistent", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "deterministic race harness; one project");
  test.setTimeout(240_000);
  const { userId } = await loginAs(context, testPhone("desktop", 69));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await openSelector(page);
  // expose four groups first (accordion clicks never PATCH)
  for (const code of ["DRIVER_ASSISTANCE", "PARKING_CAMERA", "MULTIMEDIA"]) {
    await page.getByTestId(`equipment-group-${code}`).click();
  }

  let release!: () => void;
  const hold = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/v1/me/listings/**", async (route) => {
    if (route.request().method() === "PATCH") await hold;
    await route.continue();
  });

  const boxIn = (code: string, n = 0) =>
    page.getByTestId(`equipment-options-${code}`).locator('input[type="checkbox"]').nth(n);

  // rapid, await-free realistic sequence:
  // select ABS → select cruise → select rear-camera → select carplay
  // → DESELECT ABS → select ESC
  await boxIn("SAFETY", 0).click();
  await boxIn("DRIVER_ASSISTANCE", 0).click();
  await boxIn("PARKING_CAMERA", 0).click();
  await boxIn("MULTIMEDIA", 0).click();
  await boxIn("SAFETY", 0).click(); // deselect ABS
  await boxIn("SAFETY", 1).click(); // select ESC

  await expect(boxIn("SAFETY", 0)).not.toBeChecked();
  await expect(boxIn("SAFETY", 1)).toBeChecked();
  await expect(page.getByTestId("equipment-summary")).toHaveText("4 təchizat seçilib");
  for (const code of ["SAFETY", "DRIVER_ASSISTANCE", "PARKING_CAMERA", "MULTIMEDIA"]) {
    await expect(page.getByTestId(`equipment-group-count-${code}`)).toHaveText("1 seçilib");
  }

  release();
  await saveSettled(page);
  // no stale response resurrects the deselected ABS
  await expect(boxIn("SAFETY", 0)).not.toBeChecked();
  await expect(page.getByTestId("equipment-summary")).toHaveText("4 təchizat seçilib");

  // search interaction stays consistent after the correction
  const search = page.getByTestId("equipment-search");
  await search.fill("kamera");
  const cameraBoxes = page.getByTestId("equipment-options-PARKING_CAMERA").locator('input[type="checkbox"]');
  await cameraBoxes.nth(1).click(); // 360° kamera
  await expect(cameraBoxes.nth(1)).toBeChecked();
  await saveSettled(page);
  await page.getByTestId("equipment-search-clear").click();
  await expect(page.getByTestId("equipment-summary")).toHaveText("5 təchizat seçilib");
  await expect(page.getByTestId("equipment-group-count-PARKING_CAMERA")).toHaveText("2 seçilib");

  // reload — persisted truth equals everything above
  await page.unroute("**/api/v1/me/listings/**");
  await page.reload();
  await openSelector(page);
  await expect(page.getByTestId("equipment-summary")).toHaveText("5 təchizat seçilib");
  await expect(page.getByTestId("equipment-options-SAFETY").locator('input[type="checkbox"]').first()).not.toBeChecked();
});
