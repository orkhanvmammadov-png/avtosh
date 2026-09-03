import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { expectNoHorizontalOverflow, isMobile, seed } from "./helpers";

test.describe("Home", () => {
  test("renders hero, 24h count, categories and Premium section", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Avtomobil və motosiklet");
    await expect(page.getByTestId("new-count")).toContainText(/Son 24 saatda \d+ yeni elan/);
    await expect(page.getByTestId("category-CAR")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("premium-section")).toBeVisible();
    const premiumCards = page.getByTestId("premium-grid").getByTestId("listing-card");
    expect(await premiumCards.count()).toBe(seed().premium.length);
    await expect(page.getByText("Popular")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("category + brand + model search navigates with URL params", async ({ page }) => {
    const s = seed();
    await page.goto("/");
    await page.getByTestId("home-brand").selectOption(s.toyotaBrandId);
    await page.getByTestId("home-model").selectOption(s.corollaModelId);
    await page.getByTestId("home-search-submit").click();
    await page.waitForURL(/\/elanlar\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("category")).toBe("CAR");
    expect(url.searchParams.get("brand_id")).toBe(s.toyotaBrandId);
    expect(url.searchParams.get("model_id")).toBe(s.corollaModelId);
    await expect(page.getByTestId("organic-card").first()).toBeVisible();
  });

  test("motorcycle category loads motorcycle brands and searches", async ({ page }) => {
    const s = seed();
    await page.goto("/");
    await page.getByTestId("category-MOTORCYCLE").click();
    await expect(page.getByTestId("home-brand")).toBeEnabled();
    await page.getByTestId("home-brand").selectOption(s.yamahaBrandId);
    await page.getByTestId("home-search-submit").click();
    await page.waitForURL(/category=MOTORCYCLE/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Motosiklet");
  });

  test("advanced search expands inline, preserves values across collapse, never navigates on toggle (4.17O.2)", async ({ page }) => {
    const s = seed();
    await page.goto("/");
    const toggle = page.getByTestId("home-advanced-toggle");
    const panel = page.getByTestId("home-advanced-panel");
    // collapsed by default
    await expect(panel).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toContainText("Ətraflı axtarışı gizlət");
    await expect(page).toHaveURL(/\/$/); // expansion is state, not navigation
    await expectNoHorizontalOverflow(page);
    // selections survive collapse/expand — collapse is NOT reset
    await page.getByTestId("home-adv-city").selectOption(s.bakuCityId);
    await page.getByTestId("home-adv-price-min").fill("5000");
    await page.getByTestId("home-adv-year-min").selectOption("2020");
    await toggle.click();
    await expect(panel).toBeHidden();
    await toggle.click();
    await expect(page.getByTestId("home-adv-city")).toHaveValue(s.bakuCityId);
    await expect(page.getByTestId("home-adv-price-min")).toHaveValue("5000");
    await expect(page.getByTestId("home-adv-year-min")).toHaveValue("2020");
    // explicit Təmizlə resets
    await page.getByTestId("home-adv-clear").click();
    await expect(page.getByTestId("home-adv-city")).toHaveValue("");
    await expect(page.getByTestId("home-adv-price-min")).toHaveValue("");
  });

  test("price/mileage steppers move ±500/±1000 from the CURRENT value; typing stays free (UAT correction 1)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-advanced-toggle").click();
    const price = page.getByTestId("home-adv-price-min");
    // blank → +500 → 1000 → back to 500
    await page.getByTestId("home-adv-price-min-inc").click();
    await expect(price).toHaveValue("500");
    await page.getByTestId("home-adv-price-min-inc").click();
    await expect(price).toHaveValue("1000");
    await page.getByTestId("home-adv-price-min-dec").click();
    await expect(price).toHaveValue("500");
    // manual arbitrary value is kept, never rounded; step moves FROM it
    await price.fill("27300");
    await page.getByTestId("home-adv-price-min-inc").click();
    await expect(price).toHaveValue("27800");
    await page.getByTestId("home-adv-price-min-dec").click();
    await expect(price).toHaveValue("27300");
    // ArrowUp/ArrowDown mirror the step
    await price.focus();
    await page.keyboard.press("ArrowUp");
    await expect(price).toHaveValue("27800");
    await page.keyboard.press("ArrowDown");
    await expect(price).toHaveValue("27300");

    const mileage = page.getByTestId("home-adv-mileage-max");
    await page.getByTestId("home-adv-mileage-max-inc").click();
    await expect(mileage).toHaveValue("1000");
    await page.getByTestId("home-adv-mileage-max-inc").click();
    await expect(mileage).toHaveValue("2000");
    await mileage.fill("123500");
    await page.getByTestId("home-adv-mileage-max-inc").click();
    await expect(mileage).toHaveValue("124500");
    await page.getByTestId("home-adv-mileage-max-dec").click();
    await expect(mileage).toHaveValue("123500");
  });

  test("year controls are selects (newest first) and both bounds serialize + restore (UAT correction 1)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-advanced-toggle").click();
    const yearMin = page.getByTestId("home-adv-year-min");
    const yearMax = page.getByTestId("home-adv-year-max");
    // real <select> controls with neutral empty options
    expect(await yearMin.evaluate((el) => el.tagName)).toBe("SELECT");
    expect(await yearMax.evaluate((el) => el.tagName)).toBe("SELECT");
    await expect(yearMin.locator("option").first()).toHaveText("Minimum il");
    // newest year first after the neutral option
    const currentYear = new Date().getFullYear();
    await expect(yearMin.locator("option").nth(1)).toHaveText(String(currentYear));
    await yearMin.selectOption("2020");
    await yearMax.selectOption("2024");
    // typed manual price value (non-multiple of 500) serializes untouched
    await page.getByTestId("home-adv-price-min").fill("27300");
    await page.getByTestId("home-search-submit").click();
    await page.waitForURL(/\/elanlar\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("year_min")).toBe("2020");
    expect(url.searchParams.get("year_max")).toBe("2024");
    expect(url.searchParams.get("price_min")).toBe("2730000"); // minor units, no rounding
    const form = page.getByTestId("filter-form").first();
    await expect(form.locator('input[name="year_min"]')).toHaveValue("2020");
    await expect(form.locator('input[name="year_max"]')).toHaveValue("2024");
    await expect(form.getByTestId("filter-price-min")).toHaveValue("27300");
  });

  test("advanced Home submission lands on /elanlar with the existing URL contract (4.17O.2)", async ({ page }) => {
    const s = seed();
    await page.goto("/");
    await page.getByTestId("home-advanced-toggle").click();
    await page.getByTestId("home-brand").selectOption(s.toyotaBrandId);
    await page.getByTestId("home-adv-city").selectOption(s.bakuCityId);
    await page.getByTestId("home-adv-price-min").fill("5000");
    await page.getByTestId("home-adv-year-min").selectOption("2015");
    await page.getByTestId("home-adv-credit").check();
    await page.getByTestId("home-search-submit").click();
    await page.waitForURL(/\/elanlar\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("category")).toBe("CAR");
    expect(url.searchParams.get("brand_id")).toBe(s.toyotaBrandId);
    expect(url.searchParams.get("city_id")).toBe(s.bakuCityId);
    expect(url.searchParams.get("price_min")).toBe("500000"); // minor units per contract
    expect(url.searchParams.get("year_min")).toBe("2015");
    expect(url.searchParams.get("credit")).toBe("true");
    // Search Results restores the same selections via URL-as-state
    const form = page.getByTestId("filter-form").first();
    await expect(form.getByTestId("filter-brand")).toHaveValue(s.toyotaBrandId);
    await expect(form.getByTestId("filter-city")).toHaveValue(s.bakuCityId);
    await expect(form.getByTestId("filter-price-min")).toHaveValue("5000");
    await expect(form.locator('input[name="year_min"]')).toHaveValue("2015");
    await expect(form.locator('input[name="credit"]')).toBeChecked();
    await expectNoHorizontalOverflow(page);
  });

  test("Premium zero state hides the section", async ({ page }) => {
    const s = seed();
    const sql = postgres(s.databaseUrl, { prepare: false, max: 1 });
    try {
      await sql`update listing_promotions set status = 'CANCELLED' where type = 'PREMIUM'`;
      await page.goto("/");
      await expect(page.getByTestId("new-count")).toBeVisible();
      await expect(page.getByTestId("premium-section")).toHaveCount(0);
    } finally {
      await sql`update listing_promotions set status = 'ACTIVE' where type = 'PREMIUM'`;
      await sql.end();
    }
  });

  test("mobile navigation drawer is reachable and closes", async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo.project.name), "mobile only");
    await page.goto("/");
    await page.getByTestId("mobile-menu-button").click();
    await expect(page.getByTestId("mobile-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mobile-menu")).toBeHidden();
  });
});
