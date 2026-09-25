import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, isMobile } from "./helpers";

// Public legal pages: readable logged-out, footer-linked, cross-linked.
const PAGES = [
  { path: "/istifadeci-razilasmasi", title: "İstifadəçi razılaşması" },
  { path: "/qaydalar", title: "Qaydalar" },
  { path: "/mexfilik-siyaseti", title: "Məxfilik siyasəti" },
] as const;

for (const { path, title } of PAGES) {
  test(`${path} renders the approved document without login`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
    await expect(page.getByText("Versiya:")).toBeVisible();
    await expect(page.getByText("Son yenilənmə tarixi:")).toBeVisible();
    await expect(page.getByText("1.2", { exact: false }).first()).toBeVisible();
  });
}

test("footer links to all three legal pages and navigates", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByTestId("footer-terms")).toHaveAttribute("href", "/istifadeci-razilasmasi");
  await expect(footer.getByTestId("footer-rules")).toHaveAttribute("href", "/qaydalar");
  await expect(footer.getByTestId("footer-privacy")).toHaveAttribute("href", "/mexfilik-siyaseti");
  await footer.getByTestId("footer-rules").click();
  await expect(page).toHaveURL(/\/qaydalar$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Qaydalar");
});

test("documents cross-link each other", async ({ page }) => {
  await page.goto("/istifadeci-razilasmasi");
  const article = page.getByTestId("legal-istifadeci-razilasmasi");
  await article.locator('a[href="/mexfilik-siyaseti"]').first().click();
  await expect(page).toHaveURL(/\/mexfilik-siyaseti$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Məxfilik siyasəti");
  await page
    .getByTestId("legal-mexfilik-siyaseti")
    .locator('a[href="/qaydalar"]')
    .first()
    .click();
  await expect(page).toHaveURL(/\/qaydalar$/);
});

test("legal pages have no horizontal overflow", async ({ page }, testInfo) => {
  for (const { path } of PAGES) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  }
  // The privacy policy tables scroll inside their own wrapper on mobile.
  if (isMobile(testInfo.project.name)) {
    await page.goto("/mexfilik-siyaseti");
    await expect(page.locator("table").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
});
