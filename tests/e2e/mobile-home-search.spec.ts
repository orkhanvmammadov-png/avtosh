import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";

/**
 * Mobile homepage search redesign: compact "Bütün markalar" and
 * "Filtrlər" entry points on phones. The Filtrlər sheet is the same
 * HomeSearch form restyled full-screen (one state, one URL contract);
 * the brand sheet is a searchable list over the live category brands
 * plus the shared hierarchical Model control. Desktop/tablet keep the
 * inline layout, and the Results page is untouched.
 */

const PHONE_WIDTHS = [320, 390];

async function gotoMobileHome(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("home-mobile-brand-entry")).toBeVisible();
}

/** Opens a sheet, retrying a click that landed before hydration. */
async function openSheet(page: Page, entryTestid: string, markerTestid: string): Promise<void> {
  await expect(async () => {
    await page.getByTestId(entryTestid).click();
    await expect(page.getByTestId(markerTestid)).toBeVisible({ timeout: 1500 });
  }).toPass();
}

test.describe("mobile homepage search entry points", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "runs once with explicit viewports");
  });

  for (const width of PHONE_WIDTHS) {
    test(`entry points open/close with focus management at ${width}px`, async ({ page }) => {
      await gotoMobileHome(page, width);
      await expectNoHorizontalOverflow(page);
      // The inline grid is behind the entries on phones.
      await expect(page.getByTestId("home-search-submit")).toBeHidden();

      // Brand sheet: opens focused on its search box, Escape closes
      // and returns focus to the entry.
      await openSheet(page, "home-mobile-brand-entry", "brand-sheet");
      await expect(page.getByTestId("brand-sheet-search")).toBeFocused();
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("brand-sheet")).toHaveCount(0);
      await expect(page.getByTestId("home-mobile-brand-entry")).toBeFocused();

      // Filtrlər sheet: full field set, close button focused; the ✕
      // closes it and returns focus to its entry.
      await page.getByTestId("home-mobile-filters-entry").click();
      await expect(page.getByTestId("home-filters-close")).toBeFocused();
      await expect(page.getByTestId("home-brand")).toBeVisible();
      await expect(page.getByTestId("home-adv-city")).toBeVisible();
      await expect(page.getByTestId("home-search-submit")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByTestId("home-filters-close").click();
      await expect(page.getByTestId("home-filters-close")).toHaveCount(0);
      await expect(page.getByTestId("home-mobile-filters-entry")).toBeFocused();
    });
  }

  test("searchable brand selection → dependent models → expected results URL", async ({ page }) => {
    const s = seed();
    await gotoMobileHome(page, 390);
    await openSheet(page, "home-mobile-brand-entry", "brand-sheet");

    // Text search narrows the real category catalog (az-insensitive).
    await page.getByTestId("brand-sheet-search").fill("toy");
    await expect(page.getByTestId("brand-sheet-option-toyota")).toBeVisible();
    await expect(page.getByTestId("brand-sheet-option-bmw")).toHaveCount(0);
    await page.getByTestId("brand-sheet-search").fill("yoxdur-belə-marka");
    await expect(page.getByTestId("brand-sheet-empty")).toBeVisible();
    await page.getByTestId("brand-sheet-search").fill("Toyota");
    await page.getByTestId("brand-sheet-option-toyota").click();

    // Model stage: the shared hierarchical control with real families.
    await expect(page.getByTestId("brand-sheet-back")).toBeVisible();
    await page.getByTestId("brand-sheet-model-toggle").click();
    await page.getByTestId("brand-sheet-model-family-tree-family").check();
    await page.keyboard.press("Escape"); // closes just the tree panel
    await expect(page.getByTestId("brand-sheet")).toBeVisible();
    await page.getByTestId("brand-sheet-submit").click();
    await page.waitForURL(/\/elanlar\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("category")).toBe("CAR");
    expect(url.searchParams.get("brand_id")).toBe(s.toyotaBrandId);
    expect(url.searchParams.get("model_ids")).toBe(s.treeFamilyModelId);
  });

  test("brand-only search works; selections survive close/reopen and sync into Filtrlər", async ({ page }) => {
    const s = seed();
    await gotoMobileHome(page, 390);
    await openSheet(page, "home-mobile-brand-entry", "brand-sheet");
    await page.getByTestId("brand-sheet-option-toyota").click();
    // Close WITHOUT searching: the choice must not silently vanish.
    await page.getByTestId("brand-sheet-close").click();
    await expect(page.getByTestId("home-mobile-brand-entry")).toContainText("Toyota");

    // Reopen: lands on the model stage of the kept brand; going back
    // to the list marks it selected.
    await page.getByTestId("home-mobile-brand-entry").click();
    await expect(page.getByTestId("brand-sheet-back")).toBeVisible();
    await page.getByTestId("brand-sheet-back").click();
    await expect(page.getByTestId("brand-sheet-option-toyota")).toBeVisible();
    await page.getByTestId("brand-sheet-close").click();

    // The same selection shows in the Filtrlər sheet (one state).
    await page.getByTestId("home-mobile-filters-entry").click();
    await expect(page.getByTestId("home-brand")).toHaveValue("Toyota");
    await page.getByTestId("home-filters-close").click();

    // Brand-only submit from the compact Axtar.
    await page.getByTestId("home-mobile-search-submit").click();
    await page.waitForURL(/\/elanlar\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("brand_id")).toBe(s.toyotaBrandId);
    expect(url.searchParams.get("model_ids")).toBeNull();
  });

  test("category switch clears brand and swaps the catalog (existing dependency rules)", async ({ page }) => {
    await gotoMobileHome(page, 390);
    await openSheet(page, "home-mobile-brand-entry", "brand-sheet");
    await page.getByTestId("brand-sheet-option-toyota").click();
    await page.getByTestId("brand-sheet-close").click();
    await expect(page.getByTestId("home-mobile-brand-entry")).toContainText("Toyota");

    await page.getByTestId("category-MOTORCYCLE").click();
    await expect(page.getByTestId("home-mobile-brand-entry")).toContainText("Bütün markalar");
    await page.getByTestId("home-mobile-brand-entry").click();
    await expect(page.getByTestId("brand-sheet-option-yamaha")).toBeVisible();
    await expect(page.getByTestId("brand-sheet-option-toyota")).toHaveCount(0);
    // The ✕ on the entry clears a kept brand without opening the sheet.
    await page.getByTestId("brand-sheet-option-yamaha").click();
    await page.getByTestId("brand-sheet-close").click();
    await page.getByTestId("home-mobile-brand-clear").click();
    await expect(page.getByTestId("home-mobile-brand-entry")).toContainText("Bütün markalar");
  });

  test("Filtrlər keeps values across close/reopen, counts them, clears on Təmizlə, and submits them", async ({ page }) => {
    await gotoMobileHome(page, 320);
    await openSheet(page, "home-mobile-filters-entry", "home-filters-close");
    await page.getByTestId("home-adv-city").selectOption({ index: 1 });
    const city = await page.getByTestId("home-adv-city").inputValue();
    await page.getByTestId("home-advanced-toggle").click();
    await page.getByTestId("home-adv-price-min").fill("5000");
    await page.getByTestId("home-adv-credit").click();
    await page.getByTestId("home-filters-close").click();

    // Closed: the entry shows the active-filter count; nothing erased.
    await expect(page.getByTestId("home-mobile-filters-count")).toHaveText("3");
    await page.getByTestId("home-mobile-filters-entry").click();
    await expect(page.getByTestId("home-adv-city")).toHaveValue(city);
    await expect(page.getByTestId("home-adv-price-min")).toHaveValue("5 000");
    await expect(page.getByTestId("home-adv-credit")).toHaveAttribute("aria-pressed", "true");

    // Submit from inside the sheet → the sealed URL contract.
    await page.getByTestId("home-search-submit").click();
    await page.waitForURL(/\/elanlar\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("city_id")).toBe(city);
    expect(url.searchParams.get("price_min")).toBe("500000");
    expect(url.searchParams.get("credit")).toBe("true");

    // Fresh home: Təmizlə inside the sheet clears everything.
    await page.goto("/");
    await openSheet(page, "home-mobile-filters-entry", "home-filters-close");
    await page.getByTestId("home-adv-city").selectOption({ index: 1 });
    await page.getByTestId("home-advanced-toggle").click();
    await page.locator('[data-testid="home-adv-clear"]:visible').first().click();
    await expect(page.getByTestId("home-adv-city")).toHaveValue("");
    await page.getByTestId("home-filters-close").click();
    await expect(page.getByTestId("home-mobile-filters-count")).toHaveCount(0);
  });

  test("the brand clear control is a real tabbable button, operable by keyboard", async ({ page }) => {
    await gotoMobileHome(page, 390);
    await openSheet(page, "home-mobile-brand-entry", "brand-sheet");
    await page.getByTestId("brand-sheet-option-toyota").click();
    await page.getByTestId("brand-sheet-close").click();
    await expect(page.getByTestId("home-mobile-brand-entry")).toBeFocused();

    // The clear control is the next tab stop after the entry — a
    // sibling button, never an interactive element nested in one.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("home-mobile-brand-clear")).toBeFocused();
    const nested = await page
      .getByTestId("home-mobile-brand-entry")
      .locator("[role=button], button")
      .count();
    expect(nested).toBe(0);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("home-mobile-brand-entry")).toContainText("Bütün markalar");
    await expect(page.getByTestId("home-mobile-brand-clear")).toHaveCount(0);
    await expect(page.getByTestId("home-mobile-brand-entry")).toBeFocused();
  });

  test("Tab and Shift+Tab stay inside the open sheet; the page behind is unreachable", async ({ page }) => {
    await gotoMobileHome(page, 390);

    const pressStaysInDialog = async (key: string, presses: number) => {
      for (let i = 0; i < presses; i += 1) {
        await page.keyboard.press(key);
        const focus = await page.evaluate(() => {
          const el = document.activeElement;
          return {
            inDialog: el instanceof HTMLElement && el.closest('[aria-modal="true"]') !== null,
            id: el instanceof HTMLElement ? (el.getAttribute("data-testid") ?? el.tagName) : null,
          };
        });
        expect(focus.inDialog, `${key} #${i + 1} left the sheet (landed on ${focus.id})`).toBe(true);
      }
    };

    // Filters sheet: the form itself carries the dialog semantics and
    // contains more tab stops than we press — cycling must wrap inside.
    await openSheet(page, "home-mobile-filters-entry", "home-filters-close");
    await expect(page.locator('form[role="dialog"][aria-modal="true"]')).toBeVisible();
    await pressStaysInDialog("Tab", 14);
    await pressStaysInDialog("Shift+Tab", 6);
    // Background controls (header link, premium favorites) never focus.
    await page.getByTestId("home-filters-close").click();
    await expect(page.getByTestId("home-mobile-filters-entry")).toBeFocused();

    // Brand sheet: few focusables, so Tab wraps around its own cycle.
    await openSheet(page, "home-mobile-brand-entry", "brand-sheet");
    await expect(page.getByTestId("brand-sheet-search")).toBeFocused();
    await pressStaysInDialog("Tab", 10);
    await pressStaysInDialog("Shift+Tab", 4);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("brand-sheet")).toHaveCount(0);
    await expect(page.getByTestId("home-mobile-brand-entry")).toBeFocused();
  });

  test("desktop inline search and the results-page filter flow are unchanged", async ({ page }) => {
    const s = seed();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByTestId("home-mobile-brand-entry")).toBeHidden();
    await expect(page.getByTestId("home-mobile-filters-entry")).toBeHidden();
    await expect(page.getByTestId("home-brand")).toBeVisible();
    await expect(page.getByTestId("home-search-submit")).toBeVisible();

    // Results page at a phone width: inline controls as before — the
    // compact entries are a homepage-only surface.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/elanlar?category=CAR&brand_id=${s.toyotaBrandId}`);
    await expect(page.getByTestId("home-mobile-brand-entry")).toHaveCount(0);
    await expect(page.getByTestId("home-brand")).toBeVisible();
    await expect(page.getByTestId("home-brand")).toHaveValue("Toyota");
    await expect(page.getByTestId("home-advanced-toggle")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
