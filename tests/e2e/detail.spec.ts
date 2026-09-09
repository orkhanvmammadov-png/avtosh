import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";
import { insertListingFixture } from "./seller-helpers";

test.describe("Listing detail", () => {
  test("positive condition claims render; absence renders no negative (4.17O.2)", async ({ page, context }, { project }) => {
    const { userId } = await loginAs(context, testPhone(project.name, 45));
    const claimed = await insertListingFixture(userId, {
      status: "ACTIVE", complete: true, images: 1, noAccident: true, notRepainted: true,
    });
    await context.clearCookies(); // public view
    await page.goto(`/elan/${claimed.publicId}`);
    // O.7: claims are pill chips with the explicit seller-claim wording
    const claims = page.getByTestId("condition-claims");
    await expect(claims).toContainText("Vuruğu yoxdur");
    await expect(claims).toContainText("Rənglənməyib");
    await expect(page.getByTestId("condition-disclaimer")).toHaveText("satıcının bəyanı");
    // a listing without claims shows NO condition section at all
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`);
    await expect(page.getByTestId("condition-claims")).toHaveCount(0);
    await expect(page.getByTestId("specs")).not.toContainText("Vuruğu yoxdur");
  });


  test("ACTIVE listing renders gallery, price, specs, features, and reveals contact", async ({ page }) => {
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Toyota");
    await expect(page.getByTestId("detail-price")).toContainText("AZN");
    await expect(page.getByTestId("gallery")).toBeVisible();
    await expect(page.getByTestId("specs")).toContainText("Benzin");
    await expect(page.getByTestId("features")).toContainText("ABS");
    // description is rendered as text, never as HTML
    await expect(page.getByTestId("description")).toContainText("<b>HTML yoxdur</b>");
    expect(await page.locator("[data-testid=description] b").count()).toBe(0);
    await expect(page.getByTestId("contact-masked")).toContainText("•");
    await expect(page.getByTestId("contact-masked")).not.toContainText("+994501234567");
    await page.getByTestId("contact-reveal").click();
    await expect(page.getByTestId("contact-call")).toContainText("+994501234567");
    await expect(page.getByTestId("contact-whatsapp")).toHaveAttribute("href", "https://wa.me/994501234567");
    await expect(page.getByTestId("contact-whatsapp")).toHaveAttribute("rel", /noopener/);
    const html = await page.content();
    expect(html).not.toContain(s.activeCarId); // internal listing UUID
    expect(html).not.toContain(s.sellerId); // owner UUID
    expect(html).not.toMatch(/storage_?path/);
    expect(html).not.toContain("+994501110001"); // seller ACCOUNT phone never appears
    await expect(page).toHaveTitle(/Toyota .* — AVTOSH\.AZ/);
    await expectNoHorizontalOverflow(page);
  });

  test("missing images render the local placeholder and contact-less listings disable reveal", async ({ page }) => {
    const s = seed();
    await page.goto(`/elan/${s.noImage}`);
    await expect(page.getByRole("img", { name: "Şəkil yoxdur" }).first()).toBeVisible();
    await page.goto(`/elan/${s.noContact}`);
    await expect(page.getByTestId("contact-reveal")).toBeDisabled();
    await expect(page.getByText("Əlaqə məlumatı mövcud deyil")).toBeVisible();
  });

  test("SOLD and EXPIRED show limited, non-contactable views", async ({ page }) => {
    const s = seed();
    for (const [id, label] of [[s.sold, "Satılıb"], [s.expired, "Müddəti bitib"]] as const) {
      await page.goto(`/elan/${id}`);
      await expect(page.getByText(label, { exact: true })).toBeVisible();
      await expect(page.getByTestId("limited-notice")).toBeVisible();
      await expect(page.getByTestId("contact-card")).toHaveCount(0);
      await expect(page.getByTestId("description")).toHaveCount(0);
      const robots = await page.locator('meta[name="robots"]').getAttribute("content");
      expect(robots ?? "").toContain("noindex");
    }
  });

  test("SUSPENDED, unknown and malformed ids are generic 404s", async ({ page }) => {
    const s = seed();
    for (const id of [s.suspended, "999999999", "abc", s.activeCarId]) {
      const response = await page.goto(`/elan/${id}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByText("Elan tapılmadı")).toBeVisible();
      // Leak check scoped to the 404 CONTENT: the global footer now
      // legitimately carries static marketing copy ("təhlükəsiz onlayn
      // ödəniş") on every page, which can never disclose per-listing
      // state — the assertion still forbids any lifecycle/payment hint
      // in what the 404 itself says.
      const text = await page.locator("main").textContent();
      expect(text).not.toMatch(/suspend|moderasiya|ödəniş|payment/i);
    }
  });

  test("contact reveal is refused for non-current listings at the API level", async ({ request }) => {
    const s = seed();
    for (const id of [s.sold, s.expired, s.suspended]) {
      const r = await request.post(`/api/v1/listings/${id}/contact`);
      expect(r.status()).toBe(404);
    }
    const ok = await request.post(`/api/v1/listings/${s.activeCar}/contact`);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["cache-control"]).toBe("no-store");
  });
});

test.describe("contact reveal rate limiting UI", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.77" } });

  test("429 shows a safe Azerbaijani message and keeps the page usable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "single-source scenario; one project only");
    const s = seed();
    const target = s.boosted[0]; // ACTIVE listing not used by other reveal tests
    for (let i = 0; i < 3; i += 1) {
      await page.goto(`/elan/${target}`);
      await page.getByTestId("contact-reveal").click();
      await expect(page.getByTestId("contact-call")).toBeVisible();
    }
    await page.goto(`/elan/${target}`);
    await page.getByTestId("contact-reveal").click();
    await expect(page.getByText("Çox sayda cəhd edildi")).toBeVisible();
    await expect(page.getByTestId("contact-call")).toHaveCount(0);
    await expect(page.getByTestId("detail-price")).toBeVisible(); // page remains usable
    const body = (await page.textContent("body")) ?? "";
    expect(body).not.toContain("CONTACT_RATE_LIMITED");
    expect(body).not.toContain("+994501234567"); // number stays hidden
  });
});

test.describe("Listing detail — Direction 1A (4.17O.7 Stage A)", () => {
  test("identity panel composes real data: price, chips, title, meta, seller, reference", async ({ page }) => {
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`);
    const panel = page.getByTestId("identity-panel");
    await expect(panel.getByTestId("detail-price")).toContainText("AZN");
    await expect(panel.getByRole("heading", { level: 1 })).toContainText(/Toyota .*, 20\d\d/);
    await expect(panel.getByTestId("detail-meta")).toContainText("km");
    await expect(panel.getByTestId("detail-meta")).toContainText("Benzin");
    // seller module: real public data only — name + city, never a
    // seller classification
    await expect(panel.getByTestId("seller-module")).toBeVisible();
    await expect(page.getByTestId("listing-detail")).not.toContainText("Fərdi satıcı");
    await expect(panel.getByTestId("listing-ref")).toContainText(`Elan № ${s.activeCar}`);
    // report entry point anchors to the existing report flow
    await panel.getByTestId("panel-report-link").click();
    await expect(page.getByTestId("report-open")).toBeVisible();
    // exactly one reveal control — no duplicated contact architecture
    await expect(page.getByTestId("contact-reveal")).toHaveCount(1);
    // key specs are real-DTO tiles; grouped specs carry both groups
    await expect(page.getByTestId("key-specs")).toContainText("Yürüş");
    await expect(page.getByTestId("key-specs")).toContainText("Benzin");
    await expect(page.getByTestId("specs")).toContainText("AVTOMOBİL");
    await expect(page.getByTestId("specs")).toContainText("TEXNİKİ");
    await expect(page.getByTestId("specs")).toContainText("Sedan");
    await expectNoHorizontalOverflow(page);
  });

  test("gallery: thumbnails, arrows with boundaries, counter and keyboard share one index", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "desktop gallery controls");
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`); // 3 seeded images
    const counter = page.getByTestId("gallery-hero-counter");
    await expect(counter).toHaveText("1 / 3");
    await expect(page.getByTestId("gallery-prev")).toBeDisabled(); // lower boundary
    await page.getByTestId("gallery-next").click();
    await expect(counter).toHaveText("2 / 3");
    await page.getByTestId("gallery-thumb-2").click();
    await expect(counter).toHaveText("3 / 3");
    await expect(page.getByTestId("gallery-next")).toBeDisabled(); // upper boundary
    await expect(page.getByTestId("gallery-thumb-2")).toHaveAttribute("aria-current", "true");
    // keyboard on the focusable stage
    await page.getByTestId("gallery-main").click();
    await page.keyboard.press("ArrowLeft");
    await expect(counter).toHaveText("2 / 3");
    await page.keyboard.press("ArrowRight");
    await expect(counter).toHaveText("3 / 3");
    // no "+n" tile at 3 images
    await expect(page.getByTestId("gallery-more")).toHaveCount(0);
    // ≤8 features never renders the expander for the seeded listing
    await expect(page.getByTestId("features-toggle")).toHaveCount(0);
  });

  test("gallery: '+n' tile appears past six images and opens the fullscreen layer", async ({ page, context }, { project }) => {
    test.skip(project.name === "mobile", "desktop gallery controls");
    const { userId } = await loginAs(context, testPhone(project.name, 48));
    const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 9 });
    await context.clearCookies();
    await page.goto(`/elan/${fixture.publicId}`);
    await expect(page.getByTestId("gallery-hero-counter")).toHaveText("1 / 9");
    await expect(page.getByTestId("gallery-thumb-4")).toBeVisible(); // 5 real tiles
    await expect(page.getByTestId("gallery-thumb-5")).toHaveCount(0);
    const more = page.getByTestId("gallery-more");
    await expect(more).toContainText("+4");
    await more.click();
    const overlay = page.getByTestId("gallery-fullscreen");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("6 / 9"); // jumped to the first hidden index
    await page.keyboard.press("ArrowRight");
    await expect(overlay).toContainText("7 / 9");
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId("gallery-hero-counter")).toHaveText("7 / 9"); // one shared index
  });

  test("promotion badges: PREMIUM, BOOST and the dual state show full words, never Reklam", async ({ page, context }, { project }) => {
    const { userId } = await loginAs(context, testPhone(project.name, 49));
    const fixtures = {
      premium: await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 1 }),
      boost: await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 1 }),
      dual: await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 1 }),
    };
    await context.clearCookies();
    const sql = (await import("postgres")).default(seed().databaseUrl, { prepare: false, max: 1 });
    try {
      const grant = async (listingId: string, type: "PREMIUM" | "BOOST") => {
        await sql`
          with pay as (
            insert into payments (user_id, listing_id, type, amount_minor, idempotency_key, status, provider)
            values (${userId}, ${listingId}, ${type}, 0, ${`o7:${listingId}:${type}`}, 'SUCCESS', 'KAPITAL')
            returning id
          )
          insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
          select ${listingId}, ${type}, pay.id, now() - interval '1 hour', now() + interval '7 days', 'ACTIVE', 7, 0 from pay
        `;
      };
      await grant(fixtures.premium.id, "PREMIUM");
      await grant(fixtures.boost.id, "BOOST");
      await grant(fixtures.dual.id, "PREMIUM");
      await grant(fixtures.dual.id, "BOOST");

      await page.goto(`/elan/${fixtures.premium.publicId}`);
      const panel = page.getByTestId("identity-panel");
      await expect(panel).toContainText("Premium");
      await expect(panel).not.toContainText("Boost");

      await page.goto(`/elan/${fixtures.boost.publicId}`);
      await expect(panel).toContainText("Boost");
      await expect(panel).not.toContainText("Premium");

      await page.goto(`/elan/${fixtures.dual.publicId}`);
      await expect(panel).toContainText("Premium");
      await expect(panel).toContainText("Boost");
      await expect(page.getByTestId("listing-detail")).not.toContainText("Reklam");
    } finally {
      await sql`delete from listing_promotions where payment_id in (select id from payments where idempotency_key like 'o7:%')`;
      await sql`delete from payments where idempotency_key like 'o7:%'`;
      await sql.end();
    }
  });

  test("description clamps only when it overflows; expander opens in place", async ({ page, context }, { project }) => {
    const { userId } = await loginAs(context, testPhone(project.name, 50));
    const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 1 });
    const sql = (await import("postgres")).default(seed().databaseUrl, { prepare: false, max: 1 });
    try {
      await sql`update listings set description = ${Array.from({ length: 14 }, (_, i) => `Sətir ${i + 1}: avtomobil haqqında ətraflı məlumat.`).join("\n")} where id = ${fixture.id}`;
    } finally {
      await sql.end();
    }
    await context.clearCookies();
    await page.goto(`/elan/${fixture.publicId}`);
    const toggle = page.getByTestId("description-toggle");
    await expect(toggle).toContainText("Daha çox");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toContainText("Daha az");
    await expect(page.getByTestId("description")).toContainText("Sətir 14");
    await toggle.click();
    await expect(toggle).toContainText("Daha çox");
    // the seeded short description never clamps
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`);
    await expect(page.getByTestId("description-toggle")).toHaveCount(0);
  });
});
