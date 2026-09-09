import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";
import { testPhone } from "./auth-helpers";
import { insertListingFixture } from "./seller-helpers";

/**
 * O.6 unified Search Results: the approved Home/Direction-1C search
 * card in results mode (URL-restored controls, auto-collapse on
 * apply), chips + Sort toolbar, ONE boost-first deduplicated grid.
 * All URL / filter / boost / cursor semantics are the sealed O.2
 * contracts — these tests drive them through the unified UI.
 */

async function openPanel(page: Page) {
  const toggle = page.getByTestId("home-advanced-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(page.getByTestId("home-advanced-panel")).toBeVisible();
}

async function apply(page: Page) {
  await page.locator('[data-testid="home-adv-submit"]:visible').first().click();
}

test.describe("Search", () => {
  test("unified results: no sidebar, boost leads the single grid with BOOST badges, no duplicates", async ({ page }, testInfo) => {
    await page.goto("/elanlar?category=CAR");
    // old architecture is gone entirely
    await expect(page.getByTestId("filters-desktop")).toHaveCount(0);
    await expect(page.getByTestId("filter-form")).toHaveCount(0);
    await expect(page.getByTestId("filters-open")).toHaveCount(0);
    await expect(page.getByTestId("promoted-section")).toHaveCount(0);
    await expect(page.getByText("Reklam", { exact: true })).toHaveCount(0);
    // unified search card present, collapsed by default
    await expect(page.getByTestId("home-advanced-toggle")).toBeVisible();
    await expect(page.getByTestId("home-advanced-panel")).toBeHidden();
    // boost cards open the SAME grid, in service order, before organic
    const grid = page.getByTestId("results-grid");
    const kinds = await grid.locator("> li[data-testid]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    const firstOrganic = kinds.indexOf("organic-card");
    expect(kinds.slice(0, firstOrganic).every((k) => k === "promoted-card")).toBe(true);
    expect(kinds.slice(firstOrganic)).not.toContain("promoted-card");
    // viewport slot policy (4/3/2, 3 boosts seeded) via the existing classes
    const visibleSlots = { desktop: 4, tablet: 3, mobile: 2 }[testInfo.project.name] ?? 4;
    const promotedVisible = await page.getByTestId("promoted-card").evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0));
    expect(promotedVisible.length).toBe(Math.min(visibleSlots, seed().boosted.length));
    // every VISIBLE boost card carries the BOOST text
    const visibleTexts = await page.getByTestId("promoted-card").evaluateAll((els) =>
      els.filter((e) => e.getClientRects().length > 0).map((e) => e.textContent ?? ""),
    );
    for (const text of visibleTexts) expect(text).toContain("Boost");
    // no visible duplicate between boost and organic
    const promotedIds = await page.getByTestId("promoted-card").getByTestId("listing-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-public-id")));
    const organicIds = await page.getByTestId("organic-card").getByTestId("listing-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-public-id")));
    expect(organicIds.length).toBe(24);
    for (const id of promotedIds) expect(organicIds).not.toContain(id);
    await expectNoHorizontalOverflow(page);
  });

  test("load more appends the next cursor page without duplicates against the combined grid", async ({ page }) => {
    await page.goto("/elanlar?category=CAR");
    const before = await page.getByTestId("organic-card").count();
    await page.getByTestId("load-more").click();
    await expect.poll(async () => page.getByTestId("organic-card").count()).toBeGreaterThan(before);
    const ids = await page.getByTestId("organic-card").getByTestId("listing-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-public-id")));
    expect(new Set(ids).size).toBe(ids.length);
    // a VISIBLE boost listing never re-appears organically in the journey
    const visiblePromoted = await page.getByTestId("promoted-card").evaluateAll((els) =>
      els.filter((e) => e.getClientRects().length > 0)
        .map((e) => e.querySelector('[data-testid="listing-card"]')?.getAttribute("data-public-id")),
    );
    for (const id of visiblePromoted) expect(ids).not.toContain(id);
  });

  test("multi-select fuel/transmission/color: OR values serialize, restore, remove one, clear group (4.17O.2)", async ({ page }) => {
    await page.goto("/elanlar?category=CAR");
    await openPanel(page);
    // fuel: two values through the disclosure panel
    await page.getByTestId("home-adv-fuel_type-toggle").click();
    const petrol = page.getByTestId("home-adv-fuel_type-opt-PETROL");
    const hybrid = page.getByTestId("home-adv-fuel_type-opt-HYBRID");
    await petrol.check();
    await hybrid.check();
    const petrolId = await petrol.inputValue();
    const hybridId = await hybrid.inputValue();
    await expect(page.getByTestId("home-adv-fuel_type-toggle")).toContainText("Benzin, Hibrid");
    // color: swatch multi-select
    await page.getByTestId("home-adv-color-toggle").click();
    const black = page.getByTestId("home-adv-color-opt-BLACK");
    await black.check();
    const blackId = await black.inputValue();
    await page.keyboard.press("Escape");
    await apply(page);
    await page.waitForURL(/fuel_type_ids=/);
    let url = new URL(page.url());
    expect(url.searchParams.get("fuel_type_ids")).toBe(`${petrolId},${hybridId}`);
    expect(url.searchParams.get("color_ids")).toBe(blackId);
    // applying COLLAPSES the advanced panel (O.6 apply contract)
    await expect(page.getByTestId("home-advanced-panel")).toBeHidden();
    await expect(page.getByTestId("home-advanced-toggle")).toHaveAttribute("aria-expanded", "false");

    // reload restores every selection into the CONTROLS (URL-as-state)
    await page.reload();
    await openPanel(page);
    await page.getByTestId("home-adv-fuel_type-toggle").click();
    await expect(page.getByTestId("home-adv-fuel_type-opt-PETROL")).toBeChecked();
    await expect(page.getByTestId("home-adv-fuel_type-opt-HYBRID")).toBeChecked();
    await expect(page.getByTestId("home-adv-fuel_type-toggle")).toContainText("Benzin, Hibrid");
    await page.keyboard.press("Escape");

    // removing ONE applied chip value keeps the others
    await page.locator('[data-testid="applied-filter"]', { hasText: "Hibrid" }).first().click();
    await page.waitForURL((u) => !u.searchParams.getAll("fuel_type_ids").join(",").includes(hybridId));
    url = new URL(page.url());
    expect(url.searchParams.get("fuel_type_ids")).toBe(petrolId);
    expect(url.searchParams.get("color_ids")).toBe(blackId);

    // clearing the fuel group in the panel keeps color
    await openPanel(page);
    await page.getByTestId("home-adv-fuel_type-toggle").click();
    await page.getByTestId("home-adv-fuel_type-clear").click();
    await page.keyboard.press("Escape");
    await apply(page);
    await page.waitForURL((u) => u.searchParams.get("fuel_type_ids") === null);
    url = new URL(page.url());
    expect(url.searchParams.get("color_ids")).toBe(blackId);
  });

  test("condition, engine and year controls serialize and restore (4.17O.2)", async ({ page }) => {
    await page.goto("/elanlar?category=CAR");
    await openPanel(page);
    await page.getByTestId("home-adv-no-accident").click();
    await page.getByTestId("home-adv-not-repainted").click();
    await page.getByTestId("home-adv-engine-min").selectOption("1000");
    await page.getByTestId("home-adv-engine-max").selectOption("7000"); // post-6500 step-500 tier
    await page.getByTestId("home-adv-year-min").selectOption("2015");
    await apply(page);
    await page.waitForURL(/no_accident=true/);
    const url = new URL(page.url());
    expect(url.searchParams.get("not_repainted")).toBe("true");
    expect(url.searchParams.get("engine_cc_min")).toBe("1000");
    expect(url.searchParams.get("engine_cc_max")).toBe("7000");
    expect(url.searchParams.get("year_min")).toBe("2015");
    await page.reload();
    await openPanel(page);
    await expect(page.getByTestId("home-adv-no-accident")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("home-adv-engine-min")).toHaveValue("1000");
    await expect(page.getByTestId("home-adv-year-min")).toHaveValue("2015");
    // both condition chips exist independently; removing one keeps the other
    await page.locator('[data-testid="applied-filter"]', { hasText: "Rənglənməyib" }).first().click();
    await page.waitForURL((u) => u.searchParams.get("not_repainted") === null);
    expect(new URL(page.url()).searchParams.get("no_accident")).toBe("true");
  });

  test("apply auto-collapse and Back/Forward restore the CONTROLS, not just the URL (4.17O.6)", async ({ page }) => {
    await page.goto("/elanlar?category=CAR");
    await openPanel(page);
    await page.getByTestId("home-adv-fuel_type-toggle").click();
    await page.getByTestId("home-adv-fuel_type-opt-PETROL").check();
    await page.keyboard.press("Escape");
    await apply(page);
    await page.waitForURL(/fuel_type_ids=/);
    // deterministic user-action collapse + applied count chip
    await expect(page.getByTestId("home-advanced-panel")).toBeHidden();
    await expect(page.getByTestId("home-adv-count")).toContainText("1 filtr");

    // Back: previous query (no fuel) re-initializes the CONTROLS —
    // proven on control UI only the freshly rendered tree can produce
    // (the count chip and the server-rendered chips), because the dev
    // router may still replace the tree once more after history
    // restore, which makes immediate panel interaction racy by design.
    await page.goBack();
    await page.waitForURL((u) => u.searchParams.get("fuel_type_ids") === null);
    await expect(page.getByTestId("home-adv-count")).toHaveCount(0);
    await expect(page.locator('[data-testid="applied-filter"]', { hasText: "Benzin" })).toHaveCount(0);

    // Forward: fuel query returns and the control state follows
    await page.goForward();
    await page.waitForURL(/fuel_type_ids=/);
    await expect(page.getByTestId("home-adv-count")).toContainText("1 filtr");
    await expect(page.locator('[data-testid="applied-filter"]', { hasText: "Benzin" })).toHaveCount(1);
    // ...and the panel controls restore at this history entry (reload
    // of the SAME entry — a single settled document, no history change)
    await page.reload();
    await openPanel(page);
    await page.getByTestId("home-adv-fuel_type-toggle").click();
    await expect(page.getByTestId("home-adv-fuel_type-opt-PETROL")).toBeChecked();
  });

  test("legacy singular URLs parse and re-serialize canonically (4.17O.2)", async ({ page }) => {
    await page.goto("/elanlar?category=CAR");
    await openPanel(page);
    await page.getByTestId("home-adv-fuel_type-toggle").click();
    const petrolId = await page.getByTestId("home-adv-fuel_type-opt-PETROL").inputValue();
    // legacy bookmarked URL with the singular param restores the control
    await page.goto(`/elanlar?category=CAR&fuel_type_id=${petrolId}`);
    await openPanel(page);
    await page.getByTestId("home-adv-fuel_type-toggle").click();
    await expect(page.getByTestId("home-adv-fuel_type-opt-PETROL")).toBeChecked();
    await expect(page.getByTestId("applied-filters")).toContainText("Benzin");
    // legacy over-range year canonicalizes instead of crashing
    await page.goto(`/elanlar?category=CAR&year_max=2100`);
    await expect(page.getByTestId("sort-select")).toBeVisible();
    await expect(page.getByTestId("organic-card").first()).toBeVisible();
  });

  test("filters update the URL and results; sort works; clear keeps category", async ({ page }) => {
    const s = seed();
    await page.goto("/elanlar?category=CAR");
    await page.getByTestId("home-brand").selectOption(s.toyotaBrandId);
    await page.getByTestId("home-model").selectOption(s.corollaModelId);
    await openPanel(page);
    await page.getByTestId("home-adv-price-max").fill("20000");
    await apply(page);
    await page.waitForURL(/model_id=/);
    const url = new URL(page.url());
    expect(url.searchParams.get("brand_id")).toBe(s.toyotaBrandId);
    expect(url.searchParams.get("price_max")).toBe("2000000"); // 20 000 AZN entered → minor units in the URL/API
    await expect(page.getByTestId("organic-card").first()).toBeVisible();
    // compact controls restored from the applied URL after remount
    await expect(page.getByTestId("home-brand")).toHaveValue(s.toyotaBrandId);
    await expect(page.getByTestId("home-model")).toHaveValue(s.corollaModelId);

    await page.getByTestId("sort-select").click();
    await page.getByTestId("sort-opt-PRICE_ASC").click();
    await page.waitForURL(/sort=PRICE_ASC/);
    await expect(page.getByTestId("sort-select")).toContainText("Qiymət: artan");
    const prices = await page.getByTestId("organic-card").locator("p.font-condensed").allTextContents();
    const numeric = prices.map((p) => Number(p.replace(/[^\d]/g, "")));
    expect(numeric.length).toBeGreaterThan(0);
    expect([...numeric].sort((a, b) => a - b)).toEqual(numeric);

    // Təmizlə (chips) clears criteria but keeps category + sort context
    await page.getByTestId("applied-clear-all").click();
    await page.waitForURL((u) => u.searchParams.get("brand_id") === null);
    const cleared = new URL(page.url());
    expect(cleared.searchParams.get("category")).toBe("CAR");
    expect(cleared.searchParams.get("sort")).toBe("PRICE_ASC");
    expect(cleared.searchParams.get("price_max")).toBeNull();
  });

  test("motorcycle search hides car-only filters and shows motorcycle type", async ({ page }) => {
    await page.goto("/elanlar?category=MOTORCYCLE");
    await openPanel(page);
    await expect(page.getByTestId("home-adv-motorcycle_type_id")).toBeVisible();
    await expect(page.getByTestId("home-adv-body_type_id")).toHaveCount(0);
    await expect(page.getByTestId("home-adv-drive_type_id")).toHaveCount(0);
    // vehicle-condition claims are CAR-only (O.6 layout.md category contract)
    await expect(page.getByTestId("home-adv-no-accident")).toHaveCount(0);
    await expect(page.getByTestId("home-adv-not-repainted")).toHaveCount(0);
    const ids = await page.getByTestId("listing-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-public-id")));
    for (const id of seed().motos) expect(ids).toContain(id);

    // stale condition URL state never creates a visible control: the
    // applied chip stays (honest, removable) but the panel shows no
    // toggle and Axtar does not re-serialize the hidden claim
    await page.goto("/elanlar?category=MOTORCYCLE&no_accident=true");
    await openPanel(page);
    await expect(page.getByTestId("home-adv-no-accident")).toHaveCount(0);
    await expect(page.locator('[data-testid="applied-filter"]', { hasText: "Vuruğu yoxdur" })).toHaveCount(1);
    await apply(page);
    await page.waitForURL((u) => u.searchParams.get("no_accident") === null);

    // live category switch CAR → MOTORCYCLE hides the CAR-only controls
    await page.goto("/elanlar?category=CAR");
    await openPanel(page);
    await expect(page.getByTestId("home-adv-no-accident")).toBeVisible();
    await expect(page.getByTestId("home-adv-body_type_id")).toBeVisible();
    await page.getByTestId("category-MOTORCYCLE").click();
    await expect(page.getByTestId("home-adv-no-accident")).toHaveCount(0);
    await expect(page.getByTestId("home-adv-body_type_id")).toHaveCount(0);
    await expect(page.getByTestId("home-adv-motorcycle_type_id")).toBeVisible();
  });

  test("premium + boost render BOTH textual badges on one card (4.17O.6)", async ({ page }, { project }) => {
    const s = seed();
    const sql = postgres(s.databaseUrl, { prepare: false, max: 1 });
    try {
      // give one seeded BOOST listing a settled PREMIUM promotion
      await sql`
        with target as (
          select l.id from listings l where l.public_id::text = ${s.boosted[0]}
        ), pay as (
          insert into payments (user_id, listing_id, type, amount_minor, idempotency_key, status, provider)
          select ${s.sellerId}, t.id, 'PREMIUM', 0, 'o6pb:' || t.id, 'SUCCESS', 'KAPITAL' from target t
          returning id, listing_id
        )
        insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
        select p.listing_id, 'PREMIUM', p.id, now() - interval '1 hour', now() + interval '7 days', 'ACTIVE', 7, 0 from pay p
      `;
      await page.goto("/elanlar?category=CAR");
      const card = page.locator(`[data-testid="listing-card"][data-public-id="${s.boosted[0]}"]`).first();
      await expect(card).toBeAttached();
      const text = (await card.textContent()) ?? "";
      expect(text).toContain("Premium");
      expect(text).toContain("Boost");
      expect(text).not.toContain("Reklam");
      if (project.name === "desktop") {
        // dual badges are visibly readable where the card is on screen
        await expect(card.getByText("Premium")).toBeVisible();
        await expect(card.getByText("Boost")).toBeVisible();
      }
    } finally {
      await sql`delete from listing_promotions where payment_id in (select id from payments where idempotency_key like 'o6pb:%')`;
      await sql`delete from payments where idempotency_key like 'o6pb:%'`;
      await sql.end();
    }
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
    await page.waitForLoadState("networkidle");
    const restored = new URL(page.url());
    expect(restored.pathname).toBe("/elanlar");
    expect(restored.searchParams.get("category")).toBe("CAR");
    expect(restored.searchParams.get("brand_id")).toBe(s.toyotaBrandId);
    expect(restored.searchParams.get("sort")).toBe("PRICE_DESC");
    await expect(page.getByTestId("organic-card").first()).toBeVisible();
    // ...and the unified controls carry the restored state too
    await expect(page.getByTestId("home-brand")).toHaveValue(s.toyotaBrandId);
    await expect(page.getByTestId("sort-select")).toContainText("Qiymət: azalan");
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
