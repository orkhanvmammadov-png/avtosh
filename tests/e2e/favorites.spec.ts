import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";

/** Buyer favorites: anonymous intent round trip, toggling, saved page. */

test("anonymous heart routes into login preserving the favorite intent", async ({ page }, { project }) => {
  const s = seed();
  await page.goto(`/elan/${s.activeCar}`);
  await page.locator('[data-testid="favorite-button"]:visible').first().click();
  await expect(page).toHaveURL(
    new RegExp(`/giris\\?return_to=%2Felan%2F${s.activeCar}%3Ffav%3D1$`),
  );
  // completing login lands back on the listing with fav=1 → auto-favorited
  const phone = testPhone(project.name, 20);
  await loginAs(page.context(), phone);
  await page.goto(`/elan/${s.activeCar}?fav=1`);
  const heart = page.locator('[data-testid="favorite-button"]:visible').first();
  await expect(heart).toHaveAttribute("data-favorited", "true");
  // intent param is cleaned from the URL after the auto-add
  await expect(page).toHaveURL(new RegExp(`/elan/${s.activeCar}$`));
});

test("authenticated toggle on detail persists across reloads", async ({ page, context }, { project }) => {
  const s = seed();
  await loginAs(context, testPhone(project.name, 21));
  await page.goto(`/elan/${s.activeCar}`);
  const heart = page.locator('[data-testid="favorite-button"]:visible').first();
  await expect(heart).toHaveAttribute("data-favorited", "false");
  await heart.click();
  await expect(heart).toHaveAttribute("data-favorited", "true");
  await page.reload();
  await expect(page.locator('[data-testid="favorite-button"]:visible').first()).toHaveAttribute("data-favorited", "true");
  await page.locator('[data-testid="favorite-button"]:visible').first().click();
  await expect(page.locator('[data-testid="favorite-button"]:visible').first()).toHaveAttribute("data-favorited", "false");
});

test("card heart favorites without navigating away", async ({ page, context }, { project }) => {
  await loginAs(context, testPhone(project.name, 22));
  await page.goto("/elanlar?category=CAR");
  const card = page.locator('[data-testid="listing-card"]:visible').first();
  const publicId = await card.getAttribute("data-public-id");
  const heart = card.locator('[data-testid="favorite-button"]');
  await heart.click();
  await expect(heart).toHaveAttribute("data-favorited", "true");
  await expect(page).toHaveURL(/\/elanlar\?category=CAR$/); // no navigation
  await page.goto("/profil/secilmisler");
  await expect(page.locator(`[data-testid="favorite-card"][data-public-id="${publicId}"]`)).toBeVisible();
});

test("saved listings page: empty state, content, and removal", async ({ page, context }, { project }) => {
  const s = seed();
  await loginAs(context, testPhone(project.name, 23));
  await page.goto("/profil/secilmisler");
  await expect(page.getByTestId("favorites-empty")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto(`/elan/${s.activeCar}`);
  await page.locator('[data-testid="favorite-button"]:visible').first().click();
  await expect(page.locator('[data-testid="favorite-button"]:visible').first()).toHaveAttribute("data-favorited", "true");

  await page.goto("/profil/secilmisler");
  const card = page.locator(`[data-testid="favorite-card"][data-public-id="${s.activeCar}"]`);
  await expect(card).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await card.locator('[data-testid="favorite-button"]').click();
  await expect(card.locator('[data-testid="favorite-button"]')).toHaveAttribute("data-favorited", "false");
  await page.reload();
  await expect(page.getByTestId("favorites-empty")).toBeVisible();
});
