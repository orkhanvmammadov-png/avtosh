import postgres from "postgres";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, isMobile, seed } from "./helpers";
import { testPhone } from "./auth-helpers";
import { insertListingFixture } from "./seller-helpers";

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

  async function openFilterForm(page: import("@playwright/test").Page, project: string) {
    if (isMobile(project) || project === "tablet") {
      await page.getByTestId("filters-open").click();
      await expect(page.getByTestId("filters-drawer")).toBeVisible();
    } else {
      await expect(page.getByTestId("filters-desktop")).toBeVisible();
    }
    return page.locator('[data-testid="filter-form"]:visible').first();
  }

  async function closeFilterForm(page: import("@playwright/test").Page, project: string) {
    if (isMobile(project) || project === "tablet") {
      await page.getByTestId("filters-close").click();
      await expect(page.getByTestId("filters-drawer")).toBeHidden();
    }
  }

  test("multi-select fuel/transmission/color: OR values serialize, restore, remove one, clear group (4.17O.2)", async ({ page }, testInfo) => {
    await page.goto("/elanlar?category=CAR");
    let form = await openFilterForm(page, testInfo.project.name);
    // fuel: two values through the disclosure panel
    await form.getByTestId("filter-fuel_type-toggle").click();
    const petrol = form.getByTestId("filter-fuel_type-opt-PETROL");
    const hybrid = form.getByTestId("filter-fuel_type-opt-HYBRID");
    await petrol.check();
    await hybrid.check();
    const petrolId = await petrol.inputValue();
    const hybridId = await hybrid.inputValue();
    await expect(form.getByTestId("filter-fuel_type-toggle")).toContainText("Benzin, Hibrid");
    // color: swatches render before labels
    await form.getByTestId("filter-color-toggle").click();
    const black = form.getByTestId("filter-color-opt-BLACK");
    await black.check();
    const blackId = await black.inputValue();
    await form.getByTestId("filter-apply").click();
    await page.waitForURL(/fuel_type_ids=/);
    let url = new URL(page.url());
    expect(url.searchParams.get("fuel_type_ids")).toBe(`${petrolId},${hybridId}`);
    expect(url.searchParams.get("color_ids")).toBe(blackId);

    // reload restores every selection (URL-as-state)
    await page.reload();
    form = await openFilterForm(page, testInfo.project.name);
    await form.getByTestId("filter-fuel_type-toggle").click();
    await expect(form.getByTestId("filter-fuel_type-opt-PETROL")).toBeChecked();
    await expect(form.getByTestId("filter-fuel_type-opt-HYBRID")).toBeChecked();
    await expect(form.getByTestId("filter-fuel_type-toggle")).toContainText("Benzin, Hibrid");
    await closeFilterForm(page, testInfo.project.name);

    // removing ONE applied value keeps the others
    await page.locator('[data-testid="applied-filter"]', { hasText: "Hibrid" }).first().click();
    await page.waitForURL((u) => !u.searchParams.getAll("fuel_type_ids").join(",").includes(hybridId));
    url = new URL(page.url());
    expect(url.searchParams.get("fuel_type_ids")).toBe(petrolId);
    expect(url.searchParams.get("color_ids")).toBe(blackId);

    // clearing the fuel group keeps color
    form = await openFilterForm(page, testInfo.project.name);
    await form.getByTestId("filter-fuel_type-toggle").click();
    await form.getByTestId("filter-fuel_type-clear").click();
    await form.getByTestId("filter-apply").click();
    await page.waitForURL((u) => u.searchParams.get("fuel_type_ids") === null);
    url = new URL(page.url());
    expect(url.searchParams.get("color_ids")).toBe(blackId);
  });

  test("condition, engine and year selects serialize and restore (4.17O.2)", async ({ page }, testInfo) => {
    await page.goto("/elanlar?category=CAR");
    let form = await openFilterForm(page, testInfo.project.name);
    await form.getByTestId("filter-no-accident").check();
    await form.getByTestId("filter-not-repainted").check();
    await form.getByTestId("filter-engine-min").selectOption("1000");
    await form.getByTestId("filter-engine-max").selectOption("7000"); // post-6500 step-500 tier
    await form.getByTestId("filter-year-min").selectOption("2015");
    await form.getByTestId("filter-apply").click();
    await page.waitForURL(/no_accident=true/);
    const url = new URL(page.url());
    expect(url.searchParams.get("not_repainted")).toBe("true");
    expect(url.searchParams.get("engine_cc_min")).toBe("1000");
    expect(url.searchParams.get("engine_cc_max")).toBe("7000");
    expect(url.searchParams.get("year_min")).toBe("2015");
    await page.reload();
    form = await openFilterForm(page, testInfo.project.name);
    await expect(form.getByTestId("filter-no-accident")).toBeChecked();
    await expect(form.getByTestId("filter-engine-min")).toHaveValue("1000");
    await expect(form.getByTestId("filter-year-min")).toHaveValue("2015");
    await closeFilterForm(page, testInfo.project.name);
    // both condition chips exist independently; removing one keeps the other
    await page.locator('[data-testid="applied-filter"]', { hasText: "Rənglənməyib" }).first().click();
    await page.waitForURL((u) => u.searchParams.get("not_repainted") === null);
    expect(new URL(page.url()).searchParams.get("no_accident")).toBe("true");
  });

  test("multi-select dismissal inside the mobile filter sheet never closes the sheet (UAT-C1)", async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo.project.name) && testInfo.project.name !== "tablet", "sheet exists below desk only");
    await page.goto("/elanlar?category=CAR");
    await page.getByTestId("filters-open").click();
    const drawer = page.getByTestId("filters-drawer");
    await expect(drawer).toBeVisible();
    const form = page.locator('[data-testid="filter-form"]:visible').first();
    await form.getByTestId("filter-fuel_type-toggle").click();
    await expect(form.getByTestId("filter-fuel_type-panel")).toBeVisible();
    await form.getByTestId("filter-fuel_type-opt-PETROL").check();
    // Escape closes ONLY the multi-select panel, not the outer sheet
    await page.keyboard.press("Escape");
    await expect(form.getByTestId("filter-fuel_type-panel")).toBeHidden();
    await expect(drawer).toBeVisible();
    // clicking elsewhere INSIDE the sheet closes the panel, sheet stays healthy
    await form.getByTestId("filter-fuel_type-toggle").click();
    await form.getByTestId("filter-brand").click();
    await expect(form.getByTestId("filter-fuel_type-panel")).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(form.getByTestId("filter-fuel_type-toggle")).toContainText("Benzin");
  });

  test("legacy singular URLs parse and re-serialize canonically (4.17O.2)", async ({ page }, testInfo) => {
    await page.goto("/elanlar?category=CAR");
    let form = await openFilterForm(page, testInfo.project.name);
    await form.getByTestId("filter-fuel_type-toggle").click();
    const petrolId = await form.getByTestId("filter-fuel_type-opt-PETROL").inputValue();
    // legacy bookmarked URL with the singular param
    await page.goto(`/elanlar?category=CAR&fuel_type_id=${petrolId}`);
    form = await openFilterForm(page, testInfo.project.name);
    await form.getByTestId("filter-fuel_type-toggle").click();
    await expect(form.getByTestId("filter-fuel_type-opt-PETROL")).toBeChecked();
    await expect(page.getByTestId("applied-filters")).toContainText("Benzin");
    // legacy over-range year canonicalizes instead of crashing
    await page.goto(`/elanlar?category=CAR&year_max=2100`);
    await expect(page.getByTestId("sort-select")).toBeVisible();
    await expect(page.getByTestId("organic-card").first()).toBeVisible();
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

  test("back navigation from a listing restores the search URL state", async ({ page }, { project }) => {
    const s = seed();
    // Include a ≥30-day-old ACTIVE listing so the card set exercises
    // the absolute-date freshness branch (the Phase 4.16 renewal data
    // shape that exposed the hydration defect on CI).
    await insertOldPublishedListing(project.name, 170);
    await page.goto(`/elanlar?category=CAR&brand_id=${s.toyotaBrandId}&sort=PRICE_DESC`);
    const firstCard = page.getByTestId("organic-card").first();
    // Real hydration/interactivity signal — the card heart leaves its
    // server-rendered "unknown" state only after client JS is live.
    // No sleeps, no timeout changes: a hydration-crashed subtree would
    // keep this attribute at "unknown" and fail here, loudly.
    await expect(firstCard.getByTestId("favorite-button")).not.toHaveAttribute(
      "data-favorited",
      "unknown",
    );
    await firstCard.getByRole("link").click();
    await page.waitForURL(/\/elan\/\d+/);
    await page.goBack();
    await page.waitForURL(/sort=PRICE_DESC/);
    const restored = new URL(page.url());
    expect(restored.pathname).toBe("/elanlar");
    expect(restored.searchParams.get("category")).toBe("CAR");
    expect(restored.searchParams.get("brand_id")).toBe(s.toyotaBrandId);
    expect(restored.searchParams.get("sort")).toBe("PRICE_DESC");
    await expect(page.getByTestId("organic-card").first()).toBeVisible();
  });

  test("listing card dates hydrate byte-identically — no hydration errors, stable text, working link", async ({ page }, { project }) => {
    const { publicId, expectedDate } = await insertOldPublishedListing(project.name, 171);
    // Capture EVERY console error and page error from before navigation —
    // nothing is filtered out or silenced.
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(String(error)));

    // exact-price filter guarantees THIS card is on page 1
    await page.goto(`/elanlar?category=CAR&price_min=1234500&price_max=1234500`);
    const card = page.locator(`[data-testid="listing-card"][data-public-id="${publicId}"]`);
    await expect(card).toBeVisible();
    const dateLocator = card.getByTestId("card-freshness");
    // server-rendered text is the deterministic Baku DD.MM.YYYY
    await expect(dateLocator).toHaveText(expectedDate);
    // wait for REAL hydration (heart leaves the unknown state)…
    await expect(card.getByTestId("favorite-button")).not.toHaveAttribute(
      "data-favorited",
      "unknown",
    );
    // …and the hydrated client render produced byte-identical text
    await expect(dateLocator).toHaveText(expectedDate);
    // React emitted no hydration failure and no JS error. The ONLY
    // messages excluded are the browser's network-resource log lines
    // ("Failed to load resource" — e.g. the expected anonymous 401 on
    // the favorites lookup) and Google-Fonts CORS noise caused by this
    // harness's own injected x-forwarded-for header breaking font
    // preflights. Every React warning/error (hydration mismatches
    // arrive here with full text) and every pageerror still fails.
    const appErrors = consoleErrors.filter(
      (message) =>
        !/^Failed to load resource/.test(message) && !/^Access to font at /.test(message),
    );
    expect(appErrors).toEqual([]);
    // the SSR-rendered link survived hydration and navigates
    await card.getByRole("link").click();
    await page.waitForURL(new RegExp(`/elan/${publicId}$`));
    await expect(page.getByTestId("listing-detail")).toBeVisible();
  });
});

/** ACTIVE listing published 40 days ago (still 20 days of validity left). */
async function insertOldPublishedListing(
  project: string,
  slot: number,
): Promise<{ publicId: string; expectedDate: string }> {
  const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  try {
    const [owner] = await sql`
      insert into users (phone_e164) values (${testPhone(project, slot)})
      on conflict (phone_e164) do update set last_login_at = now() returning id
    `;
    const fixture = await insertListingFixture(owner.id as string, { status: "ACTIVE", images: 1 });
    const [row] = await sql`
      update listings
      set published_at = now() - interval '40 days',
          current_expires_at = now() + interval '20 days',
          price_minor = 1234500
      where id = ${fixture.id}
      returning to_char(published_at at time zone 'Asia/Baku', 'DD.MM.YYYY') as expected
    `;
    return { publicId: fixture.publicId, expectedDate: row.expected as string };
  } finally {
    await sql.end();
  }
}
