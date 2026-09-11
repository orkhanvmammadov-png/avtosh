import { expect, test } from "@playwright/test";
import { loginAs } from "./auth-helpers";
import { expectNoHorizontalOverflow } from "./helpers";

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
});
