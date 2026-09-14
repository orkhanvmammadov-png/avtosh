import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import { consumeFreePublications, getListingIntents, insertListingFixture } from "./seller-helpers";

/**
 * O.9 Stage F — promotion INTENT lifecycle through the real UI/APIs.
 * Selecting a promotion during creation writes only the two listing
 * preference fields; payment can exist only through the untouched
 * post-ACTIVE checkout. Desktop-only single-source scenarios: the
 * tests create their own ACTIVE promotion packages (deterministic
 * fixtures, cleaned up in finally — never production seeds).
 */

async function openSection(page: Page, key: string) {
  const section = page.getByTestId(`axin-section-${key}`);
  if ((await section.getAttribute("data-state")) !== "open") {
    await section.click();
  }
  await expect(section).toHaveAttribute("data-state", "open");
}

interface PackageFixture {
  premium3: string;
  premium1: string;
  boost1: string;
  cleanup: () => Promise<void>;
}

/** Resolves the E2E-seeded ACTIVE packages (the seed activates the
    standard 1/3/7-day matrix); cleanup removes only this suite's
    payments/intent references — packages are shared seed state. */
async function withPackages(sql: postgres.Sql): Promise<PackageFixture> {
  const pick = async (type: string, days: number): Promise<string> =>
    (await sql`select id from promotion_packages
      where type = ${type}::promotion_type and duration_days = ${days} and is_active limit 1`)[0]
      .id as string;
  const premium3 = await pick("PREMIUM", 3);
  const premium1 = await pick("PREMIUM", 1);
  const boost1 = await pick("BOOST", 1);
  return {
    premium3,
    premium1,
    boost1,
    cleanup: async () => {
      await sql`delete from payments where idempotency_key like 'o9f:%'`;
    },
  };
}

test("review promotion intent: select, dual, persist, clear, skip — zero payment activity", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "single-source scenario; one project");
  test.setTimeout(120_000);
  const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  const packages = await withPackages(sql);
  try {
    const { userId } = await loginAs(context, testPhone("desktop", 46));
    const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
    await page.goto(`/elan-yerlesdir/${fixture.id}`);
    await openSection(page, "review");

    // module renders live packages, nothing preselected
    const premiumCard = page.getByTestId("promo-intent-PREMIUM");
    const boostCard = page.getByTestId("promo-intent-BOOST");
    await expect(premiumCard).toHaveAttribute("data-selected", "false");
    await expect(boostCard).toHaveAttribute("data-selected", "false");
    await expect(page.getByTestId("promo-pre-active-note")).toHaveCount(0);

    // select Premium 3 gün → intent saved; PRE-ACTIVE wording appears
    await page.getByTestId("promo-intent-PREMIUM-3").click();
    await expect(premiumCard).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("promo-pre-active-note")).toContainText("aktiv olduqdan sonra");
    await expect
      .poll(async () => (await getListingIntents(fixture.id)).premium)
      .toBe(packages.premium3);

    // dual selection — independent products, no combined total anywhere
    await page.getByTestId("promo-intent-BOOST-1").click();
    await expect(boostCard).toHaveAttribute("data-selected", "true");
    await expect.poll(async () => (await getListingIntents(fixture.id)).boost).toBe(packages.boost1);
    await expect(page.getByTestId("promo-intent")).not.toContainText("Cəmi"); // no total line

    // selection wrote ONLY preference fields — zero payment rows
    expect((await getListingIntents(fixture.id)).paymentTypes).toEqual([]);

    // persists across reload
    await page.reload();
    await openSection(page, "review");
    await expect(page.getByTestId("promo-intent-PREMIUM")).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("promo-intent-BOOST")).toHaveAttribute("data-selected", "true");

    // toggling the selected chip clears that type only
    await page.getByTestId("promo-intent-PREMIUM-3").click();
    await expect.poll(async () => (await getListingIntents(fixture.id)).premium).toBeNull();
    expect((await getListingIntents(fixture.id)).boost).toBe(packages.boost1);

    // neutral path: Təşviqsiz davam et clears intent and submits FREE
    await page.getByTestId("wizard-submit-skip-promo").click();
    await expect(page.getByTestId("wizard-result")).toHaveAttribute("data-outcome", "MODERATION", { timeout: 20_000 });
    const after = await getListingIntents(fixture.id);
    expect(after.premium).toBeNull();
    expect(after.boost).toBeNull();
    expect(after.paymentTypes).toEqual([]); // FREE + no promo payment
  } finally {
    await packages.cleanup();
    await sql.end();
  }
});

test("paid listing fee with promotion intent stays a single separate LISTING_FEE payment", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "single-source scenario; one project");
  const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  const packages = await withPackages(sql);
  try {
    const { userId } = await loginAs(context, testPhone("desktop", 47));
    await consumeFreePublications(userId, 3);
    const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
    await page.goto(`/elan-yerlesdir/${fixture.id}`);
    await openSection(page, "review");
    await page.getByTestId("promo-intent-PREMIUM-3").click();
    await expect.poll(async () => (await getListingIntents(fixture.id)).premium).toBe(packages.premium3);
    await page.getByTestId("wizard-submit").click();
    await expect(page.getByTestId("wizard-result")).toHaveAttribute("data-outcome", "PAYMENT", { timeout: 20_000 });
    // exactly ONE payment intent — the 2 AZN LISTING_FEE; the promo
    // preference created nothing and nothing is combined
    const state = await getListingIntents(fixture.id);
    expect(state.paymentTypes).toEqual(["LISTING_FEE"]);
    expect(state.premium).toBe(packages.premium3); // intent survives submission
  } finally {
    await packages.cleanup();
    await sql.end();
  }
});

test("promotion module shows the honest unavailable state when no packages are active", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "single-source scenario; one project");
  const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  try {
    const { userId } = await loginAs(context, testPhone("desktop", 48));
    const fixture = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
    // temporarily deactivate every package (restored in finally) — the
    // module must degrade honestly, never showing demo cards
    await sql`update promotion_packages set is_active = false where is_active`;
    try {
      await page.goto(`/elan-yerlesdir/${fixture.id}`);
      await openSection(page, "review");
      await expect(page.getByTestId("promo-intent-unavailable")).toBeVisible();
      await expect(page.getByTestId("promo-intent")).toHaveCount(0);
    } finally {
      await sql`update promotion_packages set is_active = true`;
    }
  } finally {
    await sql.end();
  }
});

test("post-ACTIVE handoff: continuation CTA, preselection, per-type satisfaction, FAILED stays pending", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "single-source scenario; one project");
  test.setTimeout(120_000);
  const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  const packages = await withPackages(sql);
  try {
    const { userId } = await loginAs(context, testPhone("desktop", 49));
    const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
    // creation-time dual intent, persisted (as the wizard would)
    await sql`update listings set premium_intent_package_id = ${packages.premium3},
      boost_intent_package_id = ${packages.boost1} where id = ${listing.id}`;

    // 1) pending intent + active package → continuation CTA
    await page.goto("/profil/elanlar");
    const promote = page
      .locator(`[data-testid="owner-listing-card"]`, { has: page.locator(`[href*="${listing.id}"]`) })
      .getByTestId("owner-promote");
    await expect(promote).toHaveAttribute("data-intent", "pending");
    await expect(promote).toHaveText("Seçdiyiniz təşviqə davam et");

    // 2) continuation preselects type+package; checkout stays manual
    await promote.click();
    await expect(page.getByTestId("promotion-purchase")).toBeVisible();
    await expect(page.getByTestId("promo-type-PREMIUM")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("promo-package-3")).toBeChecked();
    await expect(page.getByTestId("promo-price")).toHaveText("7 AZN"); // server price, no auto-launch

    // 3) FAILED payment leaves the intent pending
    await sql`
      insert into payments (user_id, listing_id, type, amount_minor, currency, status, provider,
                            fulfillment_status, idempotency_key, promotion_package_id)
      values (${userId}, ${listing.id}, 'PREMIUM', 700, 'AZN', 'FAILED', 'KAPITAL',
              'PENDING', ${"o9f:failed:" + listing.id}, ${packages.premium3})
    `;
    await page.goto("/profil/elanlar");
    await expect(promote).toHaveAttribute("data-intent", "pending");

    // 4) SUCCESS of the SAME TYPE with a DIFFERENT package satisfies
    //    Premium; Boost intent remains pending → CTA continues (Boost)
    await sql`
      insert into payments (user_id, listing_id, type, amount_minor, currency, status, provider,
                            fulfillment_status, idempotency_key, promotion_package_id)
      values (${userId}, ${listing.id}, 'PREMIUM', 300, 'AZN', 'SUCCESS', 'KAPITAL',
              'FULFILLED', ${"o9f:success:" + listing.id}, ${packages.premium1})
    `;
    await page.goto("/profil/elanlar");
    await expect(promote).toHaveAttribute("data-intent", "pending"); // Boost still pending
    await promote.click();
    await expect(page.getByTestId("promo-type-BOOST")).toHaveAttribute("aria-selected", "true"); // preselect moved to Boost
    await expect(page.getByTestId("promo-package-1")).toBeChecked();

    // 5) deactivating the intended Boost package → normal CTA, no preselect
    await sql`update promotion_packages set is_active = false where id = ${packages.boost1}`;
    try {
      await page.goto("/profil/elanlar");
      await expect(promote).toHaveAttribute("data-intent", "none");
      await expect(promote).toHaveText("İrəli çək");
    } finally {
      await sql`update promotion_packages set is_active = true where id = ${packages.boost1}`;
    }

    // 6) Boost SUCCESS too → BOTH creation-time intents satisfied; the
    //    continuation CTA is gone for good (normal promote remains)
    await sql`
      insert into payments (user_id, listing_id, type, amount_minor, currency, status, provider,
                            fulfillment_status, idempotency_key, promotion_package_id)
      values (${userId}, ${listing.id}, 'BOOST', 200, 'AZN', 'SUCCESS', 'KAPITAL',
              'FULFILLED', ${"o9f:boost-success:" + listing.id}, ${packages.boost1})
    `;
    await page.goto("/profil/elanlar");
    await expect(promote).toHaveAttribute("data-intent", "none");
    await expect(promote).toHaveText("İrəli çək");
  } finally {
    await packages.cleanup();
    await sql.end();
  }
});
