import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import {
  bumpListingRevision,
  claimListingAs,
  insertListingFixture,
  listingPeriodCount,
  listingStatus,
  moderationReviewCount,
} from "./seller-helpers";

/**
 * Moderator portal over the accepted Phase 4.7 backend. The server
 * remains the only authority for RBAC, claims, and decisions — these
 * tests drive the real APIs through the portal UI.
 */

async function moderatorLogin(page: Page, project: string, slot: number) {
  return loginAs(page.context(), testPhone(project, slot), { roles: ["MODERATOR"] });
}

/** Submits the open confirmation and returns the decision API status. */
async function submitDecision(page: Page, endpoint: string): Promise<number> {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes(`/moderator/listings/`) && r.url().endsWith(`/${endpoint}`),
    ),
    page.getByTestId("decision-submit").click(),
  ]);
  return response.status();
}

async function pendingFixture(project: string, slot: number, options: { images?: number } = {}) {
  const { userId } = await loginAsStub(project, slot);
  return {
    sellerId: userId,
    fixture: await insertListingFixture(userId, {
      status: "PENDING_MODERATION",
      complete: true,
      images: options.images ?? 3,
    }),
  };
}

// fixture user without holding a browser context
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

test("access control: anonymous, USER, and blocked moderators are denied", async ({ page, context }, { project }) => {
  await page.goto("/moderator/elanlar");
  await expect(page).toHaveURL(/\/giris\?return_to=%2Fmoderator%2Felanlar/);
  await loginAs(context, testPhone(project.name, 110)); // plain USER
  const userResponse = await page.goto("/moderator/elanlar");
  expect(userResponse?.status()).toBe(404); // no portal existence disclosure
  await context.clearCookies();
  await loginAs(context, testPhone(project.name, 111), { roles: ["MODERATOR"], blocked: true });
  const blockedResponse = await page.goto("/moderator/elanlar");
  expect(blockedResponse?.status()).toBe(404);
});

test("queue: oldest-first review context, null-image resilience, pagination", async ({ page }, { project }) => {
  const a = await pendingFixture(project.name, 112);
  const noImage = await pendingFixture(project.name, 113, { images: 0 });
  await moderatorLogin(page, project.name, 114);
  await page.goto("/moderator/elanlar");
  await expect(page.getByTestId("moderator-queue-page")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const rows = page.getByTestId("queue-item");
  await expect(rows.first()).toBeVisible();
  // The queue is oldest-first and shared with other specs' fixtures —
  // follow the real cursor until ours appear (exercises pagination).
  const findRow = async (listingId: string) => {
    for (let round = 0; round < 25; round += 1) {
      if ((await page.locator(`[data-listing-id="${listingId}"]`).count()) > 0) return;
      const more = page.getByTestId("queue-load-more");
      if ((await more.count()) === 0) break;
      const before = await rows.count();
      await more.click();
      await expect.poll(async () => rows.count()).toBeGreaterThan(before);
    }
    await expect(page.locator(`[data-listing-id="${listingId}"]`)).toBeVisible();
  };
  await findRow(a.fixture.id);
  await findRow(noImage.fixture.id);
  // the null-image row renders a safe placeholder instead of breaking
  const fallbackRow = page.locator(`[data-listing-id="${noImage.fixture.id}"]`);
  await expect(fallbackRow.getByTestId("queue-image-fallback")).toBeVisible();
});

test("approve round-trip: claim → confirm → ACTIVE with exactly one period, public page live", async ({ page }, { project }) => {
  const { fixture } = await pendingFixture(project.name, 115);
  await moderatorLogin(page, project.name, 116);
  await page.goto(`/moderator/elanlar/${fixture.id}`);
  await expect(page.getByTestId("moderation-review")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByTestId("claim-state")).toHaveAttribute("data-claim", "free");
  await page.getByTestId("claim-button").click();
  await expect(page.getByTestId("claim-state")).toHaveAttribute("data-claim", "mine");
  await page.getByTestId("action-approve").click();
  await expect(page.getByTestId("decision-confirm")).toBeVisible(); // deliberate two-step
  expect(await submitDecision(page, "approve")).toBe(200);
  // durable success panel with explicit next actions — no auto-refresh
  await expect(page.getByTestId("decision-done")).toContainText("təsdiqləndi");
  await expect(page.getByTestId("done-back-to-queue")).toBeVisible();
  expect(await listingStatus(fixture.id)).toBe("ACTIVE");
  expect(await listingPeriodCount(fixture.id)).toBe(1); // backend-created initial period
  expect(await moderationReviewCount(fixture.id)).toBe(1); // exactly one review
  // public page is live — the backend computed validity, not the UI
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("listing-detail")).toBeVisible();
});

test("correction round-trip: seller-safe note reaches the seller, escaped as plain text", async ({ page, context }, { project }) => {
  const sellerSlot = 117;
  const { fixture } = await pendingFixture(project.name, sellerSlot);
  await moderatorLogin(page, project.name, 118);
  await page.goto(`/moderator/elanlar/${fixture.id}`);
  await page.getByTestId("claim-button").click();
  await page.getByTestId("action-correction").click();
  await page.getByTestId("decision-reason").selectOption("INVALID_PHOTOS");
  const hostileNote = "Şəkilləri dəyişin <script>alert(1)</script>";
  await page.getByTestId("decision-note").fill(hostileNote);
  expect(await submitDecision(page, "request-correction")).toBe(200);
  await expect(page.getByTestId("decision-done")).toContainText("Düzəliş tələbi");
  expect(await listingStatus(fixture.id)).toBe("CORRECTION_REQUIRED");
  expect(await moderationReviewCount(fixture.id)).toBe(1);
  // the SELLER now sees the accepted Phase 4.11 projection — nothing more
  await context.clearCookies();
  await loginAs(context, testPhone(project.name, sellerSlot));
  await page.goto("/profil/elanlar");
  const card = page.locator('[data-testid="owner-listing-card"][data-status="CORRECTION_REQUIRED"]').first();
  await expect(card.getByTestId("owner-feedback")).toContainText("Şəkillər uyğun deyil");
  await expect(card.getByTestId("owner-feedback")).toContainText("<script>alert(1)</script>"); // escaped literal text
  await card.getByTestId("owner-action").click();
  const banner = page.getByTestId("wizard-feedback");
  await expect(banner).toContainText("Şəkilləri dəyişin");
  await expect(banner).toContainText("<script>alert(1)</script>");
  // rendered as text, never as markup
  expect(await page.locator("script", { hasText: "alert(1)" }).count()).toBe(0);
});

test("reject requires a reason and lands in history", async ({ page }, { project }) => {
  const { fixture } = await pendingFixture(project.name, 119);
  await moderatorLogin(page, project.name, 120);
  await page.goto(`/moderator/elanlar/${fixture.id}`);
  await page.getByTestId("claim-button").click();
  await page.getByTestId("action-reject").click();
  await page.getByTestId("decision-reason").selectOption("PROHIBITED_ITEM");
  expect(await submitDecision(page, "reject")).toBe(200);
  await expect(page.getByTestId("decision-done")).toContainText("rədd edildi");
  expect(await listingStatus(fixture.id)).toBe("REJECTED");
  expect(await moderationReviewCount(fixture.id)).toBe(1);
  // the durable panel's own navigation shows the current state
  await page.getByTestId("done-view-current").click();
  await expect(page.getByTestId("moderation-history")).toContainText("Rədd edildi"); // approved design label
  await expect(page.getByTestId("moderation-history")).toContainText("Qadağan olunmuş məhsul");
});

test("claim contention: the second moderator sees claimed-by-other and cannot take over", async ({ page }, { project }) => {
  const { fixture } = await pendingFixture(project.name, 121);
  const rival = await loginAsStub(project.name, 122);
  const sqlRoles = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  await sqlRoles`insert into user_roles (user_id, role_id) select ${rival.userId}, id from roles where code = 'MODERATOR' on conflict do nothing`;
  await sqlRoles.end();
  await claimListingAs(fixture.id, rival.userId); // rival owns the live claim
  await moderatorLogin(page, project.name, 123);
  await page.goto(`/moderator/elanlar/${fixture.id}`);
  await expect(page.getByTestId("claim-state")).toHaveAttribute("data-claim", "other");
  await expect(page.getByTestId("moderation-actions")).toContainText("Başqa moderatorun nəzarətindədir");
  // no decision buttons without ownership
  await expect(page.getByTestId("action-approve")).toHaveCount(0);
  // a takeover attempt is refused by the backend with a safe UI state
  await page.getByTestId("claim-button").click();
  await expect(page.getByTestId("decision-conflict")).toContainText("başqa moderator tərəfindən götürüldü");
  await page.getByTestId("conflict-refresh").click();
  await expect(page.getByTestId("claim-state")).toHaveAttribute("data-claim", "other");
});

test("competing decisions: the second moderator gets the already-decided state", async ({ page, context }, { project }) => {
  const { fixture } = await pendingFixture(project.name, 124);
  // moderator B opens the page first (stale view)
  await moderatorLogin(page, project.name, 125);
  await page.goto(`/moderator/elanlar/${fixture.id}`);
  await expect(page.getByTestId("claim-state")).toHaveAttribute("data-claim", "free");
  // moderator A decides through the API meanwhile (claim + approve)
  const a = await loginAsStub(project.name, 126);
  const sql = postgres(seed().databaseUrl, { prepare: false, max: 1 });
  await sql`insert into user_roles (user_id, role_id) select ${a.userId}, id from roles where code = 'MODERATOR' on conflict do nothing`;
  await sql`insert into moderation_claims (listing_id, moderator_id, expires_at) values (${fixture.id}, ${a.userId}, now() + interval '10 minutes')`;
  await sql`update listings set status = 'ACTIVE', published_at = now(), current_expires_at = now() + interval '30 days' where id = ${fixture.id}`;
  await sql.end();
  // B tries to claim the no-longer-pending listing → safe conflict state
  await page.getByTestId("claim-button").click();
  await expect(page.getByTestId("decision-conflict")).toBeVisible();
  await page.getByTestId("conflict-refresh").click();
  await expect(page.getByTestId("review-status")).toHaveText("ACTIVE");
  expect(await listingStatus(fixture.id)).toBe("ACTIVE");
  void context;
});

test("stale revision: decision refused with explicit reload UX", async ({ page }, { project }) => {
  const { fixture } = await pendingFixture(project.name, 127);
  await moderatorLogin(page, project.name, 128);
  await page.goto(`/moderator/elanlar/${fixture.id}`);
  await page.getByTestId("claim-button").click();
  await expect(page.getByTestId("claim-state")).toHaveAttribute("data-claim", "mine");
  // settle on a fully loaded page (claim refresh completed), THEN the
  // listing changes under review — the client now provably holds the
  // pre-change revision
  await page.reload();
  await expect(page.getByTestId("claim-state")).toHaveAttribute("data-claim", "mine");
  await bumpListingRevision(fixture.id); // the listing changed under review
  await page.getByTestId("action-approve").click();
  // the stale decision is refused by the SERVER, creating nothing
  expect(await submitDecision(page, "approve")).toBe(409);
  const conflict = page.getByTestId("decision-conflict");
  await expect(conflict).toContainText("Elan dəyişdirilib. Son versiyanı yeniləyin.");
  expect(await listingStatus(fixture.id)).toBe("PENDING_MODERATION"); // nothing overwritten
  expect(await moderationReviewCount(fixture.id)).toBe(0); // no review from the stale request
  // explicit recovery = full document reload → current server revision
  await Promise.all([page.waitForLoadState("load"), page.getByTestId("conflict-refresh").click()]);
  await expect(page.getByTestId("claim-state")).toHaveAttribute("data-claim", "mine"); // claim survived
  await page.getByTestId("action-approve").click();
  expect(await submitDecision(page, "approve")).toBe(200);
  // durable success — remains observable until the moderator moves on
  await expect(page.getByTestId("decision-done")).toContainText("təsdiqləndi");
  await expect(page.getByTestId("done-back-to-queue")).toBeVisible();
  expect(await listingStatus(fixture.id)).toBe("ACTIVE");
  expect(await moderationReviewCount(fixture.id)).toBe(1); // exactly one review
  expect(await listingPeriodCount(fixture.id)).toBe(1); // exactly one initial period
  await page.getByTestId("done-view-current").click();
  await expect(page.getByTestId("review-status")).toHaveText("ACTIVE");
});

test("suspension: ACTIVE listing hidden publicly with reasoned confirmation", async ({ page }, { project }) => {
  const seller = await loginAsStub(project.name, 129);
  const fixture = await insertListingFixture(seller.userId, { status: "ACTIVE", complete: true, images: 3 });
  await moderatorLogin(page, project.name, 130);
  await page.goto(`/moderator/elanlar/${fixture.id}`);
  await expect(page.getByTestId("review-status")).toHaveText("ACTIVE");
  await page.getByTestId("action-suspend").click();
  await page.getByTestId("decision-reason").selectOption("MISLEADING_INFO");
  expect(await submitDecision(page, "suspend")).toBe(200);
  await expect(page.getByTestId("decision-done")).toContainText("dayandırıldı");
  await expect(page.getByTestId("done-back-to-queue")).toBeVisible();
  expect(await listingStatus(fixture.id)).toBe("SUSPENDED");
  const publicResponse = await page.goto(`/elan/${fixture.publicId}`);
  expect(publicResponse?.status()).toBe(404);
});
