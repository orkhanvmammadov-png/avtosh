import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, isMobile } from "./helpers";
import { forceOtpCode, KNOWN_OTP, loginAs, testPhone } from "./auth-helpers";

/**
 * Authentication UI flows against the real OTP endpoints. The stored
 * challenge hash is rewritten to a known code (server's own scheme +
 * the e2e pepper), so verification is genuine end to end.
 */

async function openMenuIfMobile(page: import("@playwright/test").Page, project: string) {
  if (isMobile(project)) {
    await page.getByTestId("mobile-menu-button").click();
  }
}

test("anonymous header shows login and routes to /giris", async ({ page }, { project }) => {
  await page.goto("/");
  await expect(page.getByTestId("header-anonymous")).toBeVisible();
  await openMenuIfMobile(page, project.name);
  await page.getByTestId(isMobile(project.name) ? "mobile-login" : "header-login").click();
  await expect(page).toHaveURL(/\/giris$/);
  await expect(page.getByTestId("login-flow")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("invalid phone shows Azerbaijani validation error and no OTP step", async ({ page }) => {
  await page.goto("/giris");
  await page.getByTestId("login-phone").fill("+1202555");
  await page.getByTestId("login-request").click();
  await expect(page.getByTestId("login-flow").getByRole("alert")).toContainText("Telefon nömrəsi düzgün deyil");
  await expect(page.getByTestId("login-otp")).toHaveCount(0);
});

test("full OTP login lands on profile and header becomes session-aware", async ({ page }, { project }) => {
  const phone = testPhone(project.name, 1);
  await page.goto("/giris");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-request").click();
  await expect(page.getByTestId("login-otp")).toBeVisible();
  await forceOtpCode(phone);
  await page.getByTestId("login-otp").fill(KNOWN_OTP);
  await page.getByTestId("login-verify").click();
  await expect(page).toHaveURL(/\/profil$/);
  await expect(page.getByTestId("profile-page")).toBeVisible();
  // masked phone, never the raw number
  await expect(page.getByTestId("profile-phone")).toContainText("•");
  await expect(page.getByTestId("profile-phone")).not.toContainText(phone.slice(4, -2));
  await expect(page.getByTestId("header-authed")).toBeVisible();
  if (!isMobile(project.name)) {
    await expect(page.getByTestId("header-login")).toHaveCount(0);
    await expect(page.getByTestId("header-profile")).toBeVisible();
  }
});

test("wrong OTP shows an error and correct code still works after it", async ({ page }, { project }) => {
  const phone = testPhone(project.name, 2);
  await page.goto("/giris");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-request").click();
  await forceOtpCode(phone);
  await page.getByTestId("login-otp").fill("000000");
  await page.getByTestId("login-verify").click();
  await expect(page.getByTestId("login-flow").getByRole("alert")).toContainText("Kod düzgün deyil");
  await page.getByTestId("login-otp").fill(KNOWN_OTP);
  await page.getByTestId("login-verify").click();
  await expect(page).toHaveURL(/\/profil$/);
});

test("resend is cooldown-gated, then issues a fresh working code", async ({ page }, { project }) => {
  const phone = testPhone(project.name, 3);
  await page.goto("/giris");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-request").click();
  const resend = page.getByTestId("login-resend");
  await expect(resend).toBeDisabled(); // cooldown countdown active
  await expect(resend).toBeEnabled({ timeout: 10_000 });
  await resend.click();
  // countdown text renders only after the resend RESPONSE (which also
  // clears the code field) — typing before it lands would be wiped
  await expect(resend).toContainText("Yenidən göndərmə");
  await forceOtpCode(phone); // rewrites the refreshed challenge code
  await page.getByTestId("login-otp").fill(KNOWN_OTP);
  await page.getByTestId("login-verify").click();
  await expect(page).toHaveURL(/\/profil$/);
});

test("protected pages redirect anonymous visitors into login with intent", async ({ page }) => {
  await page.goto("/profil");
  await expect(page).toHaveURL(/\/giris\?return_to=%2Fprofil$/);
  await page.goto("/profil/secilmisler");
  await expect(page).toHaveURL(/\/giris\?return_to=%2Fprofil%2Fsecilmisler$/);
  await page.goto("/elan-yerlesdir");
  await expect(page).toHaveURL(/\/giris\?return_to=%2Felan-yerlesdir$/);
});

test("login honors the protected-intent return_to", async ({ page }, { project }) => {
  const phone = testPhone(project.name, 4);
  await page.goto("/elan-yerlesdir");
  await expect(page).toHaveURL(/return_to=%2Felan-yerlesdir/);
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-request").click();
  await forceOtpCode(phone);
  await page.getByTestId("login-otp").fill(KNOWN_OTP);
  await page.getByTestId("login-verify").click();
  await expect(page).toHaveURL(/\/elan-yerlesdir$/);
  await expect(page.getByTestId("seller-stub")).toBeVisible();
});

test("an external return_to is never honored", async ({ page }, { project }) => {
  const phone = testPhone(project.name, 5);
  await page.goto("/giris?return_to=https%3A%2F%2Fevil.example%2Fphish");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-request").click();
  await forceOtpCode(phone);
  await page.getByTestId("login-otp").fill(KNOWN_OTP);
  await page.getByTestId("login-verify").click();
  await expect(page).toHaveURL(/localhost:3000\/profil$/);
});

test("already-authenticated visitors are bounced off /giris", async ({ page, context }, { project }) => {
  await loginAs(context, testPhone(project.name, 6));
  await page.goto("/giris");
  await expect(page).toHaveURL(/\/profil$/);
  await page.goto("/giris?return_to=%2Felanlar");
  await expect(page).toHaveURL(/\/elanlar$/);
});

test("logout clears the session everywhere", async ({ page, context }, { project }) => {
  await loginAs(context, testPhone(project.name, 7));
  await page.goto("/profil");
  await expect(page.getByTestId("profile-page")).toBeVisible();
  // The header instance is desktop-only; the profile page always has one.
  await page.locator('[data-testid="logout-button"]:visible').last().click();
  await expect(page).toHaveURL(/localhost:3000\/$/);
  await expect(page.getByTestId("header-anonymous")).toBeVisible();
  await page.goto("/profil");
  await expect(page).toHaveURL(/\/giris\?return_to=%2Fprofil$/);
});
