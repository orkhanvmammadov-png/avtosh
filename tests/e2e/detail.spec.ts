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
  test("identity panel composes real data: price, chips, title, meta, seller, reference", async ({ page }, { project }) => {
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`);
    const panel = page.getByTestId("identity-panel");
    await expect(panel.getByTestId("detail-price")).toContainText("AZN");
    await expect(panel.getByRole("heading", { level: 1 })).toContainText(/Toyota .*, 20\d\d/);
    await expect(panel.getByTestId("detail-meta")).toContainText("km");
    await expect(panel.getByTestId("detail-meta")).toContainText("Benzin");
    // seller module: real public data only — name + city, never a
    // seller classification. At the 768 board and 390 tiers the seller
    // (and the report entry) live in the lower seller row.
    if (project.name !== "desktop") {
      await expect(page.getByTestId("seller-row")).toBeVisible();
      await expect(page.getByTestId("seller-row")).toContainText(`Elan № ${s.activeCar}`);
      await page.getByTestId("seller-row").getByText("Şikayət et").click();
    } else {
      await expect(panel.getByTestId("seller-module")).toBeVisible();
      await expect(panel.getByTestId("listing-ref")).toContainText(`Elan № ${s.activeCar}`);
      await panel.getByTestId("panel-report-link").click();
    }
    await expect(page.getByTestId("listing-detail")).not.toContainText("Fərdi satıcı");
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

  test("gallery: arrows with boundaries, counter and keyboard share one index", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "desktop gallery controls");
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`); // 3 seeded images
    const counter = page.getByTestId("gallery-hero-counter");
    await expect(counter).toHaveText("1 / 3");
    await expect(page.getByTestId("gallery-prev")).toBeDisabled(); // lower boundary
    await page.getByTestId("gallery-next").click();
    await expect(counter).toHaveText("2 / 3");
    await page.getByTestId("gallery-next").click();
    await expect(counter).toHaveText("3 / 3");
    await expect(page.getByTestId("gallery-next")).toBeDisabled(); // upper boundary
    await expect(page.getByTestId("gallery-thumb-2")).toHaveAttribute("aria-current", "true"); // rail follows
    // keyboard on the focusable stage (O.7 closed-state behavior kept)
    await page.getByTestId("gallery-main").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(counter).toHaveText("2 / 3");
    await page.keyboard.press("ArrowRight");
    await expect(counter).toHaveText("3 / 3");
    await expect(page.getByTestId("gallery-fullscreen")).toHaveCount(0); // keyboard alone never opens the viewer
    // no "+n" tile at 3 images
    await expect(page.getByTestId("gallery-more")).toHaveCount(0);
    // ≤8 features never renders the expander for the seeded listing
    await expect(page.getByTestId("features-toggle")).toHaveCount(0);
  });

  test("gallery: '+n' tile appears past the tier cap and opens the fullscreen layer", async ({ page, context }, { project }) => {
    test.skip(project.name === "mobile", "desktop gallery controls");
    const { userId } = await loginAs(context, testPhone(project.name, 48));
    const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 9 });
    await context.clearCookies();
    await page.goto(`/elan/${fixture.publicId}`);
    await expect(page.getByTestId("gallery-hero-counter")).toHaveText("1 / 9");
    // per-tier rails from ONE DOM: 5 real tiles + "+4" at desk (6-up),
    // 7 real tiles + "+2" on the 768 board (8-up)
    const desk = project.name === "desktop";
    await expect(page.getByTestId("gallery-thumb-4")).toBeVisible();
    if (desk) {
      await expect(page.getByTestId("gallery-thumb-5")).not.toBeVisible();
    } else {
      await expect(page.getByTestId("gallery-thumb-6")).toBeVisible();
    }
    const more = page.getByTestId("gallery-more");
    await expect(more.getByText(desk ? "+4" : "+2")).toBeVisible();
    await more.click();
    const overlay = page.getByTestId("gallery-fullscreen");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(desk ? "6 / 9" : "8 / 9"); // first hidden index per tier
    await page.keyboard.press("ArrowRight");
    await expect(overlay).toContainText(desk ? "7 / 9" : "9 / 9");
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId("gallery-hero-counter")).toHaveText(desk ? "7 / 9" : "9 / 9"); // one shared index
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

test.describe("Listing detail — 1024 tier (4.17O.7 Stage B)", () => {
  test("1024 keeps the panel readable: long title wraps, reveal fits, no overflow", async ({ page, context }, { project }) => {
    test.skip(project.name !== "desktop", "explicit viewport scenario; one project");
    const s = seed();
    const { userId } = await loginAs(context, testPhone("desktop", 52));
    const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
    // deterministic LONG identity: a real (temporary) catalog model
    const sql = (await import("postgres")).default(s.databaseUrl, { prepare: false, max: 1 });
    let modelId: string | null = null;
    try {
      const [m] = await sql`
        insert into models (brand_id, category_id, name, slug)
        values (${s.toyotaBrandId}, (select id from categories where code = 'CAR'),
                'Land Cruiser 300 GR Sport Executive', 'lc300-gr-sport-exec-o7')
        returning id
      `;
      modelId = m.id as string;
      await sql`update listings set model_id = ${modelId} where id = ${fixture.id}`;
      await context.clearCookies();
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.goto(`/elan/${fixture.publicId}`);
      const panel = page.getByTestId("identity-panel");
      await expect(panel.getByRole("heading", { level: 1 })).toContainText("Land Cruiser 300 GR Sport Executive");
      await expectNoHorizontalOverflow(page);
      // the title never pushes the CTA out of the panel
      const panelBox = await panel.boundingBox();
      const ctaBox = await page.getByTestId("contact-reveal").boundingBox();
      expect(panelBox).not.toBeNull();
      expect(ctaBox).not.toBeNull();
      expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
      // revealed state stays inside the panel — phone primary, WhatsApp secondary
      await page.getByTestId("contact-reveal").click();
      await expect(page.getByTestId("contact-call")).toBeVisible();
      await expect(page.getByTestId("contact-whatsapp")).toBeVisible();
      const callBox = await page.getByTestId("contact-call").boundingBox();
      expect(callBox!.x + callBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
      await expectNoHorizontalOverflow(page);
      // the sealed 1440 composition still holds at its own width
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/elan/${s.activeCar}`);
      await expect(page.getByTestId("identity-panel")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    } finally {
      if (modelId !== null) {
        await sql`update listings set model_id = ${s.corollaModelId} where id = ${fixture.id}`;
        await sql`delete from models where id = ${modelId}`;
      }
      await sql.end();
    }
  });
});

test.describe("Listing detail — 768 board (4.17O.7 Stage C)", () => {
  test("768 uses the full-width gallery → identity board structure; 1024 reverts to the sealed panel", async ({ page, context }, { project }) => {
    test.skip(project.name !== "desktop", "explicit viewport scenario; one project");
    const s = seed();
    const { userId } = await loginAs(context, testPhone("desktop", 53));
    const rich = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 9, noAccident: true });
    const sql = (await import("postgres")).default(s.databaseUrl, { prepare: false, max: 1 });
    let modelId: string | null = null;
    try {
      // Premium+Boost, credit chip and a LONG identity on one listing
      for (const type of ["PREMIUM", "BOOST"] as const) {
        await sql`
          with pay as (
            insert into payments (user_id, listing_id, type, amount_minor, idempotency_key, status, provider)
            values (${userId}, ${rich.id}, ${type}, 0, ${`o7c:${rich.id}:${type}`}, 'SUCCESS', 'KAPITAL')
            returning id
          )
          insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
          select ${rich.id}, ${type}, pay.id, now() - interval '1 hour', now() + interval '7 days', 'ACTIVE', 7, 0 from pay
        `;
      }
      const [m] = await sql`
        insert into models (brand_id, category_id, name, slug)
        values (${s.toyotaBrandId}, (select id from categories where code = 'CAR'),
                'Land Cruiser 300 GR Sport Executive', 'lc300-gr-sport-exec-o7c')
        returning id
      `;
      modelId = m.id as string;
      await sql`update listings set model_id = ${modelId}, credit_available = true where id = ${rich.id}`;
      await context.clearCookies();

      // structural transition holds, overflow-free, across the tablet band
      for (const width of [768, 800, 900, 1023]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/elan/${rich.publicId}`);
        const panel = page.getByTestId("identity-panel");
        await expect(panel).toBeVisible();
        const panelBox = (await panel.boundingBox())!;
        const galleryBox = (await page.getByTestId("gallery-main").boundingBox())!;
        // full-width board under a full-width gallery — no side panel
        expect(panelBox.width).toBeGreaterThan(galleryBox.width * 0.95);
        expect(panelBox.y).toBeGreaterThan(galleryBox.y + galleryBox.height - 1);
        await expectNoHorizontalOverflow(page);
      }

      // board internals at 768: price left, CTA + 42px favorite right,
      // dual badges textual, inline meta, panel seller/footer relocated
      await page.setViewportSize({ width: 768, height: 900 });
      await page.goto(`/elan/${rich.publicId}`);
      const panel = page.getByTestId("identity-panel");
      await expect(panel).toContainText("Premium");
      await expect(panel).toContainText("Boost");
      await expect(panel.getByTestId("chip-credit")).toBeVisible();
      const panelBox = (await panel.boundingBox())!;
      const priceBox = (await page.getByTestId("detail-price").boundingBox())!;
      const ctaBox = (await page.getByTestId("contact-reveal").boundingBox())!;
      expect(ctaBox.x).toBeGreaterThan(panelBox.x + panelBox.width * 0.5); // CTA in the right column
      expect(priceBox.x).toBeLessThan(panelBox.x + panelBox.width * 0.4);
      const favBox = (await panel.locator('[data-testid="favorite-button"]:visible').boundingBox())!;
      expect(Math.round(favBox.width)).toBe(42); // the board's 42px favorite (the sticky one is hidden at md+)
      await expect(page.getByTestId("detail-meta")).toBeHidden(); // meta rides inline with the title
      await expect(panel.getByRole("heading", { level: 1 })).toContainText("Land Cruiser 300 GR Sport Executive");
      await expect(panel.getByRole("heading", { level: 1 })).toContainText("km");
      await expect(page.getByTestId("seller-module")).toBeHidden();
      await expect(page.getByTestId("listing-ref")).toBeHidden();
      await expect(page.getByTestId("seller-row")).toBeVisible(); // seller after description
      // revealed contact fits the board — phone primary + WhatsApp secondary
      await page.getByTestId("contact-reveal").click();
      await expect(page.getByTestId("contact-call")).toBeVisible();
      await expect(page.getByTestId("contact-whatsapp")).toBeVisible();
      const callBox = (await page.getByTestId("contact-call").boundingBox())!;
      expect(callBox.x + callBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
      await expectNoHorizontalOverflow(page);

      // 1024 flips back to the SEALED side-panel composition
      await page.setViewportSize({ width: 1024, height: 800 });
      await page.goto(`/elan/${rich.publicId}`);
      const sealedBox = (await page.getByTestId("identity-panel").boundingBox())!;
      expect(sealedBox.width).toBeGreaterThan(330);
      expect(sealedBox.width).toBeLessThan(350); // the sealed 340px panel
      await expect(page.getByTestId("seller-module")).toBeVisible();
      await expect(page.getByTestId("listing-ref")).toBeVisible();
      await expect(page.getByTestId("seller-row")).toBeHidden();
      await expect(page.getByTestId("detail-meta")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    } finally {
      if (modelId !== null) {
        await sql`update listings set model_id = ${s.corollaModelId} where id = ${rich.id}`;
        await sql`delete from models where id = ${modelId}`;
      }
      await sql`delete from listing_promotions where payment_id in (select id from payments where idempotency_key like 'o7c:%')`;
      await sql`delete from payments where idempotency_key like 'o7c:%'`;
      await sql.end();
    }
  });
});

test.describe("Listing detail — 390 mobile (4.17O.7 Stage D)", () => {
  test("mobile flow: top bar, swipe gallery, identity block, flowing content, sticky CTA", async ({ page }, { project }) => {
    test.skip(project.name !== "mobile", "mobile-only flow");
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`);
    // top bar replaces the breadcrumb; favorite lives there
    await expect(page.getByTestId("detail-back")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Naviqasiya yolu" })).toBeHidden();
    // full-bleed 4:3 swipe gallery with counter chip + segment progress
    const strip = page.getByTestId("gallery-mobile");
    const slideBox = (await page.getByTestId("gallery-slide-0").boundingBox())!;
    expect(Math.round(slideBox.width)).toBe(390); // full-bleed
    await expect(page.getByTestId("gallery-counter")).toHaveText("1 / 3");
    expect(await page.getByTestId("gallery-progress").locator("span").count()).toBe(3);
    // swipe (programmatic scroll = the same scroll-snap pathway)
    await strip.evaluate((el) => el.scrollTo({ left: el.clientWidth }));
    await expect(page.getByTestId("gallery-counter")).toHaveText("2 / 3");
    // tap opens the fullscreen swipe layer at the same index
    await page.getByTestId("gallery-slide-1").click();
    const overlay = page.getByTestId("gallery-fullscreen");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("2 / 3");
    await page.getByTestId("gallery-fullscreen-close").click();
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId("gallery-counter")).toHaveText("2 / 3"); // shared index
    // identity block: price, chip, title, meta
    await expect(page.getByTestId("detail-price")).toContainText("AZN");
    await expect(page.getByTestId("chip-credit")).toBeVisible();
    await expect(page.getByTestId("detail-meta")).toBeVisible();
    // flowing paper: 2-col tiles, seller row with report entry
    const tiles = page.getByTestId("key-specs").locator("> div");
    const t0 = (await tiles.nth(0).boundingBox())!;
    const t1 = (await tiles.nth(1).boundingBox())!;
    expect(t1.x).toBeGreaterThan(t0.x); // 2 columns
    expect(Math.round(t1.y)).toBe(Math.round(t0.y));
    await expect(page.getByTestId("seller-row")).toBeVisible();
    await expect(page.getByTestId("seller-module")).toBeHidden();
    // sticky white contact bar: fixed, 48px CTA + 48px favorite
    const bar = page.getByTestId("contact-card");
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    const cta = (await page.getByTestId("contact-reveal").boundingBox())!;
    expect(cta.height).toBeGreaterThanOrEqual(47);
    const stickyFav = bar.getByTestId("favorite-button");
    const favBox = (await stickyFav.boundingBox())!;
    expect(Math.round(favBox.width)).toBe(48);
    // reveal inside the bar: phone primary + WhatsApp secondary, no overflow
    await page.getByTestId("contact-reveal").click();
    await expect(page.getByTestId("contact-call")).toBeVisible();
    await expect(page.getByTestId("contact-whatsapp")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("all visible favorite instances synchronize immediately on toggle", async ({ page, context }, { project }) => {
    test.skip(project.name !== "mobile", "mobile shows two favorite instances");
    const s = seed();
    await loginAs(context, testPhone(project.name, 54));
    await page.goto(`/elan/${s.activeCar}`);
    const hearts = page.locator('[data-testid="favorite-button"]:visible');
    await expect(hearts).toHaveCount(2); // top bar + sticky bar
    await expect(hearts.first()).toHaveAttribute("data-favorited", "false");
    await expect(hearts.last()).toHaveAttribute("data-favorited", "false");
    await hearts.last().click(); // toggle in the sticky bar
    await expect(hearts.first()).toHaveAttribute("data-favorited", "true"); // top bar follows at once
    await expect(hearts.last()).toHaveAttribute("data-favorited", "true");
    await hearts.first().click(); // toggle back from the top bar
    await expect(hearts.last()).toHaveAttribute("data-favorited", "false");
  });

  test("SOLD and EXPIRED mobile states: status board, no sticky CTA, favorite per contract", async ({ page }, { project }) => {
    test.skip(project.name !== "mobile", "mobile status states");
    const s = seed();
    await page.goto(`/elan/${s.sold}`);
    await expect(page.getByTestId("status-chip")).toHaveText("Satılıb"); // on-hero chip
    await expect(page.getByTestId("limited-notice")).toContainText("Bu avtomobil satılıb");
    await expect(page.getByTestId("contact-card")).toHaveCount(0); // no sticky CTA
    await expect(page.locator('[data-testid="favorite-button"]:visible')).toHaveCount(0); // hidden on SOLD
    await expectNoHorizontalOverflow(page);
    await page.goto(`/elan/${s.expired}`);
    await expect(page.getByTestId("status-chip")).toHaveText("Müddəti bitib");
    await expect(page.getByTestId("limited-notice")).toContainText("Elanın müddəti bitib");
    await expect(page.getByTestId("contact-card")).toHaveCount(0);
    await expect(page.locator('[data-testid="favorite-button"]:visible')).toHaveCount(1); // top bar, per contract
    await expectNoHorizontalOverflow(page);
  });

  test("motorcycle mobile detail is category-correct: real fields, no CAR-only content, no Güc", async ({ page }, { project }) => {
    test.skip(project.name !== "mobile", "mobile moto state");
    const s = seed();
    await page.goto(`/elan/${s.motos[0]}`);
    await expect(page.getByTestId("detail-price")).toContainText("AZN");
    await expect(page.getByTestId("key-specs")).toContainText("Buraxılış ili");
    await expect(page.getByTestId("condition-claims")).toHaveCount(0);
    const detail = page.getByTestId("listing-detail");
    await expect(detail).not.toContainText("Güc");
    await expect(detail).not.toContainText("Ban növü");
    await expect(detail).not.toContainText("Ötürücü");
    await expectNoHorizontalOverflow(page);
  });

  test("worst-case content stays overflow-free at 360/375/390/414", async ({ page, context }, { project }) => {
    test.skip(project.name !== "desktop", "explicit viewport matrix; one project");
    const s = seed();
    const { userId } = await loginAs(context, testPhone("desktop", 55));
    const rich = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 9, noAccident: true, notRepainted: true });
    const sql = (await import("postgres")).default(s.databaseUrl, { prepare: false, max: 1 });
    let modelId: string | null = null;
    try {
      for (const type of ["PREMIUM", "BOOST"] as const) {
        await sql`
          with pay as (
            insert into payments (user_id, listing_id, type, amount_minor, idempotency_key, status, provider)
            values (${userId}, ${rich.id}, ${type}, 0, ${`o7d:${rich.id}:${type}`}, 'SUCCESS', 'KAPITAL')
            returning id
          )
          insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
          select ${rich.id}, ${type}, pay.id, now() - interval '1 hour', now() + interval '7 days', 'ACTIVE', 7, 0 from pay
        `;
      }
      const [m] = await sql`
        insert into models (brand_id, category_id, name, slug)
        values (${s.toyotaBrandId}, (select id from categories where code = 'CAR'),
                'Land Cruiser 300 GR Sport Executive', 'lc300-gr-sport-exec-o7d')
        returning id
      `;
      modelId = m.id as string;
      await sql`update listings set model_id = ${modelId}, credit_available = true, barter_available = true,
        description = ${Array.from({ length: 14 }, (_, i) => `Sətir ${i + 1}: avtomobil haqqında geniş məlumat və təchizat təsviri.`).join("\n")}
        where id = ${rich.id}`;
      await context.clearCookies();
      for (const width of [360, 375, 390, 414]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`/elan/${rich.publicId}`);
        await expect(page.getByTestId("detail-price")).toBeVisible();
        await expectNoHorizontalOverflow(page);
        if (width === 390) {
          // expanded description, revealed phone and fullscreen all stay in-viewport
          await page.getByTestId("description-toggle").click();
          await expectNoHorizontalOverflow(page);
          await page.getByTestId("contact-reveal").click();
          await expect(page.getByTestId("contact-call")).toBeVisible();
          await expectNoHorizontalOverflow(page);
          await page.getByTestId("gallery-slide-0").click();
          await expect(page.getByTestId("gallery-fullscreen")).toBeVisible();
          await expectNoHorizontalOverflow(page);
          await page.getByTestId("gallery-fullscreen-close").click();
        }
      }
    } finally {
      if (modelId !== null) {
        await sql`update listings set model_id = ${s.corollaModelId} where id = ${rich.id}`;
        await sql`delete from models where id = ${modelId}`;
      }
      await sql`delete from listing_promotions where payment_id in (select id from payments where idempotency_key like 'o7d:%')`;
      await sql`delete from payments where idempotency_key like 'o7d:%'`;
      await sql.end();
    }
  });
});

test.describe("Listing detail — fullscreen viewer (4.17O.8)", () => {
  test("hero click opens fullscreen at the current image; close keeps the index and returns focus", async ({ page }, { project }) => {
    test.skip(project.name === "mobile", "hero stage is md+");
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`); // 3 seeded images
    await page.getByTestId("gallery-next").click(); // browse to 2/3 first
    await expect(page.getByTestId("gallery-hero-counter")).toHaveText("2 / 3");
    await page.getByTestId("gallery-main").click();
    const overlay = page.getByTestId("gallery-fullscreen");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("2 / 3"); // opens at the CURRENT image
    await page.getByTestId("gallery-fullscreen-close").click();
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId("gallery-hero-counter")).toHaveText("2 / 3"); // index untouched by open/close
    await expect(page.getByTestId("gallery-main")).toBeFocused(); // focus returns to the trigger
  });

  test("ONE thumbnail click opens fullscreen directly at that image; close syncs the gallery", async ({ page, context }, { project }) => {
    test.skip(project.name === "mobile", "thumbnail rail is md+");
    const { userId } = await loginAs(context, testPhone(project.name, 56));
    const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 9 });
    await context.clearCookies();
    await page.goto(`/elan/${fixture.publicId}`);
    await page.getByTestId("gallery-thumb-3").click(); // ONE click — no hero detour
    const overlay = page.getByTestId("gallery-fullscreen");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("4 / 9"); // directly at that exact image
    // navigate inside the viewer, then close via the X button
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(overlay).toContainText("6 / 9");
    await page.getByTestId("gallery-fullscreen-close").click();
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId("gallery-hero-counter")).toHaveText("6 / 9"); // gallery follows the viewer
    await expect(page.getByTestId("gallery-thumb-3")).toBeFocused(); // focus returns to the triggering thumbnail
  });

  test("fullscreen navigation is sequential with disabled boundaries and no wrap", async ({ page }, { project }) => {
    test.skip(project.name === "mobile", "arrow buttons are md+");
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`);
    await page.getByTestId("gallery-main").click();
    const overlay = page.getByTestId("gallery-fullscreen");
    await expect(overlay).toBeVisible();
    const prev = overlay.getByRole("button", { name: "Əvvəlki şəkil" });
    const next = overlay.getByRole("button", { name: "Növbəti şəkil" });
    await expect(overlay).toContainText("1 / 3");
    await expect(prev).toBeDisabled(); // first image
    await page.keyboard.press("ArrowLeft"); // boundary keyboard no-op — no wrap to last
    await expect(overlay).toContainText("1 / 3");
    await next.click();
    await expect(overlay).toContainText("2 / 3");
    await next.click();
    await expect(overlay).toContainText("3 / 3");
    await expect(next).toBeDisabled(); // last image
    await page.keyboard.press("ArrowRight"); // boundary keyboard no-op — no wrap to first
    await expect(overlay).toContainText("3 / 3");
    await prev.click();
    await expect(overlay).toContainText("2 / 3");
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId("gallery-hero-counter")).toHaveText("2 / 3"); // Esc close-sync
  });

  test("body scroll is locked while the viewer is open and restored on close", async ({ page }, { project }) => {
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`);
    const before = await page.evaluate(() => document.body.style.overflow);
    if (project.name === "mobile") await page.getByTestId("gallery-slide-0").click();
    else await page.getByTestId("gallery-main").click();
    await expect(page.getByTestId("gallery-fullscreen")).toBeVisible();
    // the lock mechanism: body overflow hidden disables USER viewport
    // scrolling (programmatic scrollTo always bypasses overflow, so
    // the gesture check below uses a real wheel event)
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    if (project.name !== "mobile") {
      await page.mouse.wheel(0, 400); // real user wheel gesture
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); // two frames — scroll would have applied
      expect(await page.evaluate(() => window.scrollY)).toBe(0); // page did not move
    }
    // close via both pathways across tiers: X on mobile, Esc elsewhere
    if (project.name === "mobile") await page.getByTestId("gallery-fullscreen-close").click();
    else await page.keyboard.press("Escape");
    await expect(page.getByTestId("gallery-fullscreen")).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(before); // exact previous value restored
    if (project.name !== "mobile") {
      await page.mouse.wheel(0, 400);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0); // page scrolls again
    }
  });

  test("fullscreen presents the complete photo with explicit contain geometry", async ({ page }, { project }) => {
    test.skip(project.name !== "desktop", "geometry scenario; one project");
    const s = seed();
    // serve a deterministic tall PORTRAIT photo for every gallery image
    await page.route("**/api/dev-storage/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2400"><rect width="800" height="2400" fill="#22304a"/></svg>',
      }),
    );
    await page.goto(`/elan/${s.activeCar}`);
    // sealed O.7 normal hero stays cover-cropped
    const hero = page.getByTestId("gallery-main").locator("img");
    expect(await hero.evaluate((el) => getComputedStyle(el).objectFit)).toBe("cover");
    await page.getByTestId("gallery-main").click();
    const overlay = page.getByTestId("gallery-fullscreen");
    await expect(overlay).toBeVisible();
    const img = overlay.locator("img");
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe("contain");
    const viewport = page.viewportSize()!;
    const box = (await img.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(viewport.height * 0.86 + 1); // explicit viewport-safe max height
    expect(box.height).toBeGreaterThan(viewport.height * 0.5); // genuinely constrained, not collapsed
    expect(box.width / box.height).toBeCloseTo(800 / 2400, 1); // aspect preserved — the whole photo, no crop
  });

  test("a one-image listing opens the viewer with close only — no misleading navigation", async ({ page, context }, { project }) => {
    test.skip(project.name === "mobile", "hero entry is md+");
    const { userId } = await loginAs(context, testPhone(project.name, 57));
    const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 1 });
    await context.clearCookies();
    await page.goto(`/elan/${fixture.publicId}`);
    await expect(page.getByTestId("gallery-hero-counter")).toHaveCount(0); // single image: no counter (O.7 contract)
    await page.getByTestId("gallery-main").click();
    const overlay = page.getByTestId("gallery-fullscreen");
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Əvvəlki şəkil" })).toHaveCount(0);
    await expect(overlay.getByRole("button", { name: "Növbəti şəkil" })).toHaveCount(0);
    await page.getByTestId("gallery-fullscreen-close").click();
    await expect(overlay).toHaveCount(0);
  });

  test("SOLD and EXPIRED open fullscreen with only their one exposed image", async ({ page }, { project }) => {
    test.skip(project.name !== "desktop", "single-source scenario; one project");
    const s = seed();
    for (const id of [s.sold, s.expired]) {
      await page.goto(`/elan/${id}`);
      await page.getByTestId("gallery-main").click();
      const overlay = page.getByTestId("gallery-fullscreen");
      await expect(overlay).toBeVisible();
      await expect(overlay.getByRole("button", { name: "Əvvəlki şəkil" })).toHaveCount(0); // no navigation at all
      await expect(overlay.getByRole("button", { name: "Növbəti şəkil" })).toHaveCount(0);
      expect(await overlay.locator("img, [role=img]").count()).toBe(1); // ONLY the exposed primary image
      await page.keyboard.press("ArrowRight"); // no hidden extra image is reachable
      expect(await overlay.locator("img, [role=img]").count()).toBe(1);
      await page.keyboard.press("Escape");
      await expect(overlay).toHaveCount(0);
    }
  });

  test("mobile fullscreen swipe steps the shared index; close focuses a visible mobile element", async ({ page }, { project }) => {
    test.skip(project.name !== "mobile", "mobile viewer");
    const s = seed();
    await page.goto(`/elan/${s.activeCar}`);
    await page.getByTestId("gallery-slide-0").click();
    const overlay = page.getByTestId("gallery-fullscreen");
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText("1 / 3");
    const swipe = (from: number, to: number) =>
      overlay.evaluate((el, [a, b]) => {
        const touch = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
        el.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(a)], bubbles: true }));
        el.dispatchEvent(new TouchEvent("touchend", { changedTouches: [touch(b)], bubbles: true }));
      }, [from, to]);
    await swipe(300, 150); // swipe left → next
    await expect(overlay).toContainText("2 / 3");
    await swipe(150, 300); // swipe right → previous
    await expect(overlay).toContainText("1 / 3");
    await swipe(150, 300); // first-image boundary: no wrap
    await expect(overlay).toContainText("1 / 3");
    await swipe(300, 150);
    await expect(overlay).toContainText("2 / 3");
    await page.getByTestId("gallery-fullscreen-close").click();
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId("gallery-counter")).toHaveText("2 / 3"); // strip stays on the final viewer index
    // focus lands on the triggering slide — a visible MOBILE element, never the hidden desktop stage
    expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid ?? null)).toBe("gallery-slide-0");
    await expectNoHorizontalOverflow(page);
  });
});
