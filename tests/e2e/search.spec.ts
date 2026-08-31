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
