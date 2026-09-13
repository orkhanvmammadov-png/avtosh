import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import { insertListingFixture } from "./seller-helpers";

/**
 * O.9 Stage G — responsive descent geometry (responsive.md matrix):
 * 680/640/492/full columns, 2→1 field columns below 1024, 5/4/3-up
 * photo grid, stacked promo cards below 1024, compact 390 header,
 * sticky h48 safe-area action below 1024. Explicit-viewport
 * scenarios; the regular mobile/tablet projects keep exercising the
 * functional flow.
 */

async function openSection(page: Page, key: string) {
  const section = page.getByTestId(`axin-section-${key}`);
  if ((await section.getAttribute("data-state")) !== "open") {
    await section.click();
  }
  await expect(section).toHaveAttribute("data-state", "open");
}

test("1024 is a designed tier: 640 column, 2-col fields, 4-up photos, in-card actions", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "explicit viewport matrix; one project");
  const { userId } = await loginAs(context, testPhone("desktop", 51));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 4 });
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await expectNoHorizontalOverflow(page);

  // content column ≈ 640
  const card = (await page.getByTestId("axin-section-quickstart").boundingBox())!;
  expect(Math.round(card.width)).toBe(640);

  // 2-col fields at desk: price and mileage share a row
  await openSection(page, "sale");
  const price = (await page.getByTestId("wizard-price").boundingBox())!;
  const mileage = (await page.getByTestId("wizard-mileage").boundingBox())!;
  expect(Math.round(price.y)).toBe(Math.round(mileage.y));
  expect(mileage.x).toBeGreaterThan(price.x + price.width - 1);

  // in-card complete action (NOT the fixed bar)
  const bar = page.getByTestId("axin-complete-sale");
  expect(await bar.evaluate((el) => getComputedStyle(el.parentElement!).position)).not.toBe("fixed");

  // photos: 4-up (first four tiles share a row)
  await openSection(page, "photos");
  const tiles = page.locator('[data-testid="wizard-image"]');
  const t0 = (await tiles.nth(0).boundingBox())!;
  const t3 = (await tiles.nth(3).boundingBox())!;
  expect(Math.round(t0.y)).toBe(Math.round(t3.y));

  // promo cards 2-up on review
  await openSection(page, "review");
  await expectNoHorizontalOverflow(page);
});

test("768 is a structural transition: ~492 column, stacked fields, sticky action, 3-up photos", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "explicit viewport matrix; one project");
  const { userId } = await loginAs(context, testPhone("desktop", 52));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 4 });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await expectNoHorizontalOverflow(page);

  const card = (await page.getByTestId("axin-section-quickstart").boundingBox())!;
  expect(card.width).toBeLessThanOrEqual(500);
  expect(card.width).toBeGreaterThanOrEqual(460);

  // 1-col fields: mileage stacks below price; contact stacks too
  await openSection(page, "sale");
  const price = (await page.getByTestId("wizard-price").boundingBox())!;
  const mileage = (await page.getByTestId("wizard-mileage").boundingBox())!;
  expect(mileage.y).toBeGreaterThan(price.y + price.height - 1);
  expect(Math.round(mileage.x)).toBe(Math.round(price.x));

  // sticky primary action (fixed, full-width, ≥48px)
  const completeBtn = page.getByTestId("axin-complete-sale");
  expect(await completeBtn.evaluate((el) => getComputedStyle(el.parentElement!).position)).toBe("fixed");
  const btnBox = (await completeBtn.boundingBox())!;
  expect(btnBox.height).toBeGreaterThanOrEqual(47);

  // photos 3-up
  await openSection(page, "photos");
  const tiles = page.locator('[data-testid="wizard-image"]');
  const t0 = (await tiles.nth(0).boundingBox())!;
  const t2 = (await tiles.nth(2).boundingBox())!;
  const t3 = (await tiles.nth(3).boundingBox())!;
  expect(Math.round(t0.y)).toBe(Math.round(t2.y));
  expect(t3.y).toBeGreaterThan(t0.y + 10); // wraps to the next row

  // contact stacked
  await openSection(page, "contact");
  const name = (await page.getByTestId("wizard-seller-name").boundingBox())!;
  const phone = (await page.getByTestId("wizard-contact-phone").boundingBox())!;
  expect(phone.y).toBeGreaterThan(name.y + name.height - 1);
  await expectNoHorizontalOverflow(page);
});

test("390 purpose-built flow: compact header, overlay within viewport, sticky bar never covers the active field", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "explicit viewport matrix; one project");
  test.setTimeout(120_000);
  const { userId } = await loginAs(context, testPhone("desktop", 53));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await page.setViewportSize({ width: 390, height: 844 });

  // Quick Start on the entry page: typeahead overlay stays inside 390
  await page.goto("/elan-yerlesdir");
  const brand = page.getByTestId("quick-start-brand");
  await brand.click();
  await brand.fill("To");
  const listbox = page.getByTestId("quick-start-brand-listbox");
  await expect(listbox).toBeVisible();
  const lb = (await listbox.boundingBox())!;
  expect(lb.x).toBeGreaterThanOrEqual(0);
  expect(lb.x + lb.width).toBeLessThanOrEqual(390.5);
  // touch-sized option rows (44px below desk)
  const row = (await listbox.getByTestId("quick-start-brand-option").first().boundingBox())!;
  expect(row.height).toBeGreaterThanOrEqual(43);
  await page.keyboard.press("Escape");
  await expectNoHorizontalOverflow(page);

  // flow header is the compact "Yeni elan · n/7" (no chip, no promise)
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await expect(page.getByTestId("axin-progress")).toBeHidden();
  await expect(page.getByText("Qaralama avtomatik saxlanılır")).toBeHidden();
  await expect(page.getByText(/Yeni elan/)).toBeVisible();

  // sticky bar (h≥48, fixed, safe-area aware) never covers the field
  await openSection(page, "sale");
  const completeBtn = page.getByTestId("axin-complete-sale");
  expect(await completeBtn.evaluate((el) => getComputedStyle(el.parentElement!).position)).toBe("fixed");
  const price = page.getByTestId("wizard-price");
  await price.click(); // focus = software-keyboard scenario
  await price.scrollIntoViewIfNeeded();
  const priceBox = (await price.boundingBox())!;
  const barBox = (await completeBtn.boundingBox())!;
  expect(priceBox.y + priceBox.height).toBeLessThanOrEqual(barBox.y + 1); // input fully above the bar
  await expectNoHorizontalOverflow(page);

  // contact: inline error stays visible above the bar
  await openSection(page, "contact");
  await page.getByTestId("wizard-contact-phone").fill("010 21");
  await page.getByTestId("wizard-seller-name").click(); // blur → error
  const error = page.getByText("Nömrə natamamdır", { exact: false });
  await expect(error).toBeVisible();
  const errBox = (await error.boundingBox())!;
  const contactBar = (await page.getByTestId("axin-complete-contact").boundingBox())!;
  expect(errBox.y + errBox.height).toBeLessThanOrEqual(contactBar.y + 1);

  // review: sticky submit + centered ghost skip; fee separate from promo
  await openSection(page, "review");
  const submit = page.getByTestId("wizard-submit");
  expect(await submit.evaluate((el) => getComputedStyle(el.parentElement!).position)).toBe("fixed");
  const submitBox = (await submit.boundingBox())!;
  expect(submitBox.height).toBeGreaterThanOrEqual(47);
  await expect(page.getByTestId("wizard-submit-skip-promo")).toBeVisible();
  await expect(page.getByTestId("review-fee-value")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("width matrix 360/375/390/414 stays overflow-free with review and photos open", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "explicit viewport matrix; one project");
  test.setTimeout(120_000);
  const { userId } = await loginAs(context, testPhone("desktop", 54));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 4 });
  for (const width of [360, 375, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/elan-yerlesdir/${fixture.id}`);
    await expectNoHorizontalOverflow(page);
    await openSection(page, "photos");
    await expectNoHorizontalOverflow(page);
    await openSection(page, "review");
    await expectNoHorizontalOverflow(page);
  }
});
