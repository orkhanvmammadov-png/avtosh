# Auth API Contract (v1)

Passwordless WhatsApp-OTP authentication. Standard envelope and
`X-Request-ID` echo apply (see `catalog.md`). Design notes in
`../architecture/authentication.md`.

Account-enumeration resistance: OTP request/resend behave identically
for new and existing phones; no endpoint reveals whether an account
exists before successful verification.

## POST /api/v1/auth/otp/request

```json
{ "phone": "050 123 45 67", "return_to": "/elan/48291" }
```

`phone`: any reasonable format; normalized to E.164 (AZ default
region). `return_to`: optional, validated later at verify.

`200`:
```json
{ "data": { "challenge_id": "<uuid>", "expires_in_seconds": 300, "resend_after_seconds": 45 } }
```

Errors: `AUTH_INVALID_PHONE` 400 · `OTP_RATE_LIMITED` 429 (per-phone
interval/hourly cap, per-IP cap; details may carry
`retry_after_seconds`) · `INTERNAL_ERROR` 502 when delivery fails
(the challenge is voided — request again).

## POST /api/v1/auth/otp/resend

```json
{ "challenge_id": "<uuid>" }
```

Rotates the code inside the same challenge (old code becomes
invalid). `200` returns the same shape as request with remaining
`expires_in_seconds`. Errors: `OTP_RESEND_TOO_SOON` 429 ·
`OTP_RATE_LIMITED` 429 (resend limit) · `OTP_EXPIRED` 400 ·
`OTP_INVALID` 400 · `OTP_LOCKED` 400.

## POST /api/v1/auth/otp/verify

```json
{ "challenge_id": "<uuid>", "otp": "123456", "return_to": "/profile" }
```

On success, sets the `avtosh_session` cookie (HttpOnly, SameSite=Lax,
Secure in production, 30 days) and returns:

```json
{
  "data": {
    "user": { "id": "<uuid>", "displayName": null, "phoneMasked": "+994•••••••67", "status": "ACTIVE", "roles": ["USER"] },
    "return_to": "/profile"
  }
}
```

`return_to` is the validated internal path or `null` — clients must
never navigate to anything else. Errors: `OTP_INVALID` 400 (wrong,
unknown, or already-used) · `OTP_EXPIRED` 400 · `OTP_LOCKED` 400 ·
`VALIDATION_ERROR` 400.

## GET /api/v1/auth/me

Authenticated. `200` `{ "data": { "user": { …same DTO } } }`.
`AUTH_REQUIRED` 401 without a valid session. BLOCKED users receive
their DTO with `"status": "BLOCKED"`.

## POST /api/v1/auth/logout

Authenticated intent, but idempotent: always clears the cookie;
revokes the presented session if valid. Same-origin enforced
(`FORBIDDEN_ORIGIN` 403 on cross-origin attempts). `200`
`{ "data": { "logged_out": true } }`.

## Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `AUTH_INVALID_PHONE` | 400 | Phone failed normalization/validation |
| `OTP_INVALID` | 400 | Wrong, unknown, superseded-consumed, or reused code/challenge |
| `OTP_EXPIRED` | 400 | Challenge past its TTL or superseded |
| `OTP_LOCKED` | 400 | Too many failed attempts on the challenge |
| `OTP_RESEND_TOO_SOON` | 429 | Resend cooldown active |
| `OTP_RATE_LIMITED` | 429 | Phone/IP window or resend limit reached |
| `AUTH_REQUIRED` | 401 | No valid session |
| `FORBIDDEN_ORIGIN` | 403 | Cross-origin mutation rejected |
