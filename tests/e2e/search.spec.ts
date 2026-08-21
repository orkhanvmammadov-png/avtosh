import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, isMobile, seed } from "./helpers";

test.describe("Search", () => {
  test("anonymous car search shows Boost first, then organic, without duplicates", async ({ page }, testInfo) => {
    await page.goto("/elanlar?category=CAR");
    await expect(page.getByTestId("promoted-section")).toBeVisible();
    const visibleSlots = { desktop: 3, tablet: 3, mobile: 2 }[testInfo.project.name] ?? 3; // 3 seeded boosts
    const promotedVisibleCount = await page.getByTestId("promoted-card").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).length);
    expect(promotedVisibleCount).toBe(Math.min(visibleSlots, seed().boosted.length));
    const promotedIds = await page.getByTestId("promoted-card").getByTestId("listing-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-public-id")));
    const organicIds = await page.getByTestId("organic-card").getByTestId("listing-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-public-id")));
    expect(organicIds.length).toBe(24);
    for (const id of promotedIds) expect(organicIds).not.toContain(id);
    await expect(page.getByTestId("promoted-card").first()).toContainText("Reklam");
    await expectNoHorizontalOverflow(page);
  });

  test("load more appends the next cursor page without duplicates", async ({ page }) => {
    await page.goto("/elanlar?category=CAR");
    const before = await page.getByTestId("organic-card").count();
    await page.getByTestId("load-more").click();
    await expect.poll(async () => page.getByTestId("organic-card").count()).toBeGreaterThan(before);
    const ids = await page.getByTestId("organic-card").getByTestId("listing-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-public-id")));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("filters update the URL and results; sort works; clear keeps category", async ({ page }, testInfo) => {
    const s = seed();
    await page.goto("/elanlar?category=CAR");
    if (isMobile(testInfo.project.name) || testInfo.project.name === "tablet") {
      await page.getByTestId("filters-open").click();
      await expect(page.getByTestId("filters-drawer")).toBeVisible();
    } else {
      await expect(page.getByTestId("filters-desktop")).toBeVisible();
    }
    const form = page.locator('[data-testid="filter-form"]:visible').first();
    await form.getByTestId("filter-brand").selectOption(s.toyotaBrandId);
    await form.getByTestId("filter-model").selectOption(s.corollaModelId);
    await form.getByTestId("filter-price-max").fill("20000");
    await form.getByTestId("filter-apply").click();
    await page.waitForURL(/model_id=/);
    const url = new URL(page.url());
    expect(url.searchParams.get("brand_id")).toBe(s.toyotaBrandId);
    expect(url.searchParams.get("price_max")).toBe("2000000"); // 20 000 AZN entered → minor units in the URL/API
    await expect(page.getByTestId("organic-card").first()).toBeVisible();

    await page.getByTestId("sort-select").selectOption("PRICE_ASC");
    await page.waitForURL(/sort=PRICE_ASC/);
    const prices = await page.getByTestId("organic-card").locator("p.text-primary").allTextContents();
    const numeric = prices.map((p) => Number(p.replace(/[^\d]/g, "")));
    expect([...numeric].sort((a, b) => a - b)).toEqual(numeric);

    if (testInfo.project.name !== "desktop") await page.getByTestId("filters-open").click(); // drawer closed after apply
    await page.locator('[data-testid="filter-clear"]:visible').first().click();
    await page.waitForURL(/\/elanlar\?category=CAR$/);
  });

  test("motorcycle search hides car-only filters and shows motorcycle type", async ({ page }, testInfo) => {
    await page.goto("/elanlar?category=MOTORCYCLE");
    if (testInfo.project.name !== "desktop") await page.getByTestId("filters-open").click();
    const form = page.locator('[data-testid="filter-form"]:visible').first();
    await expect(form.getByTestId("filter-group-MOTORCYCLE_TYPE")).toBeVisible();
    await expect(form.getByTestId("filter-group-BODY_TYPE")).toHaveCount(0);
    const ids = await page.getByTestId("listing-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-public-id")));
    for (const id of seed().motos) expect(ids).toContain(id);
  });

  test("empty state and invalid URL state degrade safely", async ({ page }) => {
    await page.goto("/elanlar?category=CAR&price_min=999999999&price_max=999999999");
    await expect(page.getByText("Uyğun elan tapılmadı")).toBeVisible();
    await page.getByTestId("empty-clear").click();
    await page.waitForURL(/\/elanlar\?category=CAR$/);
    await page.goto("/elanlar?category=CAR&brand_id=not-a-uuid");
    await expect(page.getByText("Axtarış parametrləri düzgün deyil")).toBeVisible();
    // The page URL never carries a cursor (load-more is in-memory); a stray one is ignored safely.
    await page.goto("/elanlar?category=CAR&cursor=garbage");
    await expect(page.getByTestId("organic-card").first()).toBeVisible();
  });

  test("back navigation from a listing restores the search URL state", async ({ page }) => {
    const s = seed();
    await page.goto(`/elanlar?category=CAR&brand_id=${s.toyotaBrandId}&sort=PRICE_DESC`);
    await page.getByTestId("organic-card").first().getByRole("link").click();
    await page.waitForURL(/\/elan\/\d+/);
    await page.goBack();
    await page.waitForURL(/sort=PRICE_DESC/);
    expect(new URL(page.url()).searchParams.get("brand_id")).toBe(s.toyotaBrandId);
    await expect(page.getByTestId("organic-card").first()).toBeVisible();
  });
});
