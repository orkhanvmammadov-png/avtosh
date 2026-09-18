import { expect, test } from "@playwright/test";
import { loginAs, testPhone } from "./auth-helpers";
import {
  insertEditRevisionFixture,
  insertListingFixture,
  setListingSellerLifecycle,
} from "./seller-helpers";

/**
 * O.12 Stage B — seller lifecycle management: deactivate confirm
 * dialog, public-visibility round trip, reactivation routing while an
 * edit is in moderation, Deaktiv filter, and the §36 guarantee that no
 * card links into the not-yet-implemented O.12 edit route.
 */

test("deactivate → hidden from public → reactivate restores everything", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 74));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 1 });

  await page.goto("/profil/elanlar");
  const card = page.locator(`[data-testid="owner-listing-card"][data-listing-id="${listing.id}"]`);
  await expect(card.getByTestId("owner-status")).toHaveText("Aktiv");

  // dialog semantics: labelled modal, focus moves in, Esc returns it
  await card.getByTestId("owner-deactivate").click();
  const dialog = page.getByTestId("deactivate-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("aria-labelledby", /deactivate-title-/);
  await expect(dialog).toContainText("Elanı deaktiv etmək istəyirsiniz?");
  await expect(dialog).toContainText("Elan platformada görünməyəcək.");
  await expect(dialog).toContainText("30 günlük müddət dayanmayacaq.");
  await expect
    .poll(async () => dialog.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(card.getByTestId("owner-deactivate")).toBeFocused();

  // cancel path leaves the listing untouched
  await card.getByTestId("owner-deactivate").click();
  await dialog.getByTestId("deactivate-cancel").click();
  await expect(dialog).not.toBeVisible();
  await expect(card.getByTestId("owner-status")).toHaveText("Aktiv");

  // confirm path
  await card.getByTestId("owner-deactivate").click();
  await page.getByTestId("deactivate-confirm").click();
  await expect(card.getByTestId("owner-lifecycle-feedback")).toContainText("Elan deaktiv edildi");
  await expect(card.getByTestId("owner-status")).toHaveText("Deaktiv");
  await expect(card.getByTestId("owner-deactivated-meta")).toHaveText("Platformada görünmür · müddət davam edir");
  await expect(card.getByTestId("owner-deactivate")).toHaveCount(0);

  // fresh public read is a generic 404 — no oracle about deactivation
  const hidden = await page.goto(`/elan/${listing.publicId}`);
  expect(hidden?.status()).toBe(404);
  await expect(page.getByText("Elan tapılmadı")).toBeVisible();

  // reactivate directly (no open edit) → live again
  await page.goto("/profil/elanlar");
  await card.getByTestId("owner-reactivate").click();
  await expect(card.getByTestId("owner-lifecycle-feedback")).toContainText("Elan aktivləşdirildi");
  await expect(card.getByTestId("owner-status")).toHaveText("Aktiv");
  const restored = await page.goto(`/elan/${listing.publicId}`);
  expect(restored?.status()).toBe(200);
});

test("Aktiv et while an edit is in moderation records intent and shows the awaiting line", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 75));
  const listing = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 1 });
  await insertEditRevisionFixture(listing.id, "PENDING_MODERATION");
  await setListingSellerLifecycle(listing.id, { deactivated: true });

  await page.goto("/profil/elanlar");
  const card = page.locator(`[data-testid="owner-listing-card"][data-listing-id="${listing.id}"]`);
  await expect(card.getByTestId("owner-status")).toHaveText("Deaktiv");
  await expect(card.getByTestId("owner-edit-chip")).toHaveText("Dəyişiklik moderasiyadadır");

  await card.getByTestId("owner-reactivate").click();
  // outcome AWAITING_MODERATION: the refreshed server DTO replaces the
  // button with the approved line — never a live-looking Aktiv et
  await expect(card.getByTestId("owner-awaiting-activation")).toHaveText("Moderasiya sonrası aktivləşəcək");
  await expect(card.getByTestId("owner-reactivate")).toHaveCount(0);

  // the recorded intent survives a full reload (server state, not UI)
  await page.reload();
  await expect(card.getByTestId("owner-awaiting-activation")).toHaveText("Moderasiya sonrası aktivləşəcək");
  await expect(card.getByTestId("owner-reactivate")).toHaveCount(0);
  await expect(card.getByTestId("owner-status")).toHaveText("Deaktiv");
});

test("Deaktiv filter, edit chips, and no navigation into the unimplemented edit route", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 76));
  const active = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 1 });
  await insertEditRevisionFixture(active.id, "EDIT_DRAFT");
  const deactivated = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 1 });
  await insertEditRevisionFixture(deactivated.id, "EDIT_DRAFT");
  await setListingSellerLifecycle(deactivated.id, { deactivated: true });
  const expiredDeactivated = await insertListingFixture(userId, { status: "EXPIRED", complete: true, images: 1 });
  await setListingSellerLifecycle(expiredDeactivated.id, { deactivated: true });

  await page.goto("/profil/elanlar");
  const cardFor = (id: string) => page.locator(`[data-testid="owner-listing-card"][data-listing-id="${id}"]`);

  // secondary chips per state: saved edit vs deactivated-with-draft
  await expect(cardFor(active.id).getByTestId("owner-edit-chip")).toHaveText("Redaktə saxlanılıb");
  await expect(cardFor(deactivated.id).getByTestId("owner-edit-chip")).toHaveText("Redaktə tamamlanmayıb");
  // expired + deactivated presents as EXPIRED (renewal path wins)
  await expect(cardFor(expiredDeactivated.id).getByTestId("owner-status")).toHaveText("Müddəti bitib");

  // §36: Stage B ships ZERO navigation into the O.12 edit flow — no
  // href to the edit route and none of the Stage C entry labels
  const list = page.getByTestId("my-listings-list");
  expect(await list.locator('a[href*="/redakte"]').count()).toBe(0);
  await expect(list).not.toContainText("Redaktəyə davam et");
  await expect(list).not.toContainText("Redaktəyə bax");
  // deactivated card keeps its lifecycle button but no public link
  expect(await cardFor(deactivated.id).locator('a[href^="/elan/"]').count()).toBe(0);

  // Deaktiv filter: exactly the deactivated set, incl. expired ones
  await page.getByTestId("filter-deactivated").click();
  await expect(page.locator('[data-testid="owner-listing-card"]')).toHaveCount(2);
  await expect(cardFor(deactivated.id)).toBeVisible();
  await expect(cardFor(expiredDeactivated.id)).toBeVisible();

  // Aktiv filter excludes deactivated listings entirely
  await page.getByTestId("filter-active").click();
  await expect(page.locator('[data-testid="owner-listing-card"]')).toHaveCount(1);
  await expect(cardFor(active.id)).toBeVisible();
});
