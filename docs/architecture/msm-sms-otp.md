# MSM Technologies SMS — OTP delivery

Owner decision: the production OTP channel is SMS via MSM
Technologies (replacing the originally planned WhatsApp BSP; the
provider seam `WhatsAppOtpProvider` predates the decision and keeps
its name). OTP generation, hashing, rate limits, verification,
sessions, the public API contract and the READ_ONLY gate are
unchanged — the adapter only delivers.

## Owner-confirmed contract (2026-10)

- Host `v1.msm.az` (replaces `api.msm.az`); HTTPS supported;
  username/API key unchanged. MSM transfers the existing balance
  after a successful test request is reported to them.
- XML response format unchanged:
  `<SMS-Response><STATUS res="100" restxt="OK" id="…"/></SMS-Response>`.
- Recipient is 9 local digits (`50XXXXXXX`): the adapter converts
  canonical `+994XXXXXXXXX` exactly once and refuses anything else.
- Sender name exactly `Avtosh.az` (config default).
- Testing happens on the real production account — there is no test
  environment; every accepted send is chargeable.

## Adapter (src/providers/sms/msm-otp-provider.ts)

HTTPS POST to `https://v1.msm.az/sendsms` (endpoint hardcoded —
never the legacy HTTP GET, never credentials or the OTP in URL
parameters, `redirect: "error"` so nothing can re-send them to
another host). XML attributes are escaped; the OTP text is
ASCII-only pending MSM's UTF-8 confirmation. `res="100"` means
PROVIDER ACCEPTANCE, never handset delivery — delivery is proven by
the user entering the code; delivery-status polling (`/query/*`) is
deliberately not integrated. Every other code, malformed response,
HTTP error or timeout fails closed, and a send is NEVER retried
(an ambiguous timeout may already have been accepted — a retry
would double-charge and double-deliver). Logs carry only the
numeric `res` and the provider message id — never the OTP, XML,
credentials or full phone number.

Selection: `OTP_SMS_PROVIDER=msm` (explicit opt-in) plus
`MSM_USERNAME` / `MSM_API_KEY` (server-side secrets only: local
chmod-600 env file and the Vercel **Production** secret environment
— never Preview, never git, never chat) and optional `MSM_SENDER`
(default `Avtosh.az`) / `MSM_TIMEOUT_MS` (default 10 s). Without the
opt-in, production OTP still fails loudly and dev/test keep the
dev/in-memory providers.

## Delivery-failure recovery (verified behavior)

On a definitive send failure the challenge is EXPIRED and the user
sees a generic failure. Resend and verify on that challenge return
`OTP_EXPIRED` — resend is NOT the recovery path. A FRESH request is,
and it remains subject to `OTP_MIN_INTERVAL_SECONDS` (default 45 s)
and the hourly quotas — the failed challenge still counts, so
delivery failures cannot grind the rate limits. Pinned by
`tests/integration/otp-delivery-failure.test.ts`.

## Wire details the first controlled live test must confirm

The request root element is `<SMS-InsRequest>` — Owner-confirmed
from the supplied MSM contract and pinned by an exact-structure
test. Still unverified: the accepted
`Content-Type` (`application/xml; charset=utf-8` chosen), UTF-8
handling of Azerbaijani characters in `text`, the exact v1 error
response shapes, and the `/query/single` `username={apiusername}i`
trailing "i" (presumed typo; `/query/*` is unused here). A non-100
`res` or HTTP error on the smoke means MSM must clarify before
go-live.

## Controlled production UAT (Owner-run)

1. Put `MSM_USERNAME` / `MSM_API_KEY` in the local chmod-600 env
   file.
2. Send exactly ONE fixed, non-secret test SMS (never an OTP) to
   your own number:
   `MSM_SMOKE=1 MSM_SMOKE_CONFIRM=YES MSM_SMOKE_TO=+994XXXXXXXXX node scripts/sms/msm-smoke.mts`
   (refused in CI and without each explicit value). Confirm the SMS
   arrives on the handset; note the printed message id.
3. Report that message id to MSM so they transfer the balance; then
   repeat one smoke to confirm post-transfer sending.
4. Live login UAT (request → receive → verify → session) stays
   blocked while `LAUNCH_MODE=READ_ONLY` (the OTP routes correctly
   return 503) — it runs only after the reviewed FULL release, with
   `OTP_SMS_PROVIDER=msm` and the secrets set in the Vercel
   Production environment.
