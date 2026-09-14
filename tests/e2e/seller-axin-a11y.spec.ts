import { expect, test } from "@playwright/test";
import { loginAs, testPhone } from "./auth-helpers";
import { clearListingContact, insertListingFixture } from "./seller-helpers";

/**
 * O.10 Stage D — accessibility contract for the sequential journey:
 * aria-current="step" on the ONE open stage, focus follows every real
 * stage change to the opened stage heading, a single polite live
 * region announces "Mərhələ X / 6 — {title}" only on real stage
 * changes (never on autosave rerenders), upcoming rows are inert to
 * the keyboard while visited rows are real buttons.
 */

const focusedTestId = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);

/**
 * Focus moves in a useEffect AFTER hydration/paint, while data-state
 * assertions can already pass on server HTML — poll instead of racing.
 */
const expectFocus = (page: import("@playwright/test").Page, testId: string) =>
  expect.poll(() => focusedTestId(page), { timeout: 10_000 }).toBe(testId);

test("open stage carries aria-current=step, heading focus follows forward and explicit backward navigation", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "keyboard/AT contract; one project");
  test.setTimeout(180_000);
  const { userId } = await loginAs(context, testPhone("desktop", 59));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await clearListingContact(fixture.id);

  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  // resume entry (info-contact) — exactly one aria-current=step, and
  // entry itself focuses the opened stage heading
  await expect(page.getByTestId("axin-section-info-contact")).toHaveAttribute("data-state", "open");
  await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(page.locator('[aria-current="step"]')).toHaveAttribute("data-testid", "axin-section-info-contact");
  await expectFocus(page, "axin-heading-info-contact");

  // announcer holds the OPEN stage position + title
  const announcer = page.getByTestId("axin-stage-announcer");
  await expect(announcer).toHaveText("Mərhələ 5 / 6 — Əlavə məlumat və əlaqə");

  // autosave rerenders must NOT restate the announcement or move focus
  await page.getByTestId("wizard-seller-name").fill("Orxan");
  await page.getByTestId("wizard-contact-phone").fill("050 888 99 59");
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
  await expect(announcer).toHaveText("Mərhələ 5 / 6 — Əlavə məlumat və əlaqə");
  expect(await focusedTestId(page)).not.toBe("axin-heading-info-contact"); // focus stayed with the inputs, not yanked back

  // forward Davam et → Review: aria-current moves, focus lands on the
  // Review heading, announcer updates once to the new stage
  await page.getByTestId("axin-continue-info-contact").click();
  await expect(page.getByTestId("axin-section-review")).toHaveAttribute("data-state", "open");
  await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
  await expectFocus(page, "axin-heading-review");
  await expect(announcer).toHaveText("Mərhələ 6 / 6 — Baxış və dərc");

  // explicit backward navigation (visited row) is user-requested —
  // focus moves to the reopened heading too
  await page.getByTestId("axin-section-sale").click();
  await expect(page.getByTestId("axin-section-sale")).toHaveAttribute("data-state", "open");
  await expectFocus(page, "axin-heading-sale");
  await expect(announcer).toHaveText("Mərhələ 3 / 6 — Satış məlumatı");
  // journey position (header) never collapses backward
  await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 6 / 6");
});

test("upcoming rows are keyboard-inert, visited rows are real keyboard-activatable buttons", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "keyboard/AT contract; one project");
  test.setTimeout(180_000);
  const { userId } = await loginAs(context, testPhone("desktop", 61));
  const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });

  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await expect(page.getByTestId("axin-section-photos")).toHaveAttribute("data-state", "open");

  // upcoming rows: non-button, aria-disabled, unreachable by keyboard
  const upcoming = page.getByTestId("axin-section-info-contact");
  await expect(upcoming).toHaveAttribute("data-state", "upcoming");
  await expect(upcoming).toHaveAttribute("aria-disabled", "true");
  expect(await upcoming.evaluate((el) => el.tagName)).toBe("DIV");
  expect(await upcoming.evaluate((el) => el.matches(":is(a,button,[tabindex])"))).toBe(false);

  // visited rows: BUTTONs, focusable and Enter-activatable
  const visited = page.getByTestId("axin-section-details");
  await expect(visited).toHaveAttribute("data-state", "visited");
  expect(await visited.evaluate((el) => el.tagName)).toBe("BUTTON");
  await visited.focus();
  await page.keyboard.press("Enter");
  await expect(visited).toHaveAttribute("data-state", "open");
  await expectFocus(page, "axin-heading-details");

  // combined stage 5 keeps its two labelled subgroups (h3 × 2) once reached
  await page.getByTestId("axin-continue-details").click();
  await expect(page.getByTestId("axin-section-photos")).toHaveAttribute("data-state", "open");
});

test("correction entry announces and focuses the honestly mapped stage", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "keyboard/AT contract; one project");
  test.setTimeout(120_000);
  const { userId } = await loginAs(context, testPhone("desktop", 60));
  const fixture = await insertListingFixture(userId, {
    status: "CORRECTION_REQUIRED",
    complete: true,
    images: 3,
    review: { decision: "CORRECTION_REQUESTED", reasonCode: "SUSPICIOUS_PRICE", note: "Stage D a11y test" },
  });

  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await expect(page.getByTestId("axin-section-sale")).toHaveAttribute("data-state", "open");
  await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
  await expectFocus(page, "axin-heading-sale");
  await expect(page.getByTestId("axin-stage-announcer")).toHaveText("Mərhələ 3 / 6 — Satış məlumatı");

  // combined stage card exposes exactly two subgroup headings
  await page.getByTestId("axin-section-info-contact").click();
  await expect(page.getByTestId("axin-section-info-contact")).toHaveAttribute("data-state", "open");
  const subgroups = page.getByTestId("axin-section-info-contact").locator("h3");
  await expect(subgroups).toHaveCount(2);
});
