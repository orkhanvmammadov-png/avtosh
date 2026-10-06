/**
 * MANUAL MSM SMS smoke — sends exactly ONE fixed, non-secret test
 * SMS ("Avtosh.az test SMS", never an OTP) to the Owner's explicitly
 * supplied number, on the real production MSM account (there is no
 * test environment). Never runs in CI (refused when CI is set) and
 * never runs automatically during deployment — it is invoked only by
 * an operator shell with explicit opt-in:
 *
 *   MSM_SMOKE=1 MSM_SMOKE_CONFIRM=YES MSM_SMOKE_TO=+994XXXXXXXXX \
 *   MSM_USERNAME=... MSM_API_KEY=... \
 *   node scripts/sms/msm-smoke.mts
 *
 * Credentials come only from the local chmod-600 env file — never
 * chat, commits, logs or CI. Output contains only the numeric res
 * code and the provider message id (report that id to MSM for the
 * balance transfer); never the credentials, text destination beyond
 * what the operator supplied, or any URL with parameters.
 *
 * The run doubles as the live confirmation of the two undocumented
 * wire details (request root element and Content-Type) — a non-100
 * res or an HTTP error here means MSM must clarify those before the
 * adapter goes live.
 */
import { sendMsmSms } from "../../src/providers/sms/msm-otp-provider.ts";
import { MSM_SMOKE_TEXT, planMsmSmoke } from "./msm-smoke-guards.mts";

const decision = planMsmSmoke(process.env);
if (!decision.ok) {
  console.error(`Refusing to run: ${decision.reason}`);
  process.exit(1);
}

const result = await sendMsmSms({ phoneE164: decision.phoneE164, text: MSM_SMOKE_TEXT });
console.log("MSM send accepted (res=100).");
console.log(`  message id: ${result.messageId ?? "(none returned)"}`);
console.log("Acceptance is not handset delivery — confirm the SMS arrived on the phone.");
console.log("Report the message id to MSM to complete the balance transfer.");
