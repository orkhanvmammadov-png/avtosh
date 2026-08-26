/**
 * OPTIONAL manual smoke test against the live Kapital Bank SANDBOX.
 * Never runs in CI. Requires explicit opt-in plus credentials from
 * the environment — nothing is committed or hard-coded:
 *
 *   KAPITAL_SANDBOX_SMOKE=1 \
 *   KAPITAL_API_BASE_URL=https://txpgtst.kapitalbank.az/api \
 *   KAPITAL_USERNAME=... KAPITAL_PASSWORD=... \
 *   node scripts/payments/kapital-sandbox-smoke.mts
 *
 * It creates a minimal Order_SMS order (no money moves until a card
 * pays on the HPP), prints the checkout URL for a MANUAL browser test
 * (test cards: see the official Kapital documentation — never paste
 * PAN/CVV into this repository or its logs), then reads the order
 * back via Get Order Details.
 */
import { createKapitalProvider, buildHppRedirect } from "../../src/providers/payments/kapital-provider.ts";

if (process.env.KAPITAL_SANDBOX_SMOKE !== "1") {
  console.error("Refusing to run: set KAPITAL_SANDBOX_SMOKE=1 plus KAPITAL_* env vars to opt in.");
  process.exit(1);
}

const provider = createKapitalProvider();

const created = await provider.createOrder({
  amountMajor: "0.01",
  currency: "AZN",
  language: "az",
  description: "AVTOSH sandbox smoke",
  redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/odenis/kapital/netice`,
});
console.log("create-order OK:");
console.log(`  provider order id: ${created.providerOrderId}`);
console.log(`  status:            ${created.status}`);
console.log(`  hppUrl host:       ${new URL(created.hppUrl).host}`);
console.log("checkout URL (open manually to test the HPP):");
console.log(`  ${buildHppRedirect(created.hppUrl, created.providerOrderId, created.hppSecret)}`);

const details = await provider.getOrderDetails(created.providerOrderId);
console.log("get-order-details OK:");
console.log(`  status: ${details.status}  amountMinor: ${details.amountMinor}  currency: ${details.currency}`);
console.log("Smoke test complete. No payment was executed.");
