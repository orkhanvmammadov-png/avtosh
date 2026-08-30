import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import { insertListingFixture } from "./seller-helpers";

/**
 * Phase 4.15 admin panel workflows. The server stays the only
 * authority — these tests drive the real admin APIs through the UI
 * and cross-check effects in the database and through the public and
 * seller surfaces.
 */

function db() {
  return postgres(seed().databaseUrl, { prepare: false, max: 1 });
}

/** Opens a ConfirmAction, submits it, and returns the mutation status. */
async function confirmAction(page: Page, testid: string, urlPart: string): Promise<number> {
  await page.getByTestId(testid).click();
  await expect(page.getByTestId(`${testid}-confirm`)).toBeVisible();
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => ["POST", "PATCH"].includes(r.request().method()) && r.url().includes(urlPart),
    ),
    page.getByTestId(`${testid}-submit`).click(),
  ]);
  if (response.ok()) await page.waitForLoadState("load"); // deterministic full reload
  return response.status();
}

test("access control: anonymous, USER, MODERATOR, and blocked admins are denied", async ({ page, context }, { project }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/giris\?return_to=%2Fadmin/);
  await loginAs(context, testPhone(project.name, 150)); // plain USER
  expect((await page.goto("/admin"))?.status()).toBe(404); // no panel existence disclosure
  await context.clearCookies();
  await loginAs(context, testPhone(project.name, 150), { roles: ["MODERATOR"] });
  expect((await page.goto("/admin"))?.status()).toBe(404); // moderators gain no admin surface
  await context.clearCookies();
  await loginAs(context, testPhone(project.name, 151), { roles: ["ADMIN"], blocked: true });
  expect((await page.goto("/admin"))?.status()).toBe(404);
  expect((await page.goto("/admin/tenzimlemeler"))?.status()).toBe(404);
});

test("block / unblock: audited UI command that actually gates the seller's mutations", async ({ page, context, browser }, { project }) => {
  const adminPhone = testPhone(project.name, 152);
  const sellerPhone = testPhone(project.name, 153);
  await loginAs(context, adminPhone, { roles: ["ADMIN"] });
  const sellerContext = await browser.newContext();
  const { userId: sellerId } = await loginAs(sellerContext, sellerPhone);
  try {
    // the seller can mutate before the block
    const before = await sellerContext.request.post("/api/v1/me/listings", {
      data: { category: "CAR" },
    });
    expect(before.status()).toBe(201);

    await page.goto("/admin");
    await expect(page.getByTestId("admin-dashboard")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByTestId("admin-role")).toContainText("Admin");

    // find the seller through the masked search UI
    await page.goto(`/admin/istifadeciler?phone=${encodeURIComponent(sellerPhone)}`);
    const row = page.getByTestId("admin-user-row");
    await expect(row).toHaveCount(1);
    await expect(row).not.toContainText(sellerPhone); // masked in the UI
    await row.click();
    await expect(page.getByTestId("admin-user-detail")).toBeVisible();
    await expect(page.getByTestId("user-status")).toContainText("Aktiv");

    await page.getByTestId("user-block").click();
    await page.getByTestId("user-block-reason").fill("E2E qayda pozuntusu");
    const [blockResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/admin/users/${sellerId}/block`)),
      page.getByTestId("user-block-submit").click(),
    ]);
    expect(blockResponse.status()).toBe(200);
    await page.waitForLoadState("load");
    await expect(page.getByTestId("user-status")).toContainText("Bloklanıb");

    // server-side enforcement, not UI cosmetics
    const denied = await sellerContext.request.post("/api/v1/me/listings", {
      data: { category: "CAR" },
    });
    expect(denied.status()).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe("USER_BLOCKED");

    expect(await confirmAction(page, "user-unblock", `/admin/users/${sellerId}/unblock`)).toBe(200);
    await expect(page.getByTestId("user-status")).toContainText("Aktiv");
    const restored = await sellerContext.request.post("/api/v1/me/listings", {
      data: { category: "CAR" },
    });
    expect(restored.status()).toBe(201);

    // both commands are in the append-only audit trail
    await page.goto(`/admin/audit?action=USER_BLOCKED&entity_id=${sellerId}`);
    await expect(page.getByTestId("audit-row")).toHaveCount(1);
    await page.goto(`/admin/audit?action=USER_UNBLOCKED&entity_id=${sellerId}`);
    await expect(page.getByTestId("audit-row")).toHaveCount(1);
  } finally {
    await sellerContext.close();
  }
});

test("roles: SUPER_ADMIN grants a working MODERATOR; ADMIN can never mint admins", async ({ page, context, browser }, { project }) => {
  const targetPhone = testPhone(project.name, 154);
  const targetContext = await browser.newContext();
  const { userId: targetId } = await loginAs(targetContext, targetPhone);
  try {
    expect((await targetContext.request.get("/api/v1/moderator/listings")).status()).toBe(403);

    await loginAs(context, testPhone(project.name, 155), { roles: ["SUPER_ADMIN"] });
    await page.goto(`/admin/istifadeciler/${targetId}`);
    await expect(page.getByTestId("admin-user-detail")).toBeVisible();
    await expect(page.getByTestId("role-grant-admin")).toBeVisible(); // super admin sees the boundary control
    expect(await confirmAction(page, "role-grant-moderator", `/admin/users/${targetId}/roles`)).toBe(200);
    await expect(page.getByTestId("user-roles")).toContainText("MODERATOR");
    // the grant is real server-side authorization
    expect((await targetContext.request.get("/api/v1/moderator/listings")).status()).toBe(200);

    // a plain ADMIN has no admin-granting control and the API refuses it
    await context.clearCookies();
    await loginAs(context, testPhone(project.name, 152), { roles: ["ADMIN"] });
    await page.goto(`/admin/istifadeciler/${targetId}`);
    await expect(page.getByTestId("role-grant-moderator")).toHaveCount(0); // already granted → revoke shown
    await expect(page.getByTestId("role-grant-admin")).toHaveCount(0);
    await expect(page.getByTestId("role-revoke-admin")).toHaveCount(0);
    const escalate = await context.request.post(`/api/v1/admin/users/${targetId}/roles`, {
      data: { role: "ADMIN", action: "GRANT" },
    });
    expect(escalate.status()).toBe(403);
    const superGrant = await context.request.post(`/api/v1/admin/users/${targetId}/roles`, {
      data: { role: "SUPER_ADMIN", action: "GRANT" },
    });
    expect(superGrant.status()).toBe(400); // SUPER_ADMIN is not grantable at all
  } finally {
    await targetContext.close();
  }
});

test("package pricing: admin-set price snapshots into intents; later changes hit only future purchases", async ({ page, context, browser }, { project }) => {
  const sql = db();
  const sellerContext = await browser.newContext();
  const [pkg] = await sql`
    select id, price_minor::text as price_minor, is_active
    from promotion_packages where type = 'BOOST' and duration_days = 7
  `;
  const packageId = pkg.id as string;
  try {
    const { userId: sellerId } = await loginAs(sellerContext, testPhone(project.name, 156));
    await loginAs(context, testPhone(project.name, 157), { roles: ["ADMIN"] });

    await page.goto("/admin/tesviq-paketleri");
    await expect(page.getByTestId("admin-packages-page")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const row = page.locator('[data-package="BOOST-7"]');
    await row.getByTestId("pkg-price-input").fill("7");
    const [priceResponse] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/admin/promotion-packages")),
      row.getByTestId("pkg-save-price").click(),
    ]);
    expect(priceResponse.status()).toBe(200);
    await page.waitForLoadState("load");
    await expect(page.locator('[data-package="BOOST-7"]').getByTestId("pkg-current-price")).toContainText("7");

    // the seller sees the admin-approved package and buys at 7 AZN
    const packages = (await (await sellerContext.request.get("/api/v1/me/promotion-packages")).json()) as {
      data: { packages: { id: string; priceMinor: number }[] };
    };
    const visible = packages.data.packages.find((p) => p.id === packageId);
    expect(visible?.priceMinor).toBe(700);
    const firstListing = await insertListingFixture(sellerId, { status: "ACTIVE" });
    const firstCheckout = await sellerContext.request.post(
      `/api/v1/me/listings/${firstListing.id}/promotions/checkout`,
      { data: { type: "BOOST", package_id: packageId } },
    );
    expect(firstCheckout.status()).toBe(200);
    const [firstPayment] = await sql`
      select id, amount_minor::text as amount_minor from payments
      where listing_id = ${firstListing.id} and type = 'BOOST'
    `;
    expect(Number(firstPayment.amount_minor)).toBe(700);

    // the price rises AFTER the intent exists (5→7 AZN regression class)
    const freshRow = page.locator('[data-package="BOOST-7"]');
    await freshRow.getByTestId("pkg-price-input").fill("9");
    const [raiseResponse] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/admin/promotion-packages")),
      freshRow.getByTestId("pkg-save-price").click(),
    ]);
    expect(raiseResponse.status()).toBe(200);
    await page.waitForLoadState("load");

    const [unchanged] = await sql`
      select amount_minor::text as amount_minor from payments where id = ${firstPayment.id}
    `;
    expect(Number(unchanged.amount_minor)).toBe(700); // existing snapshot untouched

    const secondListing = await insertListingFixture(sellerId, { status: "ACTIVE" });
    const secondCheckout = await sellerContext.request.post(
      `/api/v1/me/listings/${secondListing.id}/promotions/checkout`,
      { data: { type: "BOOST", package_id: packageId } },
    );
    expect(secondCheckout.status()).toBe(200);
    const [secondPayment] = await sql`
      select amount_minor::text as amount_minor from payments
      where listing_id = ${secondListing.id} and type = 'BOOST'
    `;
    expect(Number(secondPayment.amount_minor)).toBe(900); // future intents pay the new price

    // payment operations view: attempts + reused verification, refunds blocked
    await page.goto(`/admin/odenisler/${firstPayment.id}`);
    await expect(page.getByTestId("admin-payment-detail")).toBeVisible();
    await expect(page.getByTestId("payment-attempts")).toBeVisible();
    await expect(page.getByTestId("refund-blocked")).toContainText("rəsmi provayder müqaviləsi");
    expect(await confirmAction(page, "payment-verify", `/admin/payments/${firstPayment.id}/verify`)).toBe(200);
  } finally {
    // restore the seeded package price so later promotion specs see it
    await sql`
      update promotion_packages
      set price_minor = ${pkg.price_minor}::bigint, is_active = ${pkg.is_active}
      where id = ${packageId}
    `;
    await sellerContext.close();
    await sql.end();
  }
});

test("suspension round-trip: moderator suspends, admin restores, the public page comes back", async ({ page, context }, { project }) => {
  const sql = db();
  try {
    const [sellerRow] = await sql`
      insert into users (phone_e164) values (${testPhone(project.name, 158)})
      on conflict (phone_e164) do update set last_login_at = now() returning id
    `;
    const fixture = await insertListingFixture(sellerRow.id as string, { status: "ACTIVE" });
    await loginAs(context, testPhone(project.name, 159), { roles: ["ADMIN"] });

    await page.goto(`/elan/${fixture.publicId}`);
    await expect(page.getByTestId("listing-detail")).toBeVisible();

    // suspend through the accepted moderator command (ADMIN is staff)
    await page.goto(`/moderator/elanlar/${fixture.id}`);
    await page.getByTestId("action-suspend").click();
    await expect(page.getByTestId("decision-confirm")).toBeVisible();
    const [suspendResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/suspend")),
      page.getByTestId("decision-submit").click(),
    ]);
    expect(suspendResponse.status()).toBe(200);
    await expect(page.getByTestId("decision-done")).toBeVisible();
    expect((await page.goto(`/elan/${fixture.publicId}`))?.status()).toBe(404); // publicly hidden

    // admin ops view shows the state and offers the single restore command
    await page.goto(`/admin/elanlar/${fixture.id}`);
    await expect(page.getByTestId("admin-listing-detail")).toHaveAttribute("data-status", "SUSPENDED");
    await expectNoHorizontalOverflow(page);
    expect(await confirmAction(page, "listing-unsuspend", `/admin/listings/${fixture.id}/unsuspend`)).toBe(200);
    await expect(page.getByTestId("admin-listing-detail")).toHaveAttribute("data-status", "ACTIVE");

    await page.goto(`/elan/${fixture.publicId}`);
    await expect(page.getByTestId("listing-detail")).toBeVisible(); // live again, same period

    // the restoration is audited
    await page.goto(`/admin/audit?action=LISTING_UNSUSPENDED&entity_id=${fixture.id}`);
    await expect(page.getByTestId("audit-row")).toHaveCount(1);
  } finally {
    await sql.end();
  }
});
