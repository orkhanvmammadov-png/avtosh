/**
 * MANUAL smoke test against a live Kapital Bank merchant terminal
 * (bank test or PRODUCTION). Never runs in CI. Credentials come only
 * from the local environment (chmod-600 env-file workflow — never
 * chat, commits, logs, or CI). All gating lives in
 * kapital-smoke-guards.mts and FAILS CLOSED; every requirement is
 * explicit regardless of host:
 *
 *   KAPITAL_SMOKE=1  — opt-in
 *   KAPITAL_API_BASE_URL — must be exactly one of the intended
 *     Kapital origins (validated as a URL origin, not a substring)
 *   KAPITAL_SMOKE_CONFIRM_PRODUCTION=YES — Owner approval, always
 *   KAPITAL_SMOKE_AMOUNT — explicit Owner-approved amount, no default
 *   NEXT_PUBLIC_APP_URL — explicit; HTTPS required for production
 *
 * LEAK SAFETY: the checkout URL embeds the order password, so it is
 * NEVER printed. It is written exclusively (O_EXCL, mode 0600) to
 * ~/.avtosh/kapital-smoke-url.txt; an existing file or symlink at
 * that path refuses the run BEFORE any order is created. Open the
 * file locally, pay manually, then DELETE it.
 *
 * Verify mode (no order is created, no URL produced):
 *   KAPITAL_SMOKE=1 KAPITAL_SMOKE_ORDER_ID=1234 ... node scripts/payments/kapital-smoke.mts
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createKapitalProvider, buildHppRedirect } from "../../src/providers/payments/kapital-provider.ts";
import { pathOccupied, planSmokeRun, writeUrlFileExclusive } from "./kapital-smoke-guards.mts";

const decision = planSmokeRun(process.env);
if (!decision.ok) {
  console.error(`Refusing to run: ${decision.reason}`);
  process.exit(1);
}
const plan = decision.plan;

const provider = createKapitalProvider();

if (plan.mode === "verify") {
  // Authenticated read only — the browser-visible STATUS is never
  // trusted; this is the authoritative check.
  const details = await provider.getOrderDetails(plan.orderId);
  console.log("get-order-details OK:");
  console.log(`  provider order id: ${details.providerOrderId}`);
  console.log(`  status:            ${details.status}`);
  console.log(`  amountMinor:       ${details.amountMinor}  currency: ${details.currency}`);
  console.log("Reminder: only FullyPaid with the exact expected amount/currency counts as paid.");
  process.exit(0);
}

const privateDir = path.join(homedir(), ".avtosh");
mkdirSync(privateDir, { recursive: true, mode: 0o700 });
const urlFile = path.join(privateDir, "kapital-smoke-url.txt");
// Refuse BEFORE creating an order — a payable artifact must never be
// produced if its URL cannot be stored safely.
if (pathOccupied(urlFile)) {
  console.error(`Refusing to run: ${urlFile} already exists (file or symlink). Delete it and re-run.`);
  process.exit(1);
}

const created = await provider.createOrder({
  amountMajor: plan.amountMajor,
  currency: "AZN",
  language: "az",
  description: "AVTOSH smoke",
  redirectUrl: plan.redirectUrl,
});

const written = writeUrlFileExclusive(
  urlFile,
  `${buildHppRedirect(created.hppUrl, created.providerOrderId, created.hppSecret)}\n`,
);

console.log("create-order OK:");
console.log(`  provider order id: ${created.providerOrderId}`);
console.log(`  status:            ${created.status}`);
console.log(`  hppUrl host:       ${new URL(created.hppUrl).host}`);
if (!written.ok) {
  // Race lost after the pre-check: the URL is deliberately NOT
  // printed. The unpaid order simply expires at the bank.
  console.error(written.reason);
  console.error("The checkout URL was withheld; the unpaid order will expire. Delete the file and re-run.");
  process.exit(1);
}
console.log("checkout URL: NOT printed (it contains the order password).");
console.log(`  written to ${urlFile} (0600, exclusive) — open locally, pay manually, then DELETE the file.`);
console.log(
  `afterwards verify: KAPITAL_SMOKE=1 KAPITAL_SMOKE_ORDER_ID=${created.providerOrderId} ... node scripts/payments/kapital-smoke.mts`,
);
console.log("No payment was executed by this script.");
