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
  // evidence helper uses the normal AVTOSH grouped formatting
  await expect(page.getByTestId("seller-was-adj-price")).toHaveText("Satıcı: 25 000 AZN");
  await page.getByTestId("adj-description").fill("Moderator tərəfindən düzəldilmiş təsvir");
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
  // changed description renders as real Satıcı → Moderator blocks
  const descriptionDiff = page.getByTestId("adjustment-description-diff");
  await expect(descriptionDiff.getByTestId("adjustment-description-before")).toHaveText("E2E fixture təsviri");
  await expect(descriptionDiff.getByTestId("adjustment-description-after")).toHaveText(
    "Moderator tərəfindən düzəldilmiş təsvir",
  );
  await expect(page.getByTestId("adjustment-equipment-added")).toBeVisible();
  await expect(page.getByTestId("adjustment-photo-summary")).toContainText("Silindi — 1");
  await expect(page.getByTestId("adjustment-photo-summary")).toContainText("Yeni əsas şəkil");
  await expect(page.getByTestId("adjustment-history")).toContainText("Moderator düzəlişi saxladı");

  // O.13.5C: NEW decisions are adjustment-aware and UNLOCKED
  await expect(page.getByTestId("decisions-locked")).toHaveCount(0);
  await expect(page.getByTestId("action-approve")).toBeEnabled();

  // reload → saved adjustment survives; continue prefills the working copy
  await page.reload();
  await expect(page.getByTestId("adjustment-chip")).toBeVisible();
  await page.getByTestId("adjustment-edit").click();
  await expect(page.getByTestId("adj-price")).toHaveValue("23500");

  // unsaved protection: local changes never exit silently — and the
  // dialog satisfies the sealed focus contract (initial focus inside,
  // Tab/Shift+Tab contained, Escape = safe cancel, focus returned)
  await page.getByTestId("adj-price").fill("24000");
  await page.getByTestId("adjustment-cancel").click();
  await expect(page.getByTestId("unsaved-dialog")).toContainText("Saxlanmamış dəyişikliklər var");
  await expect(page.getByTestId("unsaved-back")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("unsaved-discard")).toBeFocused();
  await page.keyboard.press("Tab"); // forward wrap stays inside
  await expect(page.getByTestId("unsaved-back")).toBeFocused();
  await page.keyboard.press("Shift+Tab"); // backward wrap stays inside
  await expect(page.getByTestId("unsaved-discard")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("unsaved-dialog")).toHaveCount(0);
  await expect(page.getByTestId("adjustment-cancel")).toBeFocused(); // trigger regains focus
  await page.getByTestId("adjustment-cancel").click();
  await page.getByTestId("unsaved-back").click();
  await expect(page.getByTestId("adjustment-editor")).toBeVisible();
  await page.getByTestId("adjustment-cancel").click();
  await page.getByTestId("unsaved-discard").click();
  await expect(page.getByTestId("adjustment-chip")).toBeVisible();

  // seller submission is untouched evidence while the adjustment is open
  const snapshot = await listingSnapshot(fixture.id);
  expect(snapshot.status).toBe("PENDING_MODERATION");
  expect(snapshot.price).toBe("2500000");
  expect(snapshot.features).toBe(1);
  expect(snapshot.images).toBe(4);

  // Journey 1 finale (O.13.5C): approve WITH the adjustment — sealed
  // confirmation copy + changed summary, then the adjusted content is
  // the public approved listing
  await page.getByTestId("action-approve").click();
  const note = page.getByTestId("adjusted-decision-note");
  await expect(note).toContainText("Moderator düzəlişləri ilə təsdiqlənəcək");
  await expect(note).toContainText("Qiymət");
  await page.getByTestId("decision-submit").click();
  await expect(page.getByTestId("decision-done")).toContainText("təsdiqləndi");
  const applied = await listingSnapshot(fixture.id);
  expect(applied.status).toBe("ACTIVE");
  expect(applied.price).toBe("2350000");
  expect(applied.images).toBe(3); // removed plan image excluded
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("23 500");
  await expect(page.getByTestId("listing-detail")).toContainText(
    "Moderator tərəfindən düzəldilmiş təsvir",
  );
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
  // O.13.5D: EDIT decisions are adjustment-aware and UNLOCKED
  await expect(page.getByTestId("decisions-locked")).toHaveCount(0);
  await expect(page.getByTestId("action-approve")).toBeEnabled();

  // seller proposal frozen-evidence base is the revision — still 26 500
  const snapshot = await listingSnapshot(fixture.id);
  expect(snapshot.revisionData?.price_minor).toBe(2650000);
  expect(snapshot.price).toBe("2500000");

  // §20: old public content unchanged UNTIL approval
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("25 000");
  await expect(page.getByTestId("detail-price")).not.toContainText("27 000");

  // Journey 1 finale (O.13.5D): adjusted approval → moderator content
  // is the public approved listing; seller proposal never leaks
  await page.goto(`/moderator/elanlar/${fixture.id}`);
  await page.getByTestId("action-approve").click();
  await expect(page.getByTestId("adjusted-decision-note")).toContainText(
    "Moderator düzəlişləri ilə təsdiqlənəcək",
  );
  await page.getByTestId("decision-submit").click();
  await expect(page.getByTestId("decision-done")).toContainText("Dəyişikliklər təsdiqləndi.");
  const applied = await listingSnapshot(fixture.id);
  expect(applied.status).toBe("ACTIVE");
  expect(applied.price).toBe("2700000");
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("27 000");
  await expect(page.getByTestId("detail-price")).not.toContainText("26 500");
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

  // Davam et opens A's working copy for B
  await takeover.getByTestId("takeover-continue").click();
  await expect(page.getByTestId("adj-price")).toHaveValue("23000");
  await page.getByTestId("adjustment-cancel").click();
  await expect(takeover).toBeVisible();

  // Düzəlişi sil requires confirmation; the dialog contains focus and
  // Escape safely cancels back to the trigger
  await takeover.getByTestId("takeover-discard").click();
  await expect(page.getByTestId("discard-dialog")).toContainText("geri qaytarıla bilməz");
  await expect(page.getByTestId("discard-cancel")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("discard-dialog")).toHaveCount(0);
  await expect(takeover.getByTestId("takeover-discard")).toBeFocused();
  // confirmed discard keeps history and unlocks decisions
  await takeover.getByTestId("takeover-discard").click();
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

test("Journey 2 — correction with adjustment applies nothing; the next pass starts clean (O.13.5C)", async ({ page }, { project }) => {
  const { userId } = await loginAsStub(project.name, 187);
  const fixture = await insertListingFixture(userId, {
    status: "PENDING_MODERATION", complete: true, images: 3,
  });
  await loginAs(page.context(), testPhone(project.name, 188), { roles: ["MODERATOR"] });
  await claimOnDetail(page, fixture.id);
  await page.getByTestId("adjustment-edit").click();
  await page.getByTestId("adj-price").fill("23000");
  await page.getByTestId("adjustment-save").click();
  await expect(page.getByTestId("adjustment-chip")).toBeVisible();

  // sealed non-apply confirmation copy
  await page.getByTestId("action-correction").click();
  await expect(page.getByTestId("adjusted-decision-note")).toContainText(
    "Moderator düzəlişləri tətbiq olunmayacaq",
  );
  await expect(page.getByTestId("adjusted-decision-note")).toContainText("tarixçəyə köçürüləcək");
  await page.getByTestId("decision-reason").selectOption("INVALID_PHOTOS");
  await page.getByTestId("decision-note").fill("Şəkilləri yeniləyin.");
  await page.getByTestId("decision-submit").click();
  await expect(page.getByTestId("decision-done")).toContainText("Düzəliş tələbi");

  // seller content untouched; adjustment terminal in history
  const snapshot = await listingSnapshot(fixture.id);
  expect(snapshot.status).toBe("CORRECTION_REQUIRED");
  expect(snapshot.price).toBe("2500000");
  await page.goto(`/moderator/elanlar/${fixture.id}`);
  await expect(page.getByTestId("adjustment-chip")).toHaveCount(0);
  await expect(page.getByTestId("adjustment-history")).toContainText("Moderator düzəlişi sildi");

  // seller resubmission (same transition as the real resubmit flow)
  // opens a CLEAN pass — no old adjustment re-attaches
  const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  await sql`update listings set status = 'PENDING_MODERATION', submitted_at = now() where id = ${fixture.id}`;
  await sql.end();
  await page.goto(`/moderator/elanlar/${fixture.id}`);
  await expect(page.getByTestId("adjustment-chip")).toHaveCount(0);
  await expect(page.getByTestId("takeover-card")).toHaveCount(0);
  // a fresh claim on the clean pass offers a clean Redaktə et entry
  await claimOnDetail(page, fixture.id);
  await expect(page.getByTestId("adjustment-edit")).toBeVisible();
  await expect(page.getByTestId("adjustment-chip")).toHaveCount(0);
});

test("Journey 3 — reject with adjustment applies nothing (O.13.5C)", async ({ page }, { project }) => {
  const { userId } = await loginAsStub(project.name, 189);
  const fixture = await insertListingFixture(userId, {
    status: "PENDING_MODERATION", complete: true, images: 3,
  });
  await loginAs(page.context(), testPhone(project.name, 190), { roles: ["MODERATOR"] });
  await claimOnDetail(page, fixture.id);
  await page.getByTestId("adjustment-edit").click();
  await page.getByTestId("adj-price").fill("22000");
  await page.getByTestId("adjustment-save").click();
  await expect(page.getByTestId("adjustment-chip")).toBeVisible();

  await page.getByTestId("action-reject").click();
  await expect(page.getByTestId("adjusted-decision-note")).toContainText(
    "Moderator düzəlişləri tətbiq olunmayacaq",
  );
  await expect(page.getByTestId("adjusted-decision-note")).toContainText("yalnız tarixçədə qalacaq");
  await page.getByTestId("decision-reason").selectOption("PROHIBITED_ITEM");
  await page.getByTestId("decision-submit").click();
  await expect(page.getByTestId("decision-done")).toContainText("rədd edildi");

  const snapshot = await listingSnapshot(fixture.id);
  expect(snapshot.status).toBe("REJECTED");
  expect(snapshot.price).toBe("2500000");
});

test("Owner journey — legacy submission without seller_name: save → Təsdiqlə succeeds (O.13.5C regression)", async ({ page }, { project }) => {
  // fails on 5221db3: approve returned 400 LISTING_INCOMPLETE
  // {missing: seller_name} behind the generic "Əməliyyat alınmadı"
  const { userId } = await loginAsStub(project.name, 191);
  const fixture = await insertListingFixture(userId, {
    status: "PENDING_MODERATION", complete: true, images: 3,
  });
  const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  await sql`update listings set seller_name = null where id = ${fixture.id}`;
  await sql.end();

  await loginAs(page.context(), testPhone(project.name, 192), { roles: ["MODERATOR"] });
  await claimOnDetail(page, fixture.id);
  await page.getByTestId("adjustment-edit").click();
  await page.getByTestId("adj-price").fill("27500");
  await page.getByTestId("adjustment-save").click();
  // SERVER saved state — then decide with no shortcut in between
  await expect(page.getByTestId("adjustment-chip")).toBeVisible();
  await page.getByTestId("action-approve").click();
  await expect(page.getByTestId("adjusted-decision-note")).toContainText(
    "Moderator düzəlişləri ilə təsdiqlənəcək",
  );
  await page.getByTestId("decision-submit").click();
  await expect(page.getByTestId("decision-done")).toContainText("təsdiqləndi");

  const snapshot = await listingSnapshot(fixture.id);
  expect(snapshot.status).toBe("ACTIVE");
  expect(snapshot.price).toBe("2750000");
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("27 500");
});

/** Real seller edit journey: enter, change price, submit. */
async function sellerSubmitsEdit(page: Page, listingId: string, price: string) {
  await page.goto("/profil/elanlar");
  await page
    .locator(`[data-testid="owner-listing-card"][data-listing-id="${listingId}"]`)
    .getByTestId("owner-edit")
    .click();
  await page.waitForURL(/\/redakte$/);
  const sale = page.getByTestId("axin-section-sale");
  if ((await sale.getAttribute("data-state")) !== "open") {
    await sale.click();
  }
  await page.getByTestId("wizard-price").fill(price);
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
  const review = page.getByTestId("axin-section-review");
  if ((await review.getAttribute("data-state")) !== "open") {
    await review.click();
  }
  await page.getByTestId("wizard-submit").click();
  await expect(page.getByTestId("edit-result")).toHaveAttribute("data-outcome", "SUBMITTED");
}

async function moderatorAdjustsPrice(page: Page, listingId: string, price: string) {
  await claimOnDetail(page, listingId);
  await page.getByTestId("adjustment-edit").click();
  await page.getByTestId("adj-price").fill(price);
  await page.getByTestId("adjustment-save").click();
  await expect(page.getByTestId("adjustment-chip")).toBeVisible();
}

test("EDIT Journey 2 — correction applies nothing; seller fixes the SAME revision; next pass clean (O.13.5D)", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 193));
  const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  await sellerSubmitsEdit(page, fixture.id, "26500");

  await loginAs(context, testPhone(project.name, 194), { roles: ["MODERATOR"] });
  await moderatorAdjustsPrice(page, fixture.id, "26800");
  await page.getByTestId("action-correction").click();
  await expect(page.getByTestId("adjusted-decision-note")).toContainText(
    "Moderator düzəlişləri tətbiq olunmayacaq",
  );
  await page.getByTestId("decision-reason").selectOption("INVALID_PHOTOS");
  await page.getByTestId("decision-note").fill("Şəkilləri yeniləyin.");
  await page.getByTestId("decision-submit").click();
  await expect(page.getByTestId("decision-done")).toContainText("Düzəliş tələbi");

  // public old X; moderator value never applied
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("25 000");

  // seller corrects the SAME revision and resubmits through the real UI
  await loginAs(context, testPhone(project.name, 193));
  await page.goto("/profil/elanlar");
  const card = page.locator(`[data-testid="owner-listing-card"][data-listing-id="${fixture.id}"]`);
  await expect(card.getByTestId("owner-edit-chip")).toHaveText("Redaktəyə düzəliş tələb olunur");
  await card.getByTestId("owner-edit-link").click();
  await page.waitForURL(/\/redakte$/);
  await expect(page.getByTestId("wizard-feedback")).toContainText("Şəkillər uyğun deyil");
  const sale = page.getByTestId("axin-section-sale");
  if ((await sale.getAttribute("data-state")) !== "open") {
    await sale.click();
  }
  await page.getByTestId("wizard-price").fill("26600");
  await expect(page.getByTestId("wizard-save-state")).toHaveText("Yadda saxlanıldı", { timeout: 15_000 });
  const review = page.getByTestId("axin-section-review");
  if ((await review.getAttribute("data-state")) !== "open") {
    await review.click();
  }
  await page.getByTestId("wizard-submit").click();
  await expect(page.getByTestId("edit-result")).toHaveAttribute("data-outcome", "SUBMITTED");

  // the old moderator adjustment never reattaches — clean new pass
  await loginAs(context, testPhone(project.name, 194), { roles: ["MODERATOR"] });
  await page.goto(`/moderator/elanlar/${fixture.id}`);
  await expect(page.getByTestId("adjustment-chip")).toHaveCount(0);
  await expect(page.getByTestId("takeover-card")).toHaveCount(0);
  await expect(page.getByTestId("adjustment-history")).toContainText("Moderator düzəlişi sildi");
});

test("EDIT Journey 3 — reject applies nothing; old public content remains (O.13.5D)", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 195));
  const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  await sellerSubmitsEdit(page, fixture.id, "26500");
  await loginAs(context, testPhone(project.name, 196), { roles: ["MODERATOR"] });
  await moderatorAdjustsPrice(page, fixture.id, "26900");
  await page.getByTestId("action-reject").click();
  await expect(page.getByTestId("adjusted-decision-note")).toContainText("yalnız tarixçədə qalacaq");
  await page.getByTestId("decision-reason").selectOption("MISLEADING_INFO");
  await page.getByTestId("decision-submit").click();
  await expect(page.getByTestId("decision-done")).toContainText("Dəyişikliklər rədd edildi.");
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("25 000");
  const snapshot = await listingSnapshot(fixture.id);
  expect(snapshot.price).toBe("2500000");
});

test("EDIT Journey 4 — deactivated + requested: adjusted approval reactivates ONLY through the finalizer (O.13.5D)", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 197));
  const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  await sql`update listings set seller_deactivated_at = now() where id = ${fixture.id}`;
  await sql.end();
  await sellerSubmitsEdit(page, fixture.id, "26500");
  // the recorded seller activation intent (its one-click UI journey is
  // covered by the O.12 lifecycle specs)
  const sql2 = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  await sql2`update listings set seller_reactivation_requested_at = now() where id = ${fixture.id}`;
  await sql2.end();

  await loginAs(context, testPhone(project.name, 198), { roles: ["MODERATOR"] });
  await moderatorAdjustsPrice(page, fixture.id, "26700");
  await page.getByTestId("action-approve").click();
  await page.getByTestId("decision-submit").click();
  await expect(page.getByTestId("decision-done")).toContainText("Dəyişikliklər təsdiqləndi.");
  // finalizer reactivated → adjusted content is publicly live
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("detail-price")).toContainText("26 700");
  await expect(page.getByTestId("status-chip")).toHaveCount(0);
});

test("EDIT Journey 5 — expired: adjusted approval applies content but never renews (O.13.5D)", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 199));
  const fixture = await insertListingFixture(userId, { status: "EXPIRED", complete: true, images: 3 });
  await sellerSubmitsEdit(page, fixture.id, "26500");
  await loginAs(context, testPhone(project.name, 200), { roles: ["MODERATOR"] });
  await moderatorAdjustsPrice(page, fixture.id, "26400");
  await page.getByTestId("action-approve").click();
  await page.getByTestId("decision-submit").click();
  await expect(page.getByTestId("decision-done")).toContainText("Dəyişikliklər təsdiqləndi.");
  const snapshot = await listingSnapshot(fixture.id);
  expect(snapshot.status).toBe("EXPIRED"); // no renewal bypass
  expect(snapshot.price).toBe("2640000");
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("status-chip")).toBeVisible(); // degraded expired view
});
