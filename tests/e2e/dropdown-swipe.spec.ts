import { expect, test, type Page } from "@playwright/test";
import { loginAs, testPhone } from "./auth-helpers";

/**
 * Swipe-vs-tap regression for the searchable dropdowns: a vertical
 * drag that STARTS on an option row must scroll the list, never
 * select the row; a deliberate tap must select exactly once.
 *
 * Runs on the touch-enabled mobile project. Drags go through CDP
 * Input.dispatchTouchEvent, i.e. Chromium's REAL gesture recognizer
 * (touch → pointerdown/move → pointercancel + native scroll), not
 * synthetic DOM events. This proves the handler contract in
 * Chromium's touch pipeline; iOS Safari's own gesture pipeline still
 * needs the physical-iPhone UAT pass.
 */

async function touchDrag(page: Page, x: number, fromY: number, toY: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const steps = 10;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: fromY }] });
    for (let i = 1; i <= steps; i += 1) {
      const y = fromY + ((toY - fromY) * i) / steps;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

async function openBrandList(page: Page) {
  const input = page.locator("#home-brand");
  await input.tap();
  const listbox = page.getByTestId("home-brand-listbox");
  await expect(listbox).toBeVisible();
  // Seeded CAR brands (Toyota, BMW + 12 fillers) overflow max-h-[45vh].
  await expect
    .poll(async () => listbox.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(100);
  return { input, listbox };
}

test.describe("dropdown swipe scrolls, tap selects", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "touch gestures — mobile project only");
  });

  test("brand: upward and downward drags starting on rows scroll without selecting", async ({ page }) => {
    await page.goto("/");
    const { input, listbox } = await openBrandList(page);
    const box = (await listbox.boundingBox())!;
    const x = box.x + box.width / 2;

    // Drag UP starting on a row near the visible BOTTOM → list scrolls down.
    await touchDrag(page, x, box.y + box.height - 15, box.y + 15);
    const afterUp = await listbox.evaluate((el) => el.scrollTop);
    expect(afterUp).toBeGreaterThan(0);
    await expect(listbox).toBeVisible();
    await expect(input).toHaveValue("");

    // Drag DOWN starting on a row near the visible TOP → scrolls back up.
    await touchDrag(page, x, box.y + 15, box.y + box.height - 15);
    const afterDown = await listbox.evaluate((el) => el.scrollTop);
    expect(afterDown).toBeLessThan(afterUp);
    await expect(listbox).toBeVisible();
    await expect(input).toHaveValue("");
  });

  test("brand: a deliberate tap selects exactly once and closes the list", async ({ page }) => {
    await page.goto("/");
    const { input, listbox } = await openBrandList(page);
    await listbox.getByRole("option", { name: "Toyota", exact: true }).tap();
    await expect(input).toHaveValue("Toyota");
    await expect(listbox).toHaveCount(0);
    // Selection took effect exactly once: the model field unlocked
    // for the tapped brand, and reopening (blur first — the input
    // keeps focus after selection, so a fresh tap must re-focus it)
    // shows Toyota as the single selected option.
    await expect(page.getByTestId("home-model-toggle")).toBeEnabled();
    await page.getByRole("heading", { level: 1 }).tap();
    await input.tap();
    await expect(page.getByTestId("home-brand-listbox")).toBeVisible();
    await expect(
      page.getByTestId("home-brand-listbox").getByRole("option", { name: "Toyota", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("model tree: a drag over family and variant rows never toggles a selection", async ({ page }) => {
    for (const path of ["/", "/elanlar?category=CAR"]) {
      await page.goto(path);
      const { input, listbox } = await openBrandList(page);
      await listbox.getByRole("option", { name: "Toyota", exact: true }).tap();
      await expect(input).toHaveValue("Toyota");
      await page.getByTestId("home-model-toggle").tap();
      const panel = page.getByTestId("home-model-panel");
      await expect(panel).toBeVisible();
      // Expose nested variant rows too.
      await page.getByTestId("home-model-expand-tree-family").tap();
      await expect(page.getByTestId("home-model-variant-tree-100")).toBeVisible();

      const box = (await panel.boundingBox())!;
      const before = await panel.evaluate((el) => ({
        scrollTop: el.scrollTop,
        pageY: window.scrollY,
      }));
      // Drag starting directly on the rows inside the panel.
      await touchDrag(page, box.x + box.width / 2, box.y + box.height - 15, box.y + 15);
      const checkedCount = await panel.locator("input[type=checkbox]:checked").count();
      expect(checkedCount).toBe(0);
      await expect(panel).toBeVisible();
      // Record scroll behavior: either the panel scrolled or, when its
      // content fits, the gesture chained to the page — both are
      // "scrolls without toggling".
      const after = await panel.evaluate((el) => ({
        scrollTop: el.scrollTop,
        pageY: window.scrollY,
      }));
      test.info().annotations.push({
        type: `model-tree-scroll@${path}`,
        description: `panel ${before.scrollTop}->${after.scrollTop}, page ${before.pageY}->${after.pageY}`,
      });
      // A deliberate tap on a family row still toggles.
      await page.getByTestId("home-model-family-corolla").tap();
      await expect(page.getByTestId("home-model-family-corolla")).toBeChecked();
    }
  });

  test("seller model path: swipes never activate family/variant/back rows; taps do", async ({ page, context }) => {
    const { userId } = await loginAs(context, testPhone("mobile", 71));
    void userId;
    await page.goto("/elan-yerlesdir");
    const brand = page.getByTestId("quick-start-brand");
    await brand.tap();
    const brandList = page.getByTestId("quick-start-brand-listbox");
    await expect(brandList).toBeVisible();

    // Swipe starting on a quick-start brand row: no selection.
    const bBox = (await brandList.boundingBox())!;
    await touchDrag(page, bBox.x + bBox.width / 2, bBox.y + bBox.height - 15, bBox.y + 15);
    await expect(brand).toHaveValue("");
    await expect(brandList).toBeVisible();

    await brandList.getByRole("option", { name: "Toyota", exact: true }).tap();
    await expect(brand).toHaveValue("Toyota");

    const model = page.getByTestId("quick-start-model");
    await model.tap();
    const modelList = page.getByTestId("quick-start-model-listbox");
    await expect(modelList).toBeVisible();

    // Swipe over FAMILY rows: no family opens, list stays put.
    const fBox = (await modelList.boundingBox())!;
    await touchDrag(page, fBox.x + fBox.width / 2, fBox.y + fBox.height - 15, fBox.y + 15);
    await expect(model).toHaveValue("");
    await expect(modelList).toBeVisible();
    await expect(page.getByTestId("quick-start-model-back")).toHaveCount(0);

    // Tap a family → variants level with a back row.
    await modelList.getByRole("option", { name: "Tree Family", exact: true }).tap();
    const backRow = page.getByTestId("quick-start-model-back");
    await expect(backRow).toBeVisible();

    // Swipe starting on the BACK row: must not navigate back.
    const backBox = (await backRow.boundingBox())!;
    await touchDrag(page, backBox.x + backBox.width / 2, backBox.y + 10, backBox.y + 90);
    await expect(page.getByTestId("quick-start-model-back")).toBeVisible();
    await expect(model).toHaveValue("");

    // Swipe over VARIANT rows: nothing commits.
    const vBox = (await modelList.boundingBox())!;
    await touchDrag(page, vBox.x + vBox.width / 2, vBox.y + vBox.height - 15, vBox.y + 15);
    await expect(model).toHaveValue("");

    // Deliberate taps: back works, then a variant commits.
    await backRow.tap();
    await expect(page.getByTestId("quick-start-model-back")).toHaveCount(0);
    await modelList.getByRole("option", { name: "Tree Family", exact: true }).tap();
    await page.getByTestId("quick-start-model-back").waitFor();
    await modelList.getByRole("option", { name: "Tree 100" }).tap();
    await expect(model).toHaveValue(/Tree/);
  });
});
