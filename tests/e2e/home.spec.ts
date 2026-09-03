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

  test("advanced search expands inline, preserves values across collapse, resets only via Təmizlə (4.17O.2)", async ({ page }) => {
    const s = seed();
    await page.goto("/");
    const toggle = page.getByTestId("home-advanced-toggle");
    const panel = page.getByTestId("home-advanced-panel");
    await expect(panel).toBeHidden(); // collapsed by default
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/\/$/); // expansion is state, not navigation
    await expectNoHorizontalOverflow(page);
    // manual price (no steppers, arbitrary value), year select, multi fuel
    expect(await page.locator('[data-testid^="home-adv-price-min-"]').count()).toBe(0); // no +/- controls
    await page.getByTestId("home-adv-city").selectOption(s.bakuCityId);
    await page.getByTestId("home-adv-price-min").fill("27350");
    await page.getByTestId("home-adv-year-min").selectOption("2015");
    await page.getByTestId("home-adv-fuel_type-toggle").click();
    await page.getByTestId("home-adv-fuel_type-opt-PETROL").check();
    await page.getByTestId("home-adv-fuel_type-opt-HYBRID").check();
    // collapse is NOT reset
    await toggle.click();
    await expect(panel).toBeHidden();
    await toggle.click();
    await expect(page.getByTestId("home-adv-city")).toHaveValue(s.bakuCityId);
    await expect(page.getByTestId("home-adv-price-min")).toHaveValue("27350");
    await expect(page.getByTestId("home-adv-year-min")).toHaveValue("2015");
    await expect(page.getByTestId("home-adv-fuel_type-toggle")).toContainText("Benzin, Hibrid");
    // explicit Təmizlə clears everything
    await page.locator('[data-testid="home-adv-clear"]:visible').first().click();
    await expect(page.getByTestId("home-adv-city")).toHaveValue("");
    await expect(page.getByTestId("home-adv-price-min")).toHaveValue("");
    await expect(page.getByTestId("home-adv-year-min")).toHaveValue("");
    await expect(page.getByTestId("home-adv-fuel_type-toggle")).toContainText("Hamısı");
  });

  test("Kredit/Barter are toggle buttons in the Price block: collapse-safe, Təmizlə-cleared, restored on results", async ({ page }, testInfo) => {
    await page.goto("/");
    const toggle = page.getByTestId("home-advanced-toggle");
    await toggle.click();
    const credit = page.getByTestId("home-adv-credit");
    const barter = page.getByTestId("home-adv-barter");
    // real toggle buttons inside the Price block — NO checkbox presentation on Home
    expect(await credit.evaluate((el) => el.tagName)).toBe("BUTTON");
    expect(await barter.evaluate((el) => el.tagName)).toBe("BUTTON");
    expect(await page.locator('[data-testid="home-advanced-panel"] input[type="checkbox"][name="credit"], [data-testid="home-advanced-panel"] input[type="checkbox"][name="barter"]').count()).toBe(0);
    await expect(page.getByTestId("home-adv-price-block").getByTestId("home-adv-credit")).toBeVisible(); // lives under the price inputs
    await expect(credit).toHaveAttribute("aria-pressed", "false");
    await credit.click();
    await expect(credit).toHaveAttribute("aria-pressed", "true");
    await barter.click();
    await expect(barter).toHaveAttribute("aria-pressed", "true"); // both simultaneously
    // collapse is NOT reset
    await toggle.click();
    await toggle.click();
    await expect(credit).toHaveAttribute("aria-pressed", "true");
    await expect(barter).toHaveAttribute("aria-pressed", "true");
    // Axtar → existing canonical params; Search Results restores both
    await page.getByTestId("home-search-submit").click();
    await page.waitForURL(/credit=true/);
    const url = new URL(page.url());
    expect(url.searchParams.get("credit")).toBe("true");
    expect(url.searchParams.get("barter")).toBe("true");
    if (isMobile(testInfo.project.name) || testInfo.project.name === "tablet") {
      await page.getByTestId("filters-open").click();
    }
    const form = page.locator('[data-testid="filter-form"]:visible').first();
    await expect(form.locator('input[name="credit"]')).toBeChecked();
    await expect(form.locator('input[name="barter"]')).toBeChecked();
    // Təmizlə clears both
    await page.goto("/");
    await page.getByTestId("home-advanced-toggle").click();
    await page.getByTestId("home-adv-credit").click();
    await page.getByTestId("home-adv-barter").click();
    await page.locator('[data-testid="home-adv-clear"]:visible').first().click();
    await expect(page.getByTestId("home-adv-credit")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("home-adv-barter")).toHaveAttribute("aria-pressed", "false");
  });

  test("CAR advanced filters follow the owner-authoritative reading order (UAT-C2)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-advanced-toggle").click();
    const ordered = [
      "home-adv-body_type_id",   // Ban növü
      "home-adv-mileage-max",    // Yürüş
      "home-adv-year-min",       // Buraxılış ili
      "home-adv-engine-min",     // Mühərrikin həcmi
      "home-adv-color-toggle",   // Rəng
      "home-adv-price-min",      // Qiymət
      "home-adv-credit",         // Kredit (inside price block)
      "home-adv-barter",
      "home-adv-fuel_type-toggle",     // Yanacaq
      "home-adv-drive_type_id",        // Ötürücü
      "home-adv-transmission-toggle",  // Sürətlər qutusu
      "home-adv-no-accident",          // Avtomobil vəziyyəti — final
      "home-adv-not-repainted",
    ];
    const inDocumentOrder = await page.evaluate((ids) => {
      const nodes = ids.map((id) => document.querySelector(`[data-testid="${id}"]`));
      if (nodes.some((n) => n === null)) return "missing:" + ids.filter((_, i) => nodes[i] === null).join(",");
      for (let i = 0; i < nodes.length - 1; i += 1) {
        const rel = nodes[i]!.compareDocumentPosition(nodes[i + 1]!);
        if (!(rel & Node.DOCUMENT_POSITION_FOLLOWING)) return `out-of-order:${ids[i]}>${ids[i + 1]}`;
      }
      return "ok";
    }, ordered);
    expect(inDocumentOrder).toBe("ok");
    // condition block concludes the panel as a full-width final row
    const panelBox = (await page.getByTestId("home-advanced-panel").boundingBox())!;
    const conditionBox = (await page.getByTestId("home-adv-no-accident").boundingBox())!;
    const fuelBox = (await page.getByTestId("home-adv-fuel_type-toggle").boundingBox())!;
    expect(conditionBox.y).toBeGreaterThan(fuelBox.y);
    expect(panelBox.y + panelBox.height).toBeGreaterThan(conditionBox.y);
  });

  test("multi-select closes on outside click / Escape; one open at a time; inside stays usable (UAT-C1)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-advanced-toggle").click();
    const fuelToggle = page.getByTestId("home-adv-fuel_type-toggle");
    const fuelPanel = page.getByTestId("home-adv-fuel_type-panel");
    // inside interaction keeps the panel usable
    await fuelToggle.click();
    await expect(fuelPanel).toBeVisible();
    await page.getByTestId("home-adv-fuel_type-opt-PETROL").check();
    await expect(fuelPanel).toBeVisible();
    await expect(fuelToggle).toContainText("Benzin");
    // outside click closes (selection kept)
    await page.getByTestId("home-adv-city").click();
    await expect(fuelPanel).toBeHidden();
    await expect(fuelToggle).toHaveAttribute("aria-expanded", "false");
    await expect(fuelToggle).toContainText("Benzin");
    // Escape closes and the trigger stays keyboard-usable
    await fuelToggle.click();
    await expect(fuelPanel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(fuelPanel).toBeHidden();
    await expect(fuelToggle).toHaveAttribute("aria-expanded", "false");
    await fuelToggle.press("Enter");
    await expect(fuelPanel).toBeVisible();
    await page.keyboard.press("Escape");
    // one open at a time (panels overlay content per the approved
    // design, so the chain moves upward: trans → fuel → color, each
    // next trigger above/beside the previously open panel)
    await page.getByTestId("home-adv-transmission-toggle").click();
    await expect(page.getByTestId("home-adv-transmission-panel")).toBeVisible();
    await fuelToggle.click();
    await expect(fuelPanel).toBeVisible();
    await expect(page.getByTestId("home-adv-transmission-panel")).toBeHidden();
    await page.getByTestId("home-adv-color-toggle").click();
    await expect(page.getByTestId("home-adv-color-panel")).toBeVisible();
    await expect(fuelPanel).toBeHidden();
  });

  test("closed advanced controls share one geometry family (UAT-C1)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-advanced-toggle").click();
    const heightOf = async (testid: string) => (await page.getByTestId(testid).boundingBox())!.height;
    const reference = await heightOf("home-adv-body_type_id"); // 1C standard control
    for (const control of ["home-adv-price-min", "home-adv-mileage-max", "home-adv-fuel_type-toggle", "home-adv-transmission-toggle", "home-adv-color-toggle", "home-adv-engine-min", "home-adv-year-min", "home-adv-drive_type_id"]) {
      expect(Math.abs((await heightOf(control)) - reference), control).toBeLessThanOrEqual(2);
    }
    // Price and Engine share the same primary control recipe (height;
    // widths differ by approved layout: spine-stacked at desk, twin
    // columns in the band)
    const priceMin = (await page.getByTestId("home-adv-price-min").boundingBox())!;
    const engineMin = (await page.getByTestId("home-adv-engine-min").boundingBox())!;
    expect(Math.abs(priceMin.height - engineMin.height)).toBeLessThanOrEqual(2);
    // long summaries never grow the trigger
    await page.getByTestId("home-adv-color-toggle").click();
    for (const code of ["BLACK", "WHITE", "RED", "GREEN"]) {
      await page.getByTestId(`home-adv-color-opt-${code}`).check();
    }
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("home-adv-color-toggle")).toContainText("+2");
    expect(Math.abs((await heightOf("home-adv-color-toggle")) - reference)).toBeLessThanOrEqual(2);
  });

  test("year dropdowns cover 1900 → currentYear+1 (4.17O.2)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-advanced-toggle").click();
    const yearMin = page.getByTestId("home-adv-year-min");
    const expectedMax = new Date().getFullYear() + 1;
    await expect(yearMin.locator("option").nth(1)).toHaveText(String(expectedMax));
    await expect(yearMin.locator("option").last()).toHaveText("1900");
    await yearMin.selectOption("1900");
    await expect(yearMin).toHaveValue("1900");
    await page.getByTestId("home-adv-year-max").selectOption(String(expectedMax));
    await expect(page.getByTestId("home-adv-year-max")).toHaveValue(String(expectedMax));
  });

  test("full advanced submission restores every selection on Search Results (4.17O.2)", async ({ page }, testInfo) => {
    const s = seed();
    await page.goto("/");
    await page.getByTestId("home-advanced-toggle").click();
    // non-panel fields first (no overlay open), including the final blocks
    await page.getByTestId("home-brand").selectOption(s.toyotaBrandId);
    await page.getByTestId("home-adv-city").selectOption(s.bakuCityId);
    await page.getByTestId("home-adv-price-min").fill("5000");
    await page.getByTestId("home-adv-year-min").selectOption("2015");
    await page.getByTestId("home-adv-mileage-max").fill("123500");
    await page.getByTestId("home-adv-engine-min").selectOption("1000");
    await page.getByTestId("home-adv-engine-max").selectOption("7000");
    await page.getByTestId("home-adv-no-accident").click();
    await page.getByTestId("home-adv-not-repainted").click();
    // overlay panels bottom-up so each trigger stays reachable
    await page.getByTestId("home-adv-transmission-toggle").click();
    const at = page.getByTestId("home-adv-transmission-opt-AUTOMATIC");
    const robot = page.getByTestId("home-adv-transmission-opt-ROBOT");
    await at.check();
    await robot.check();
    const transIds = [await at.inputValue(), await robot.inputValue()];
    await page.getByTestId("home-adv-fuel_type-toggle").click();
    const petrol = page.getByTestId("home-adv-fuel_type-opt-PETROL");
    const hybrid = page.getByTestId("home-adv-fuel_type-opt-HYBRID");
    await petrol.check();
    await hybrid.check();
    const fuelIds = [await petrol.inputValue(), await hybrid.inputValue()];
    await page.getByTestId("home-adv-color-toggle").click();
    const black = page.getByTestId("home-adv-color-opt-BLACK");
    const white = page.getByTestId("home-adv-color-opt-WHITE");
    await black.check();
    await white.check();
    const colorIds = [await black.inputValue(), await white.inputValue()];
    await page.keyboard.press("Escape");
    await page.getByTestId("home-search-submit").click();
    await page.waitForURL(/\/elanlar\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("category")).toBe("CAR");
    expect(url.searchParams.get("brand_id")).toBe(s.toyotaBrandId);
    expect(url.searchParams.get("city_id")).toBe(s.bakuCityId);
    expect(url.searchParams.get("price_min")).toBe("500000");
    expect(url.searchParams.get("year_min")).toBe("2015");
    expect(url.searchParams.get("mileage_max")).toBe("123500");
    expect(url.searchParams.get("engine_cc_min")).toBe("1000");
    expect(url.searchParams.get("engine_cc_max")).toBe("7000");
    expect(url.searchParams.get("fuel_type_ids")).toBe(fuelIds.join(","));
    expect(url.searchParams.get("transmission_ids")).toBe(transIds.join(","));
    expect(url.searchParams.get("color_ids")).toBe(colorIds.join(","));
    expect(url.searchParams.get("no_accident")).toBe("true");
    expect(url.searchParams.get("not_repainted")).toBe("true");
    // Search Results restores everything via URL-as-state
    if (isMobile(testInfo.project.name) || testInfo.project.name === "tablet") {
      await page.getByTestId("filters-open").click();
    }
    const form = page.locator('[data-testid="filter-form"]:visible').first();
    await expect(form.getByTestId("filter-brand")).toHaveValue(s.toyotaBrandId);
    await expect(form.getByTestId("filter-city")).toHaveValue(s.bakuCityId);
    await expect(form.getByTestId("filter-price-min")).toHaveValue("5000");
    await expect(form.getByTestId("filter-year-min")).toHaveValue("2015");
    await expect(form.getByTestId("filter-mileage-max")).toHaveValue("123500");
    await expect(form.getByTestId("filter-engine-min")).toHaveValue("1000");
    await expect(form.getByTestId("filter-engine-max")).toHaveValue("7000");
    await expect(form.getByTestId("filter-fuel_type-toggle")).toContainText("Benzin, Hibrid");
    await form.getByTestId("filter-color-toggle").click();
    await expect(form.getByTestId("filter-color-opt-BLACK")).toBeChecked();
    await expect(form.getByTestId("filter-color-opt-WHITE")).toBeChecked();
    await expect(form.getByTestId("filter-no-accident")).toBeChecked();
    await expect(form.getByTestId("filter-not-repainted")).toBeChecked();
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
