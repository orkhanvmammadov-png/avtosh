import { expect, test } from "@playwright/test";
import { seed } from "./helpers";

// SEO foundation: robots + sitemap responses and the corrected bare
// /elanlar title, against the real dev server and seeded database.

test.describe("SEO foundation", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "response-level checks; one project");
  });

  test("robots.txt responds with the crawl policy and the sitemap pointer", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("User-Agent: *");
    expect(body).toContain("Disallow: /api/");
    expect(body).toMatch(/Sitemap: .+\/sitemap\.xml/);
    expect(body).not.toContain("Disallow: /profil");
    expect(body).not.toContain("Disallow: /odenis");
  });

  test("sitemap.xml is valid XML containing static pages and a seeded ACTIVE listing", async ({ request }) => {
    const s = seed();
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("xml");
    const body = await response.text();
    expect(body).toContain("<?xml");
    expect(body).toContain("<urlset");
    expect(body).toContain("/elanlar?category=CAR");
    expect(body).toContain(`/elan/${s.activeCar}`);
    expect(body).toContain("</urlset>");
  });

  test("bare /elanlar titles as the default CAR listing page", async ({ page }) => {
    await page.goto("/elanlar");
    await expect(page).toHaveTitle("Avtomobil elanları — AVTOSH.AZ");
    await expect(page.locator("h1")).toHaveText("Avtomobil elanları");
  });
});
