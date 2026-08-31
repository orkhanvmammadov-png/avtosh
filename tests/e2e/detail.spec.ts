import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";

test.describe("Listing detail", () => {
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
