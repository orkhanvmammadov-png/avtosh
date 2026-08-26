import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loginAs, testPhone } from "./auth-helpers";
import { insertListingFixture, listingStatus, paymentInfoForListing } from "./seller-helpers";

/**
 * Kapital Bank checkout against the dev fake provider. The REAL
 * adapter runs over HTTP; the fake HPP simulates only outcomes. The
 * invariant under test everywhere: browser callback STATUS is inert —
 * only the app's server-to-server verification moves state.
 */

const fakeOrderFile = (orderId: string) =>
  path.join(process.cwd(), ".dev-storage", "kapital", `${orderId}.json`);

async function paymentRequiredFixture(page: Page, project: string, slot: number) {
  const { userId } = await loginAs(page.context(), testPhone(project, slot));
  const fixture = await insertListingFixture(userId, {
    status: "PAYMENT_REQUIRED",
    complete: true,
    images: 3,
    feeMinor: 200,
  });
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await expect(page.getByTestId("wizard-status-payment")).toBeVisible();
  await expect(page.getByTestId("payment-intent-amount")).toHaveText("2 AZN");
  return { userId, fixture };
}

async function startCheckout(page: Page) {
  await page.getByTestId("pay-button").click();
  await page.waitForURL(/\/api\/dev-kapital\/hpp\?/);
  await expect(page.getByTestId("fake-hpp-amount")).toHaveText("2.00 AZN");
}

test("full paid flow: checkout → HPP pay → verified success → PENDING_MODERATION", async ({ page }, { project }) => {
  const { fixture } = await paymentRequiredFixture(page, project.name, 60);
  await startCheckout(page);
  await page.getByTestId("fake-hpp-pay").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  // the callback URL carries the untrusted STATUS hint...
  expect(page.url()).toContain("STATUS=FullyPaid");
  // ...but the rendered SUCCESS comes from server-side verification
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
  expect(await listingStatus(fixture.id)).toBe("PENDING_MODERATION");
  const info = await paymentInfoForListing(fixture.id);
  expect(info.paymentStatus).toBe("SUCCESS");
  expect(info.activeAttempts).toBe(0);
  expect(info.moderationOutbox).toBe(1);
  await page.getByTestId("payment-my-listings").click();
  await expect(
    page.locator('[data-testid="owner-listing-card"][data-status="PENDING_MODERATION"]').first(),
  ).toBeVisible();
});

test("tampered callback STATUS cannot fulfill an unpaid order", async ({ page }, { project }) => {
  const { fixture } = await paymentRequiredFixture(page, project.name, 61);
  await startCheckout(page); // order exists at the provider, still Preparing
  const info = await paymentInfoForListing(fixture.id);
  expect(info.providerOrderId).not.toBeNull();
  // forged/tampered return: STATUS=FullyPaid while the provider truth is Preparing
  await page.goto(`/odenis/kapital/netice?ID=${info.providerOrderId}&STATUS=FullyPaid`);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "PENDING");
  expect(await listingStatus(fixture.id)).toBe("PAYMENT_REQUIRED");
  expect((await paymentInfoForListing(fixture.id)).paymentStatus).toBe("PENDING");
  expect((await paymentInfoForListing(fixture.id)).moderationOutbox).toBe(0);
});

test("provider-confirmed payment with a wrong amount never fulfills", async ({ page }, { project }) => {
  const { fixture } = await paymentRequiredFixture(page, project.name, 62);
  await startCheckout(page);
  const info = await paymentInfoForListing(fixture.id);
  // corrupt the provider-side order: paid, but 3.00 instead of 2.00
  const file = fakeOrderFile(info.providerOrderId!);
  const order = JSON.parse(readFileSync(file, "utf8")) as { status: string; amount: string };
  order.status = "FullyPaid";
  order.amount = "3.00";
  writeFileSync(file, JSON.stringify(order));
  await page.goto(`/odenis/kapital/netice?ID=${info.providerOrderId}&STATUS=FullyPaid`);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "MISMATCH");
  // seller sees the safe pending copy — never told to pay again
  await expect(page.getByTestId("payment-result")).toContainText("Ödəniş hələ təsdiqlənməyib");
  expect(await listingStatus(fixture.id)).toBe("PAYMENT_REQUIRED");
  expect((await paymentInfoForListing(fixture.id)).paymentStatus).toBe("PENDING");
});

test("callback refreshes never duplicate fulfillment", async ({ page }, { project }) => {
  const { fixture } = await paymentRequiredFixture(page, project.name, 63);
  await startCheckout(page);
  await page.getByTestId("fake-hpp-pay").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
  const first = await paymentInfoForListing(fixture.id);
  for (let i = 0; i < 3; i += 1) {
    await page.reload();
    await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
  }
  const after = await paymentInfoForListing(fixture.id);
  expect(after.moderationOutbox).toBe(first.moderationOutbox);
  expect(after.historyRows).toBe(first.historyRows);
  expect(after.moderationOutbox).toBe(1);
});

test("leaving the HPP keeps a safe pending state and checkout is reused on return", async ({ page }, { project }) => {
  const { fixture } = await paymentRequiredFixture(page, project.name, 64);
  await startCheckout(page);
  const before = await paymentInfoForListing(fixture.id);
  // seller abandons the payment page and returns to the listing
  await page.goto(`/elan-yerlesdir/${fixture.id}`);
  await expect(page.getByTestId("wizard-status-payment")).toBeVisible();
  await expect(page.getByTestId("pay-button")).toBeVisible();
  await startCheckout(page); // same active order — no new provider attempt
  expect(page.url()).toContain(`id=${before.providerOrderId}`);
  const after = await paymentInfoForListing(fixture.id);
  expect(after.providerOrderId).toBe(before.providerOrderId);
  expect(after.activeAttempts).toBe(1);
});

test("declined payment shows retry and a fresh checkout succeeds", async ({ page }, { project }) => {
  const { fixture } = await paymentRequiredFixture(page, project.name, 65);
  await startCheckout(page);
  const firstOrder = (await paymentInfoForListing(fixture.id)).providerOrderId;
  await page.getByTestId("fake-hpp-decline").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "RETRYABLE");
  expect((await paymentInfoForListing(fixture.id)).paymentStatus).toBe("CREATED");
  await page.getByTestId("payment-retry").click();
  await expect(page.getByTestId("wizard-status-payment")).toBeVisible();
  await startCheckout(page);
  expect(page.url()).not.toContain(`id=${firstOrder}`); // a NEW provider order
  await page.getByTestId("fake-hpp-pay").click();
  await page.waitForURL(/\/odenis\/kapital\/netice\?/);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
  expect(await listingStatus(fixture.id)).toBe("PENDING_MODERATION");
});

test("provider verification outage shows a safe checking state and changes nothing", async ({ page }, { project }) => {
  const { fixture } = await paymentRequiredFixture(page, project.name, 66);
  await startCheckout(page);
  const info = await paymentInfoForListing(fixture.id);
  const file = fakeOrderFile(info.providerOrderId!);
  renameSync(file, `${file}.hidden`); // provider "loses" the order → contract failure
  try {
    await page.goto(`/odenis/kapital/netice?ID=${info.providerOrderId}&STATUS=FullyPaid`);
    await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "CHECK_FAILED");
    await expect(page.getByTestId("payment-check-again")).toBeVisible();
    expect((await paymentInfoForListing(fixture.id)).paymentStatus).toBe("PENDING");
  } finally {
    renameSync(`${file}.hidden`, file);
  }
  // recovery: the same "check again" path verifies once the provider is back
  const order = JSON.parse(readFileSync(file, "utf8")) as { status: string };
  order.status = "FullyPaid";
  writeFileSync(file, JSON.stringify(order));
  await page.getByTestId("payment-check-again").click();
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "SUCCESS");
});

test("a foreign or unknown order id gets one generic answer", async ({ page, context }, { project }) => {
  const victim = await paymentRequiredFixture(page, project.name, 67);
  await startCheckout(page);
  const info = await paymentInfoForListing(victim.fixture.id);
  await context.clearCookies();
  await loginAs(context, testPhone(project.name, 68));
  await page.goto(`/odenis/kapital/netice?ID=${info.providerOrderId}&STATUS=FullyPaid`);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "UNKNOWN_ORDER");
  await page.goto(`/odenis/kapital/netice?ID=nonexistent-123&STATUS=FullyPaid`);
  await expect(page.getByTestId("payment-result")).toHaveAttribute("data-state", "UNKNOWN_ORDER");
  expect((await paymentInfoForListing(victim.fixture.id)).paymentStatus).toBe("PENDING");
});
