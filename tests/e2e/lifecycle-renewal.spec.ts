import postgres from "postgres";
import { expect, test, type Page } from "@playwright/test";
import { seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import { insertListingFixture, listingStatus } from "./seller-helpers";

/**
 * Phase 4.16 lifecycle: seller renewal through the real fake-Kapital
 * HPP, settings-snapshot pricing, the expiry worker driven through
 * the secured cron endpoint, and buyer report intake round-tripping
 * into the admin queue.
 */

const CRON_SECRET = "e2e-cron-secret-0123456789abcdef";

function db() {
  return postgres(seed().databaseUrl, { prepare: false, max: 1 });
}

/** Turns a fixture into an EXPIRED listing with its lapsed period. */
async function makeExpired(listingId: string): Promise<void> {
  const sql = db();
  try {
    await sql`
      update listings
      set status = 'EXPIRED', published_at = now() - interval '40 days',
          current_expires_at = now() - interval '10 days'
      where id = ${listingId}
    `;
    await sql`
      insert into listing_periods (listing_id, period_number, source, starts_at, ends_at, status)
      values (${listingId}, 1, 'INITIAL', now() - interval '40 days', now() - interval '10 days', 'EXPIRED')
    `;
  } finally {
    await sql.end();
  }
}

async function renewViaHpp(page: Page, listingId: string, expectedAmount: string) {
  await page.goto(`/profil/elanlar/${listingId}/yenile`);
  await expect(page.getByTestId("renewal-page")).toBeVisible();
  await page.getByTestId("renewal-pay").click();
  await page.waitForURL(/\/api\/dev-kapital\/hpp\?/);
  await expect(page.getByTestId("fake-hpp-amount")).toHaveText(expectedAmount);
  await page.getByTestId("fake-hpp-pay").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
}

test("renewal round-trip: Yenilə → 2 AZN / 30 days → HPP → ACTIVE again with a new expiry, same public id", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 160));
  const fixture = await insertListingFixture(userId, { status: "ACTIVE" });
  await makeExpired(fixture.id);

  // My Listings clearly shows the expired state and the renewal action
  await page.goto("/profil/elanlar");
  const card = page.locator(`[data-listing-id="${fixture.id}"]`);
  await expect(card).toContainText("Müddəti bitib");
  await expect(card.getByTestId("owner-action")).toHaveText("Yenilə");
  await card.getByTestId("owner-action").click();
  await page.waitForURL(new RegExp(`/profil/elanlar/${fixture.id}/yenile`));

  // server-priced offer: 2 AZN, 30 days, explains what happens next
  await expect(page.getByTestId("renewal-price")).toContainText("2");
  await expect(page.getByTestId("renewal-duration")).toContainText("30");
  await expect(page.getByTestId("renewal-explainer")).toBeVisible();

  await page.getByTestId("renewal-pay").click();
  await page.waitForURL(/\/api\/dev-kapital\/hpp\?/);
  await expect(page.getByTestId("fake-hpp-amount")).toHaveText("2.00 AZN");
  await page.getByTestId("fake-hpp-pay").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
  await expect(page.getByTestId("payment-result")).toContainText("Elan yeniləndi");

  // durable state: ACTIVE, one renewal period, same listing/public id
  expect(await listingStatus(fixture.id)).toBe("ACTIVE");
  const sql = db();
  const [period] = await sql`
    select period_number, source::text as source,
           (ends_at between now() + interval '29 days' and now() + interval '31 days') as window_ok
    from listing_periods where listing_id = ${fixture.id} and source = 'RENEWAL'
  `;
  const [periods] = await sql`
    select count(*)::text as n from listing_periods where listing_id = ${fixture.id}
  `;
  await sql.end();
  expect(period.period_number).toBe(2);
  expect(period.window_ok).toBe(true);
  expect(Number(periods.n)).toBe(2);

  // public page is live again under the SAME public id
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("listing-detail")).toHaveAttribute("data-status", "ACTIVE");
  await expect(page.getByTestId("limited-notice")).toHaveCount(0);
  await page.goto("/profil/elanlar");
  await expect(page.locator(`[data-listing-id="${fixture.id}"]`)).toContainText("Aktiv");
});

test("renewal pricing is server settings: after a change, a NEW renewal offers the new snapshot", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 161));
  const fixture = await insertListingFixture(userId, { status: "ACTIVE" });
  await makeExpired(fixture.id);
  const sql = db();
  try {
    await sql`update system_settings set value = '300'::jsonb where key = 'listing.renewal_fee_minor'`;
    await sql`update system_settings set value = '45'::jsonb where key = 'listing.renewal_duration_days'`;
    await renewViaHpp(page, fixture.id, "3.00 AZN");
    const [period] = await sql`
      select (ends_at between now() + interval '44 days' and now() + interval '46 days') as window_ok
      from listing_periods where listing_id = ${fixture.id} and source = 'RENEWAL'
    `;
    expect(period.window_ok).toBe(true); // 45-day snapshot honored
  } finally {
    await sql`update system_settings set value = '200'::jsonb where key = 'listing.renewal_fee_minor'`;
    await sql`update system_settings set value = '30'::jsonb where key = 'listing.renewal_duration_days'`;
    await sql.end();
  }
});

test("renewal is refused for non-expired listings and foreign owners", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 162));
  const active = await insertListingFixture(userId, { status: "ACTIVE" });
  await page.goto(`/profil/elanlar/${active.id}/yenile`);
  await expect(page.getByTestId("renewal-unavailable")).toBeVisible();
  // a foreign expired listing is a plain 404
  const sql = db();
  const [foreignOwner] = await sql`
    insert into users (phone_e164) values (${testPhone(project.name, 163)})
    on conflict (phone_e164) do update set last_login_at = now() returning id
  `;
  const foreign = await insertListingFixture(foreignOwner.id as string, { status: "ACTIVE" });
  await sql.end();
  await makeExpired(foreign.id);
  expect((await page.goto(`/profil/elanlar/${foreign.id}/yenile`))?.status()).toBe(404);
});

test("expiry worker: the cron endpoint is secured and flips an overdue listing to the limited public state", async ({ page, context }, { project }) => {
  const { userId } = await loginAs(context, testPhone(project.name, 164));
  const fixture = await insertListingFixture(userId, { status: "ACTIVE" });
  const sql = db();
  await sql`
    update listings set current_expires_at = now() - interval '1 minute' where id = ${fixture.id}
  `;
  await sql.end();

  // even BEFORE the worker runs, the lapsed listing is not publicly active
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("listing-detail")).toHaveAttribute("data-status", "EXPIRED");
  await expect(page.getByTestId("limited-notice")).toBeVisible();

  // unauthorized invocations are refused (fail closed)
  const anonymous = await context.request.get("/api/jobs/expire-listings");
  expect(anonymous.status()).toBe(401);
  const wrong = await context.request.get("/api/jobs/expire-listings", {
    headers: { authorization: "Bearer wrong-secret-wrong-secret" },
  });
  expect(wrong.status()).toBe(401);

  const authorized = await context.request.get("/api/jobs/expire-listings", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(authorized.status()).toBe(200);
  expect(await listingStatus(fixture.id)).toBe("EXPIRED");
  await page.goto("/profil/elanlar");
  await expect(page.locator(`[data-listing-id="${fixture.id}"]`)).toContainText("Müddəti bitib");

  // reminders job is equally secured and runs idempotently
  expect((await context.request.get("/api/jobs/send-reminders")).status()).toBe(401);
  const reminders = await context.request.get("/api/jobs/send-reminders", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(reminders.status()).toBe(200);
});

test("report flow: Şikayət et → admin queue, repeated same-source reports are rate-limited", async ({ page, context }, { project }) => {
  const sql = db();
  const [sellerRow] = await sql`
    insert into users (phone_e164) values (${testPhone(project.name, 165)})
    on conflict (phone_e164) do update set last_login_at = now() returning id
  `;
  const fixture = await insertListingFixture(sellerRow.id as string, { status: "ACTIVE" });

  // anonymous buyer reports from the public detail page
  await page.goto(`/elan/${fixture.publicId}`);
  await page.getByTestId("report-open").click();
  await page.getByTestId("report-reason").selectOption("FRAUD_SUSPECTED");
  await page.getByTestId("report-note").fill("Qiymət şübhəli dərəcədə aşağıdır.");
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/listings/${fixture.publicId}/report`)),
    page.getByTestId("report-submit").click(),
  ]);
  expect(response.status()).toBe(200);
  await expect(page.getByTestId("report-success")).toBeVisible();
  const [row] = await sql`
    select reason_code, status::text as status from listing_reports
    where listing_id = ${fixture.id}
  `;
  expect(row.reason_code).toBe("FRAUD_SUSPECTED");
  expect(row.status).toBe("OPEN");

  // same source, same listing again → rate-limited, no second row
  await page.goto(`/elan/${fixture.publicId}`);
  await page.getByTestId("report-open").click();
  const [limited] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/listings/${fixture.publicId}/report`)),
    page.getByTestId("report-submit").click(),
  ]);
  expect(limited.status()).toBe(429);
  await expect(page.getByTestId("report-rate-limited")).toBeVisible();
  const [count] = await sql`
    select count(*)::text as n from listing_reports where listing_id = ${fixture.id}
  `;
  expect(Number(count.n)).toBe(1);
  await sql.end();

  // the report reaches the Phase 4.15 admin queue
  await loginAs(context, testPhone(project.name, 166), { roles: ["ADMIN"] });
  await page.goto("/admin/hesabatlar?status=OPEN");
  const adminRow = page
    .getByTestId("admin-report-row")
    .filter({ has: page.locator(`[data-testid="report-view-listing"]`) })
    .filter({ hasText: `№${fixture.publicId}` });
  await expect(adminRow.first()).toBeVisible();
});
