import { expect, test } from "@playwright/test";

/**
 * Phase 4.17O.1 — deterministic captures of the Azerbaijani local
 * phone step (artifacts only; test-results/visual-review is
 * gitignored). Not a pixel-diff regression system.
 */
const OUT = "test-results/visual-review";

test.describe("auth phone visual artifacts", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "captures set explicit viewports");
  });

  for (const [name, width, height] of [
    ["auth-phone-mobile-390", 390, 844],
    ["auth-phone-tablet-768", 768, 1024],
    ["auth-phone-desktop-1440", 1440, 900],
  ] as const) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/giris");
      const input = page.getByTestId("login-phone");
      await input.click();
      await input.pressSequentially("0102184191");
      await expect(input).toHaveValue("010 218 41 91");
      await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    });
  }

  test("auth-phone-error-390", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/giris");
    await page.getByTestId("login-phone").fill("+1202555");
    await page.getByTestId("login-request").click();
    await expect(page.getByTestId("login-flow").getByRole("alert")).toBeVisible();
    await page.screenshot({ path: `${OUT}/auth-phone-error-390.png`, fullPage: true });
  });

  test("auth-otp-destination-390", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/giris");
    const input = page.getByTestId("login-phone");
    await input.click();
    await input.pressSequentially("0508810099");
    await page.getByTestId("login-request").click();
    await expect(page.getByTestId("login-otp")).toBeVisible();
    await expect(page.getByTestId("login-flow")).toContainText("050 881 00 99");
    await page.screenshot({ path: `${OUT}/auth-otp-destination-390.png`, fullPage: true });
  });
});
