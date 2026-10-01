/**
 * MANUAL smoke test against a live Kapital Bank merchant terminal
 * (test or PRODUCTION). Never runs in CI. Nothing is committed or
 * hard-coded; credentials come only from the local environment
 * (load them via the chmod-600 env-file workflow — never paste them
 * into chat, commits, logs, or CI).
 *
 * LEAK SAFETY: the checkout URL embeds the order password, so it is
 * NEVER printed to stdout/stderr (terminal output ends up in shell
 * history, CI logs, screenshots, chat). It is written to a chmod-600
 * file under ~/.avtosh/ instead; open it locally, then delete it.
 *
 * Create mode (default) — creates one Order_SMS and writes the HPP
 * URL to the private file. No money moves until a card pays on the
 * HPP. Against the PRODUCTION host this becomes a REAL charge the
 * moment a real card pays, so production use additionally requires
 * KAPITAL_SMOKE_CONFIRM_PRODUCTION=YES and an Owner-approved amount.
 *
 *   KAPITAL_SMOKE=1 \
 *   KAPITAL_API_BASE_URL=... KAPITAL_USERNAME=... KAPITAL_PASSWORD=... \
 *   [KAPITAL_SMOKE_AMOUNT=0.01] [KAPITAL_SMOKE_CONFIRM_PRODUCTION=YES] \
 *   node scripts/payments/kapital-smoke.mts
 *
 * Verify mode — re-reads an existing order (no order is created, no
 * URL is produced); use after the manual HPP payment to confirm the
 * authenticated status:
 *
 *   KAPITAL_SMOKE=1 KAPITAL_SMOKE_ORDER_ID=1234 ... node scripts/payments/kapital-smoke.mts
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createKapitalProvider, buildHppRedirect } from "../../src/providers/payments/kapital-provider.ts";

const PRODUCTION_HOST = "e-commerce.kapitalbank.az";
// Hard cap for a smoke order even with production confirmation.
const MAX_SMOKE_AMOUNT = 10;

if (process.env.KAPITAL_SMOKE !== "1") {
  console.error("Refusing to run: set KAPITAL_SMOKE=1 plus KAPITAL_* env vars to opt in.");
  process.exit(1);
}

const baseUrl = process.env.KAPITAL_API_BASE_URL ?? "";
const isProduction = baseUrl.includes(PRODUCTION_HOST);
if (isProduction && process.env.KAPITAL_SMOKE_CONFIRM_PRODUCTION !== "YES") {
  console.error(
    "Refusing production run: this targets the LIVE merchant terminal — a real card payment on the resulting HPP moves real money.",
  );
  console.error("Set KAPITAL_SMOKE_CONFIRM_PRODUCTION=YES only with Owner approval of amount and card.");
  process.exit(1);
}

const provider = createKapitalProvider();

const orderId = process.env.KAPITAL_SMOKE_ORDER_ID;
if (orderId !== undefined && orderId !== "") {
  // Verify mode: authenticated read only — the browser-visible STATUS
  // is never trusted; this is the authoritative check.
  const details = await provider.getOrderDetails(orderId);
  console.log("get-order-details OK:");
  console.log(`  provider order id: ${details.providerOrderId}`);
  console.log(`  status:            ${details.status}`);
  console.log(`  amountMinor:       ${details.amountMinor}  currency: ${details.currency}`);
  console.log("Reminder: only FullyPaid with the exact expected amount/currency counts as paid.");
  process.exit(0);
}

const amount = process.env.KAPITAL_SMOKE_AMOUNT ?? "0.01";
if (!/^\d{1,3}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > MAX_SMOKE_AMOUNT) {
  console.error(`Refusing amount "${amount}": must be a decimal in (0, ${MAX_SMOKE_AMOUNT}].`);
  process.exit(1);
}

const created = await provider.createOrder({
  amountMajor: amount,
  currency: "AZN",
  language: "az",
  description: "AVTOSH smoke",
  redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/odenis/kapital/netice`,
});

const privateDir = path.join(homedir(), ".avtosh");
mkdirSync(privateDir, { recursive: true, mode: 0o700 });
const urlFile = path.join(privateDir, "kapital-smoke-url.txt");
writeFileSync(urlFile, `${buildHppRedirect(created.hppUrl, created.providerOrderId, created.hppSecret)}\n`, {
  mode: 0o600,
});
chmodSync(urlFile, 0o600); // writeFileSync mode is ignored if the file existed

console.log("create-order OK:");
console.log(`  provider order id: ${created.providerOrderId}`);
console.log(`  status:            ${created.status}`);
console.log(`  hppUrl host:       ${new URL(created.hppUrl).host}`);
console.log("checkout URL: NOT printed (it contains the order password).");
console.log(`  written to ${urlFile} (chmod 600) — open it locally, pay manually, then DELETE the file.`);
console.log(
  `afterwards verify: KAPITAL_SMOKE=1 KAPITAL_SMOKE_ORDER_ID=${created.providerOrderId} ... node scripts/payments/kapital-smoke.mts`,
);
console.log("No payment was executed by this script.");
