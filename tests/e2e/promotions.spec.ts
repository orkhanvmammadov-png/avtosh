import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loginAs, testPhone } from "./auth-helpers";
import {
  expireListingPromotions,
  insertListingFixture,
  promotionEnds,
  promotionPeriodCount,
  setPromotionPackagesActive,
} from "./seller-helpers";

/**
 * Premium/Boost purchases through the real APIs and the fake Kapital
 * HPP. Activation authority is always the server-side verification —
 * the browser callback can never activate a promotion.
 */

const fakeOrderFile = (orderId: string) =>
  path.join(process.cwd(), ".dev-storage", "kapital", `${orderId}.json`);

async function activeListingFixture(page: Page, project: string, slot: number) {
  const { userId } = await loginAs(page.context(), testPhone(project, slot));
  const fixture = await insertListingFixture(userId, {
    status: "ACTIVE",
    complete: true,
    images: 3,
  });
  return { userId, fixture };
}

async function startPromotionCheckout(
  page: Page,
  listingId: string,
  type: "PREMIUM" | "BOOST",
  days: 1 | 3 | 7,
) {
  await page.goto(`/profil/elanlar/${listingId}/tesviq`);
  await expect(page.getByTestId("promotion-purchase")).toBeVisible();
  await page.getByTestId(`promo-type-${type}`).click();
  await page.getByTestId(`promo-package-${days}`).check();
  await expect(page.getByTestId("promo-confirmation")).toBeVisible();
  await page.getByTestId("promo-pay").click();
  await page.waitForURL(/\/api\/dev-kapital\/hpp\?/);
}

test("Premium purchase: packages → confirm → HPP → verified activation everywhere", async ({ page }, { project }) => {
  const { fixture } = await activeListingFixture(page, project.name, 90);
  // entry from My Listings
  await page.goto("/profil/elanlar");
  const card = page.locator(`[data-testid="owner-listing-card"][data-status="ACTIVE"]`).first();
  await expect(card.getByTestId("owner-promote")).toBeVisible();
  await card.getByTestId("owner-promote").click();
  await expect(page.getByTestId("promotion-purchase")).toBeVisible();
  // server-loaded package price appears in the confirmation
  await page.getByTestId("promo-package-3").check();
  await expect(page.getByTestId("promo-price")).toHaveText("7 AZN");
  await page.getByTestId("promo-pay").click();
  await page.waitForURL(/\/api\/dev-kapital\/hpp\?/);
  await expect(page.getByTestId("fake-hpp-amount")).toHaveText("7.00 AZN");
  await page.getByTestId("fake-hpp-pay").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  const result = page.getByTestId("payment-result");
  await expect(result).toHaveAttribute("data-state", "SUCCESS");
  await expect(result).toContainText("Premium aktiv edildi");
  await expect(result).toContainText("tarixinədək");
  expect(await promotionEnds(fixture.id, "PREMIUM")).not.toBeNull();
  // owner status line
  await page.getByTestId("payment-my-listings").click();
  await expect(page.getByTestId("owner-premium-until").first()).toContainText("Premium aktivdir");
  // public regression: the listing joins the Home premium feed
  await page.goto("/");
  await expect(
    page.locator(`[data-testid="premium-section"] [data-public-id="${fixture.publicId}"]`).first(),
  ).toBeVisible();
  await expireListingPromotions(fixture.id); // keep shared public specs seed-only
});

test("Boost purchase activates and shows the public badge; both types coexist", async ({ page }, { project }) => {
  const { fixture } = await activeListingFixture(page, project.name, 91);
  await startPromotionCheckout(page, fixture.id, "BOOST", 3);
  await page.getByTestId("fake-hpp-pay").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  await expect(page.getByTestId("payment-result")).toContainText("Boost aktiv edildi");
  expect(await promotionEnds(fixture.id, "BOOST")).not.toBeNull();
  // second type on the same listing
  await startPromotionCheckout(page, fixture.id, "PREMIUM", 1);
  await page.getByTestId("fake-hpp-pay").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  await expect(page.getByTestId("payment-result")).toContainText("Premium aktiv edildi");
  expect(await promotionEnds(fixture.id, "PREMIUM")).not.toBeNull();
  expect(await promotionEnds(fixture.id, "BOOST")).not.toBeNull(); // still active
  await page.goto("/profil/elanlar");
  await expect(page.getByTestId("owner-premium-until").first()).toBeVisible();
  await expect(page.getByTestId("owner-boost-until").first()).toBeVisible();
  // public detail carries both badges
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("listing-detail")).toContainText("Premium");
  await expect(page.getByTestId("listing-detail")).toContainText("Reklam");
  await expireListingPromotions(fixture.id);
});

test("a pending callback never activates a promotion", async ({ page }, { project }) => {
  const { fixture } = await activeListingFixture(page, project.name, 92);
  await startPromotionCheckout(page, fixture.id, "PREMIUM", 3);
  // do NOT pay — forge the return with a lying STATUS
  const orderId = new URL(page.url()).searchParams.get("id")!;
  await page.goto(`/odenis/kapital/netice?ID=${orderId}&STATUS=FullyPaid`);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "PENDING");
  expect(await promotionEnds(fixture.id, "PREMIUM")).toBeNull();
  expect(await promotionPeriodCount(fixture.id)).toBe(0);
});

test("a FullyPaid order with a wrong amount never activates", async ({ page }, { project }) => {
  const { fixture } = await activeListingFixture(page, project.name, 93);
  await startPromotionCheckout(page, fixture.id, "BOOST", 3);
  const orderId = new URL(page.url()).searchParams.get("id")!;
  const file = fakeOrderFile(orderId);
  const order = JSON.parse(readFileSync(file, "utf8")) as { status: string; amount: string };
  order.status = "FullyPaid";
  order.amount = "99.00";
  writeFileSync(file, JSON.stringify(order));
  await page.goto(`/odenis/kapital/netice?ID=${orderId}&STATUS=FullyPaid`);
  // amount mismatch: safe held state, never an activation
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "MISMATCH");
  await expect(page.getByTestId("payment-result")).toContainText("Ödəniş hələ təsdiqlənməyib");
  expect(await promotionPeriodCount(fixture.id)).toBe(0);
});

test("repeated callbacks add the purchased duration exactly once", async ({ page }, { project }) => {
  const { fixture } = await activeListingFixture(page, project.name, 94);
  await startPromotionCheckout(page, fixture.id, "PREMIUM", 3);
  await page.getByTestId("fake-hpp-pay").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
  const endsAfterFirst = await promotionEnds(fixture.id, "PREMIUM");
  for (let i = 0; i < 5; i += 1) {
    await page.reload();
    await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
  }
  expect(await promotionEnds(fixture.id, "PREMIUM")).toBe(endsAfterFirst); // 3 days, not 18
  expect(await promotionPeriodCount(fixture.id)).toBe(1);
  await expireListingPromotions(fixture.id);
});

test("a second purchase extends from the current end — paid time is never lost", async ({ page }, { project }) => {
  const { fixture } = await activeListingFixture(page, project.name, 95);
  await startPromotionCheckout(page, fixture.id, "PREMIUM", 3);
  await page.getByTestId("fake-hpp-pay").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
  const firstEnd = new Date((await promotionEnds(fixture.id, "PREMIUM"))!);
  await startPromotionCheckout(page, fixture.id, "PREMIUM", 3);
  await page.getByTestId("fake-hpp-pay").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
  const secondEnd = new Date((await promotionEnds(fixture.id, "PREMIUM"))!);
  expect(secondEnd.getTime() - firstEnd.getTime()).toBe(3 * 86_400_000);
  expect(await promotionPeriodCount(fixture.id)).toBe(2);
  await expireListingPromotions(fixture.id);
});

test("promotion purchase is refused for non-active listings", async ({ page }, { project }) => {
  const { userId } = await loginAs(page.context(), testPhone(project.name, 96));
  const pending = await insertListingFixture(userId, {
    status: "PENDING_MODERATION",
    complete: true,
    images: 3,
  });
  await page.goto(`/profil/elanlar/${pending.id}/tesviq`);
  await expect(page.getByTestId("promotion-unavailable")).toBeVisible();
});

test("with no active packages the purchase page shows a safe unavailable state", async ({ page }, { project }) => {
  const { fixture } = await activeListingFixture(page, project.name, 97);
  try {
    await setPromotionPackagesActive(false); // the production default
    await page.goto(`/profil/elanlar/${fixture.id}/tesviq`);
    const unavailable = page.getByTestId("promotion-packages-unavailable");
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toContainText("Təşviq paketləri hazırda əlçatan deyil.");
    // no prices, no purchase form, no checkout path
    await expect(page.getByTestId("promo-pay")).toHaveCount(0);
    await expect(page.getByTestId("promotion-purchase")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("AZN");
  } finally {
    await setPromotionPackagesActive(true); // restore the E2E fixture state
  }
});
