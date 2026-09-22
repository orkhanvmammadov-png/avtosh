import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import {
  addListingFeatures,
  expireModerationClaim,
  insertListingFixture,
} from "./seller-helpers";

/**
 * O.13 Stage B — moderator adjustment foundation end to end: explicit
 * edit mode, private save/reload/continue, discard with confirmation,
 * deterministic claim takeover with preserved authorship, unsaved
 * protection, and the Stage B decision lock. Every scenario asserts
 * that seller artifacts and public content never move.
 */

async function loginAsStub(project: string, slot: number): Promise<{ userId: string }> {
  const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  try {
    const [user] = await sql`
      insert into users (phone_e164, phone_verified_at, last_login_at)
      values (${testPhone(project, slot)}, now(), now())
      on conflict (phone_e164) do update set last_login_at = now()
      returning id
    `;
    await sql`
      insert into user_roles (user_id, role_id)
      select ${user.id}, id from roles where code = 'USER'
      on conflict do nothing
    `;
    return { userId: user.id as string };
  } finally {
    await sql.end();
  }
}

async function listingSnapshot(listingId: string): Promise<{
  status: string;
  price: string;
  features: number;
  images: number;
  revisionData: Record<string, unknown> | null;
}> {
  const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  try {
    const [row] = await sql`
      select status, price_minor::text as price from listings where id = ${listingId}
    `;
    const [{ n: features }] = await sql`
      select count(*)::int as n from listing_features where listing_id = ${listingId}
    `;
    const [{ n: images }] = await sql`
      select count(*)::int as n from listing_images where listing_id = ${listingId}
    `;
    const revisions = await sql`
      select data from listing_edit_revisions
      where listing_id = ${listingId} and status = 'PENDING_MODERATION'
    `;
    return {
      status: row.status as string,
      price: row.price as string,
      features: Number(features),
      images: Number(images),
      revisionData: (revisions[0]?.data as Record<string, unknown> | undefined) ?? null,
    };
  } finally {
    await sql.end();
  }
}

async function claimOnDetail(page: Page, listingId: string) {
  await page.goto(`/moderator/elanlar/${listingId}`);
  await page.getByTestId("claim-button").click();
  await page.waitForLoadState("load");
  await expect(page.getByTestId("claim-state")).toHaveAttribute("data-claim", "mine");
}

test("NEW: claim → edit → save → reload survives; seller submission untouched; decisions locked (O.13.5B)", async ({ page }, { project }) => {
  const { userId } = await loginAsStub(project.name, 180);
  const fixture = await insertListingFixture(userId, {
    status: "PENDING_MODERATION", complete: true, images: 4,
  });
  await addListingFeatures(fixture.id, ["ABS"]);
  await loginAs(page.context(), testPhone(project.name, 181), { roles: ["MODERATOR"] });
  await claimOnDetail(page, fixture.id);

  // explicit entry — the default screen is review, never a form
  await expect(page.getByTestId("adjustment-editor")).toHaveCount(0);
  await page.getByTestId("adjustment-edit").click();
  await expect(page.getByTestId("edit-context-strip")).toContainText("dərc olunmur");

  // content edit + equipment add (marker before save) — no upload control anywhere
  await page.getByTestId("adj-price").fill("23500");
  const safety = page.getByTestId("equipment-options-SAFETY");
  await expect(safety.locator("input").first()).toBeVisible();
  const unchecked = safety.locator("input:not(:checked)").first();
  const addedId = (await unchecked.getAttribute("data-testid"))!.replace("mod-feature-", "");
  await unchecked.check();
  await expect(page.getByTestId(`mod-feature-marker-${addedId}`)).toHaveText("əlavə edildi");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  // photo plan: remove last (reversible), set a new primary, min guard
  const items = page.getByTestId("photo-plan-item");
  await expect(items).toHaveCount(4);
  await items.nth(3).getByTestId("photo-remove").click();
  await expect(items.nth(3)).toHaveAttribute("data-removed", "true");
  await items.nth(2).getByTestId("photo-remove").click();
  await expect(page.getByTestId("photo-min-error")).toContainText("Ən azı 3 şəkil");
  await expect(page.getByTestId("adjustment-save")).toBeDisabled();
  await items.nth(2).getByTestId("photo-restore").click();
  await expect(page.getByTestId("photo-min-error")).toHaveCount(0);
  await items.nth(1).getByTestId("photo-set-primary").click();
  await expect(items.nth(1)).toHaveAttribute("data-primary", "true");

  // Yadda saxla → server truth re-rendered
  await page.getByTestId("adjustment-save").click();
  await expect(page.getByTestId("adjustment-chip")).toHaveText("Moderator düzəlişi saxlanılıb");
  await expect(page.getByTestId("adjustment-attribution")).toContainText("Saxlayan moderator");
  await expect(page.getByTestId("adjustment-change-price")).toContainText("25 000 AZN");
  await expect(page.getByTestId("adjustment-change-price")).toContainText("23 500 AZN");
  await expect(page.getByTestId("adjustment-equipment-added")).toBeVisible();
  await expect(page.getByTestId("adjustment-photo-summary")).toContainText("Silindi — 1");
  await expect(page.getByTestId("adjustment-photo-summary")).toContainText("Yeni əsas şəkil");
  await expect(page.getByTestId("adjustment-history")).toContainText("Moderator düzəlişi saxladı");

  // Stage B decision lock (server refuses too — UI is honest about it)
  await expect(page.getByTestId("decisions-locked")).toBeVisible();
  await expect(page.getByTestId("action-approve")).toBeDisabled();

  // reload → saved adjustment survives; continue prefills the working copy
  await page.reload();
  await expect(page.getByTestId("adjustment-chip")).toBeVisible();
  await page.getByTestId("adjustment-edit").click();
  await expect(page.getByTestId("adj-price")).toHaveValue("23500");

  // unsaved protection: local changes never exit silently
  await page.getByTestId("adj-price").fill("24000");
  await page.getByTestId("adjustment-cancel").click();
  await expect(page.getByTestId("unsaved-dialog")).toContainText("Saxlanmamış dəyişikliklər var");
  await page.getByTestId("unsaved-back").click();
  await expect(page.getByTestId("adjustment-editor")).toBeVisible();
  await page.getByTestId("adjustment-cancel").click();
  await page.getByTestId("unsaved-discard").click();
  await expect(page.getByTestId("adjustment-chip")).toBeVisible();

  // seller submission is untouched evidence
  const snapshot = await listingSnapshot(fixture.id);
  expect(snapshot.status).toBe("PENDING_MODERATION");
  expect(snapshot.price).toBe("2500000");
  expect(snapshot.features).toBe(1);
  expect(snapshot.images).toBe(4);
});

test("LISTING_EDIT: moderator save leaves the seller proposal and the public listing unchanged (O.13.5B)", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 182));
  const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  // real seller edit journey → PENDING revision at 26 500 AZN
  await page.goto("/profil/elanlar");
  await page
    .locator(`[data-testid="owner-listing-card"][data-listing-id="${fixture.id}"]`)
    .getByTestId("owner-edit")
    .click();
  await page.waitForURL(/\/redakte$/);
  const sale = page.getByTestId("axin-section-sale");
  if ((await sale.getAttribute("data-state")) !== "open") {
    await sale.click();
  }
  await page.getByTestId("wizard-price").fill("26500");
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
  const review = page.getByTestId("axin-section-review");
  if ((await review.getAttribute("data-state")) !== "open") {
    await review.click();
  }
  await page.getByTestId("wizard-submit").click();
  await expect(page.getByTestId("edit-result")).toHaveAttribute("data-outcome", "SUBMITTED");

  await loginAs(context, testPhone(project.name, 183), { roles: ["MODERATOR"] });
  await claimOnDetail(page, fixture.id);
  await page.getByTestId("adjustment-edit").click();
  await page.getByTestId("adj-price").fill("27000");
  await page.getByTestId("adjustment-save").click();
  await expect(page.getByTestId("adjustment-chip")).toBeVisible();
  await expect(page.getByTestId("adjustment-change-price")).toContainText("26 500 AZN");
  await expect(page.getByTestId("adjustment-change-price")).toContainText("27 000 AZN");
  // O.12 seller diff stays intact beside the moderator layer
  await expect(page.getByTestId("edit-review-diff")).toContainText("26 500 AZN");

  // seller proposal frozen-evidence base is the revision — still 26 500
  const snapshot = await listingSnapshot(fixture.id);
  expect(snapshot.revisionData?.price_minor).toBe(2650000);
  expect(snapshot.price).toBe("2500000");

  // old public content unchanged
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("25 000");
  await expect(page.getByTestId("detail-price")).not.toContainText("27 000");
});

test("takeover: B inherits A's saved adjustment with attribution and discards it after confirmation (O.13.5B)", async ({ page }, { project }) => {
  const { userId } = await loginAsStub(project.name, 184);
  const fixture = await insertListingFixture(userId, {
    status: "PENDING_MODERATION", complete: true, images: 3,
  });
  // moderator A saves a working adjustment
  await loginAs(page.context(), testPhone(project.name, 185), { roles: ["MODERATOR"] });
  await claimOnDetail(page, fixture.id);
  await page.getByTestId("adjustment-edit").click();
  await page.getByTestId("adj-price").fill("23000");
  await page.getByTestId("adjustment-save").click();
  await expect(page.getByTestId("adjustment-chip")).toBeVisible();

  // deterministic expiry (no sleeps) → B claims and inherits
  await expireModerationClaim(fixture.id);
  await loginAs(page.context(), testPhone(project.name, 186), { roles: ["MODERATOR"] });
  await claimOnDetail(page, fixture.id);
  const takeover = page.getByTestId("takeover-card");
  await expect(takeover).toContainText("saxlanılmış moderator düzəlişi var");
  await expect(takeover.getByTestId("takeover-attribution")).toContainText("Saxlayan moderator");
  await expect(page.getByTestId("decisions-locked")).toBeVisible();

  // Davam et opens A's working copy for B
  await takeover.getByTestId("takeover-continue").click();
  await expect(page.getByTestId("adj-price")).toHaveValue("23000");
  await page.getByTestId("adjustment-cancel").click();
  await expect(takeover).toBeVisible();

  // Düzəlişi sil requires confirmation, keeps history, unlocks decisions
  await takeover.getByTestId("takeover-discard").click();
  await expect(page.getByTestId("discard-dialog")).toContainText("geri qaytarıla bilməz");
  await page.getByTestId("discard-confirm").click();
  await expect(page.getByTestId("adjustment-chip")).toHaveCount(0);
  await expect(page.getByTestId("takeover-card")).toHaveCount(0);
  await expect(page.getByTestId("adjustment-history")).toContainText("Moderator düzəlişi sildi");
  await expect(page.getByTestId("decisions-locked")).toHaveCount(0);
  await expect(page.getByTestId("action-approve")).toBeEnabled();

  // the seller submission never moved
  const snapshot = await listingSnapshot(fixture.id);
  expect(snapshot.status).toBe("PENDING_MODERATION");
  expect(snapshot.price).toBe("2500000");
});
