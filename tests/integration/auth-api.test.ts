import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { hashSessionToken } from "@/auth/otp-crypto";
import {
  createMemoryWhatsAppProvider,
  type MemoryWhatsAppProvider,
} from "@/providers/whatsapp/memory-provider";
import { setWhatsAppOtpProviderForTesting } from "@/providers/whatsapp/factory";
import { POST as otpRequestRoute } from "@/app/api/v1/auth/otp/request/route";
import { POST as otpResendRoute } from "@/app/api/v1/auth/otp/resend/route";
import { POST as otpVerifyRoute } from "@/app/api/v1/auth/otp/verify/route";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";

const BASE = "http://localhost/api/v1/auth";

let provider: MemoryWhatsAppProvider;
let phoneCounter = 2_000_000;

function nextPhone(): string {
  phoneCounter += 1;
  return `+99450${phoneCounter}`;
}

interface Envelope {
  data?: Record<string, unknown>;
  error?: { code: string; message: string; request_id: string };
}

async function post(
  route: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Envelope; response: Response }> {
  const response = await route(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as Envelope,
    response,
  };
}

function cookieToken(response: Response): string {
  const header = response.headers.get("set-cookie");
  expect(header).toBeTruthy();
  const match = /avtosh_session=([^;]*)/.exec(header ?? "");
  expect(match).toBeTruthy();
  return match![1];
}

async function requestChallenge(
  phone: string,
  headers: Record<string, string> = {},
): Promise<{ challengeId: string; code: string }> {
  const { status, body } = await post(otpRequestRoute, "/otp/request", { phone }, headers);
  expect(status).toBe(200);
  const challengeId = body.data?.challenge_id as string;
  const code = provider.lastCodeFor(
    // provider receives the normalized phone
    phone.startsWith("+") ? phone : `+994${phone.replace(/^0/, "")}`,
  );
  expect(code).toBeTruthy();
  return { challengeId, code: code! };
}

async function login(
  phone: string,
): Promise<{ token: string; userId: string; response: Response }> {
  const { challengeId, code } = await requestChallenge(phone);
  const { status, body, response } = await post(otpVerifyRoute, "/otp/verify", {
    challenge_id: challengeId,
    otp: code,
  });
  expect(status).toBe(200);
  const user = body.data?.user as { id: string };
  return { token: cookieToken(response), userId: user.id, response };
}

async function withEnv<T>(
  overrides: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  provider = createMemoryWhatsAppProvider();
  setWhatsAppOtpProviderForTesting(provider);
});

beforeEach(() => {
  provider.reset();
});

afterAll(async () => {
  setWhatsAppOtpProviderForTesting(null);
  await closeSql();
});

describe("POST /auth/otp/request", () => {
  it("creates a hashed challenge and returns the generic shape", async () => {
    const phone = nextPhone();
    const { status, body } = await post(otpRequestRoute, "/otp/request", { phone });
    expect(status).toBe(200);
    expect(Object.keys(body.data ?? {}).sort()).toEqual([
      "challenge_id",
      "expires_in_seconds",
      "resend_after_seconds",
    ]);
    const code = provider.lastCodeFor(phone)!;
    expect(code).toMatch(/^[0-9]{6}$/);
    const sql = getSql();
    const [row] = await sql<{ code_hash: string; status: string }[]>`
      select code_hash, status from otp_challenges
      where id = ${body.data?.challenge_id as string}
    `;
    expect(row.status).toBe("PENDING");
    expect(row.code_hash).not.toContain(code);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes local phone formats before storing", async () => {
    await post(otpRequestRoute, "/otp/request", { phone: "051 234 56 78" });
    const sql = getSql();
    const rows = await sql`
      select 1 from otp_challenges where phone_e164 = '+994512345678'
    `;
    expect(rows.length).toBe(1);
  });

  it("responds identically for new and existing phones (no enumeration)", async () => {
    const existing = nextPhone();
    await login(existing); // becomes an existing user
    const fresh = nextPhone();
    const a = await post(otpRequestRoute, "/otp/request", { phone: existing });
    const b = await post(otpRequestRoute, "/otp/request", { phone: fresh });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Object.keys(a.body.data ?? {}).sort()).toEqual(
      Object.keys(b.body.data ?? {}).sort(),
    );
  });

  it("rejects malformed phone numbers generically", async () => {
    const { status, body } = await post(otpRequestRoute, "/otp/request", {
      phone: "12345",
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe("AUTH_INVALID_PHONE");
  });

  it("enforces the per-phone minimum interval", async () => {
    await withEnv({ OTP_MIN_INTERVAL_SECONDS: "60" }, async () => {
      const phone = nextPhone();
      const first = await post(otpRequestRoute, "/otp/request", { phone });
      expect(first.status).toBe(200);
      const second = await post(otpRequestRoute, "/otp/request", { phone });
      expect(second.status).toBe(429);
      expect(second.body.error?.code).toBe("OTP_RATE_LIMITED");
    });
  });

  it("enforces the hourly per-phone cap", async () => {
    const phone = nextPhone();
    for (let i = 0; i < 5; i += 1) {
      const { status } = await post(otpRequestRoute, "/otp/request", { phone });
      expect(status).toBe(200);
    }
    const sixth = await post(otpRequestRoute, "/otp/request", { phone });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error?.code).toBe("OTP_RATE_LIMITED");
  });

  it("enforces the hourly per-IP cap using a hashed IP", async () => {
    await withEnv({ OTP_IP_MAX_PER_HOUR: "2" }, async () => {
      const headers = { "x-forwarded-for": "198.51.100.77" };
      expect((await post(otpRequestRoute, "/otp/request", { phone: nextPhone() }, headers)).status).toBe(200);
      expect((await post(otpRequestRoute, "/otp/request", { phone: nextPhone() }, headers)).status).toBe(200);
      const third = await post(otpRequestRoute, "/otp/request", { phone: nextPhone() }, headers);
      expect(third.status).toBe(429);
      const sql = getSql();
      const raw = await sql`
        select 1 from otp_challenges where ip_hash = '198.51.100.77'
      `;
      expect(raw.length).toBe(0); // raw IP is never stored
    });
  });

  it("expires the challenge when provider delivery fails", async () => {
    provider.failNext = true;
    const phone = nextPhone();
    const { status, body } = await post(otpRequestRoute, "/otp/request", { phone });
    expect(status).toBe(502);
    expect(body.error?.code).toBe("INTERNAL_ERROR");
    const sql = getSql();
    const rows = await sql<{ status: string }[]>`
      select status from otp_challenges where phone_e164 = ${phone}
    `;
    expect(rows.every((row) => row.status === "EXPIRED")).toBe(true);
  });

  it("supersedes previous pending challenges", async () => {
    const phone = nextPhone();
    const first = await requestChallenge(phone);
    const second = await requestChallenge(phone);
    const stale = await post(otpVerifyRoute, "/otp/verify", {
      challenge_id: first.challengeId,
      otp: first.code,
    });
    expect(stale.status).toBe(400);
    expect(stale.body.error?.code).toBe("OTP_EXPIRED");
    const fresh = await post(otpVerifyRoute, "/otp/verify", {
      challenge_id: second.challengeId,
      otp: second.code,
    });
    expect(fresh.status).toBe(200);
  });
});

describe("POST /auth/otp/verify", () => {
  it("authenticates, creates the user with USER role, sets the cookie", async () => {
    const phone = nextPhone();
    const { challengeId, code } = await requestChallenge(phone);
    const { status, body, response } = await post(otpVerifyRoute, "/otp/verify", {
      challenge_id: challengeId,
      otp: code,
      return_to: "/profile/listings",
    });
    expect(status).toBe(200);
    expect(body.data?.return_to).toBe("/profile/listings");

    const user = body.data?.user as Record<string, unknown>;
    expect(user.status).toBe("ACTIVE");
    expect(user.roles).toEqual(["USER"]);
    expect(user.phoneMasked).not.toContain(phone.slice(5, 11));

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("avtosh_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Secure"); // test env is not production

    const token = cookieToken(response);
    const sql = getSql();
    const sessions = await sql<{ token_hash: string }[]>`
      select token_hash from sessions where user_id = ${user.id as string}
    `;
    expect(sessions.length).toBe(1);
    expect(sessions[0].token_hash).toBe(hashSessionToken(token));
    expect(sessions[0].token_hash).not.toBe(token); // only the hash is stored
    const [challenge] = await sql<{ status: string }[]>`
      select status from otp_challenges where id = ${challengeId}
    `;
    expect(challenge.status).toBe("VERIFIED");
  });

  it("rejects reuse of a consumed challenge", async () => {
    const phone = nextPhone();
    const { challengeId, code } = await requestChallenge(phone);
    expect((await post(otpVerifyRoute, "/otp/verify", { challenge_id: challengeId, otp: code })).status).toBe(200);
    const again = await post(otpVerifyRoute, "/otp/verify", {
      challenge_id: challengeId,
      otp: code,
    });
    expect(again.status).toBe(400);
    expect(again.body.error?.code).toBe("OTP_INVALID");
  });

  it("increments attempts on a wrong code and still allows the right one", async () => {
    const phone = nextPhone();
    const { challengeId, code } = await requestChallenge(phone);
    const wrongCode = code === "000000" ? "111111" : "000000";
    const wrong = await post(otpVerifyRoute, "/otp/verify", {
      challenge_id: challengeId,
      otp: wrongCode,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error?.code).toBe("OTP_INVALID");
    const sql = getSql();
    const [row] = await sql<{ attempt_count: number }[]>`
      select attempt_count from otp_challenges where id = ${challengeId}
    `;
    expect(row.attempt_count).toBe(1);
    const right = await post(otpVerifyRoute, "/otp/verify", {
      challenge_id: challengeId,
      otp: code,
    });
    expect(right.status).toBe(200);
  });

  it("locks the challenge after max failed attempts", async () => {
    const phone = nextPhone();
    const { challengeId, code } = await requestChallenge(phone);
    const wrongCode = code === "000000" ? "111111" : "000000";
    let lastCode = "";
    for (let i = 0; i < 5; i += 1) {
      const attempt = await post(otpVerifyRoute, "/otp/verify", {
        challenge_id: challengeId,
        otp: wrongCode,
      });
      lastCode = attempt.body.error?.code ?? "";
    }
    expect(lastCode).toBe("OTP_LOCKED");
    const correct = await post(otpVerifyRoute, "/otp/verify", {
      challenge_id: challengeId,
      otp: code,
    });
    expect(correct.status).toBe(400);
    expect(correct.body.error?.code).toBe("OTP_LOCKED");
    const sql = getSql();
    const [row] = await sql<{ status: string }[]>`
      select status from otp_challenges where id = ${challengeId}
    `;
    expect(row.status).toBe("LOCKED");
  });

  it("rejects an expired challenge based on expires_at alone", async () => {
    const phone = nextPhone();
    const { challengeId, code } = await requestChallenge(phone);
    const sql = getSql();
    await sql`
      update otp_challenges
      set expires_at = now() - interval '1 second'
      where id = ${challengeId}
    `;
    const { status, body } = await post(otpVerifyRoute, "/otp/verify", {
      challenge_id: challengeId,
      otp: code,
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe("OTP_EXPIRED");
  });

  it("does not double-consume under concurrent verification", async () => {
    const phone = nextPhone();
    const { challengeId, code } = await requestChallenge(phone);
    const [a, b] = await Promise.all([
      post(otpVerifyRoute, "/otp/verify", { challenge_id: challengeId, otp: code }),
      post(otpVerifyRoute, "/otp/verify", { challenge_id: challengeId, otp: code }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 400]);
    const sql = getSql();
    const users = await sql`select id from users where phone_e164 = ${phone}`;
    expect(users.length).toBe(1);
    const sessions = await sql`
      select 1 from sessions where user_id = ${(users[0] as { id: string }).id}
    `;
    expect(sessions.length).toBe(1);
  });

  it("reuses the existing user and does not duplicate the role", async () => {
    const phone = nextPhone();
    const first = await login(phone);
    const second = await login(phone);
    expect(second.userId).toBe(first.userId);
    const sql = getSql();
    const roles = await sql`
      select 1 from user_roles where user_id = ${first.userId}
    `;
    expect(roles.length).toBe(1);
  });

  it("sanitizes return_to on verification", async () => {
    const phone = nextPhone();
    const { challengeId, code } = await requestChallenge(phone);
    const { body } = await post(otpVerifyRoute, "/otp/verify", {
      challenge_id: challengeId,
      otp: code,
      return_to: "https://evil.example/phish",
    });
    expect(body.data?.return_to).toBeNull();
  });
});

describe("POST /auth/otp/resend", () => {
  it("enforces the resend cooldown", async () => {
    await withEnv({ OTP_RESEND_COOLDOWN_SECONDS: "60" }, async () => {
      const phone = nextPhone();
      const { challengeId } = await requestChallenge(phone);
      const { status, body } = await post(otpResendRoute, "/otp/resend", {
        challenge_id: challengeId,
      });
      expect(status).toBe(429);
      expect(body.error?.code).toBe("OTP_RESEND_TOO_SOON");
    });
  });

  it("rotates the OTP: old code dies, new code works", async () => {
    const phone = nextPhone();
    const { challengeId, code: oldCode } = await requestChallenge(phone);
    const resend = await post(otpResendRoute, "/otp/resend", {
      challenge_id: challengeId,
    });
    expect(resend.status).toBe(200);
    const newCode = provider.lastCodeFor(phone)!;
    expect(newCode).not.toBe(oldCode);
    const stale = await post(otpVerifyRoute, "/otp/verify", {
      challenge_id: challengeId,
      otp: oldCode,
    });
    expect(stale.body.error?.code).toBe("OTP_INVALID");
    const fresh = await post(otpVerifyRoute, "/otp/verify", {
      challenge_id: challengeId,
      otp: newCode,
    });
    expect(fresh.status).toBe(200);
  });

  it("enforces the resend limit", async () => {
    await withEnv({ OTP_MAX_RESENDS: "1" }, async () => {
      const phone = nextPhone();
      const { challengeId } = await requestChallenge(phone);
      expect((await post(otpResendRoute, "/otp/resend", { challenge_id: challengeId })).status).toBe(200);
      const second = await post(otpResendRoute, "/otp/resend", {
        challenge_id: challengeId,
      });
      expect(second.status).toBe(429);
      expect(second.body.error?.code).toBe("OTP_RATE_LIMITED");
    });
  });

  it("rejects resend for unknown or consumed challenges", async () => {
    const unknown = await post(otpResendRoute, "/otp/resend", {
      challenge_id: "3f0e8f7a-58f4-4f5c-9d0e-0a9b8c7d6e5f",
    });
    expect(unknown.body.error?.code).toBe("OTP_INVALID");
    const phone = nextPhone();
    const { challengeId, code } = await requestChallenge(phone);
    await post(otpVerifyRoute, "/otp/verify", { challenge_id: challengeId, otp: code });
    const consumed = await post(otpResendRoute, "/otp/resend", {
      challenge_id: challengeId,
    });
    expect(consumed.body.error?.code).toBe("OTP_INVALID");
  });
});

describe("GET /auth/me and sessions", () => {
  it("rejects unauthenticated and garbage-cookie requests", async () => {
    const bare = await meRoute(new Request(`${BASE}/me`));
    expect(bare.status).toBe(401);
    const garbage = await meRoute(
      new Request(`${BASE}/me`, { headers: { cookie: "avtosh_session=nonsense" } }),
    );
    expect(garbage.status).toBe(401);
    const body = (await garbage.json()) as Envelope;
    expect(body.error?.code).toBe("AUTH_REQUIRED");
  });

  it("returns the safe DTO for a valid session and echoes X-Request-ID", async () => {
    const phone = nextPhone();
    const { token } = await login(phone);
    const response = await meRoute(
      new Request(`${BASE}/me`, {
        headers: {
          cookie: `avtosh_session=${token}`,
          "x-request-id": "auth-me-test-1234",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("auth-me-test-1234");
    const body = (await response.json()) as Envelope;
    const user = body.data?.user as Record<string, unknown>;
    expect(user.phoneMasked).not.toContain(phone.slice(5, 11));
    expect(user.roles).toEqual(["USER"]);
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it("rejects expired sessions regardless of cleanup", async () => {
    const phone = nextPhone();
    const { token, userId } = await login(phone);
    const sql = getSql();
    await sql`
      update sessions set expires_at = now() - interval '1 second'
      where user_id = ${userId}
    `;
    const response = await meRoute(
      new Request(`${BASE}/me`, { headers: { cookie: `avtosh_session=${token}` } }),
    );
    expect(response.status).toBe(401);
  });

  it("supports multiple concurrent sessions per user", async () => {
    const phone = nextPhone();
    const first = await login(phone);
    const second = await login(phone);
    for (const token of [first.token, second.token]) {
      const response = await meRoute(
        new Request(`${BASE}/me`, { headers: { cookie: `avtosh_session=${token}` } }),
      );
      expect(response.status).toBe(200);
    }
  });

  it("blocked users can still authenticate and see their status", async () => {
    const phone = nextPhone();
    const { userId } = await login(phone);
    const sql = getSql();
    await sql`
      update users set status = 'BLOCKED', blocked_at = now(), blocked_reason = 'test'
      where id = ${userId}
    `;
    const { token } = await login(phone); // fresh OTP login while blocked
    const response = await meRoute(
      new Request(`${BASE}/me`, { headers: { cookie: `avtosh_session=${token}` } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Envelope;
    expect((body.data?.user as { status: string }).status).toBe("BLOCKED");
  });

  it("rotates the session on re-authentication (fixation defense)", async () => {
    const phone = nextPhone();
    const first = await login(phone);
    const { challengeId, code } = await requestChallenge(phone);
    const verify = await post(
      otpVerifyRoute,
      "/otp/verify",
      { challenge_id: challengeId, otp: code },
      { cookie: `avtosh_session=${first.token}` },
    );
    const newToken = cookieToken(verify.response);
    expect(newToken).not.toBe(first.token);
    const oldMe = await meRoute(
      new Request(`${BASE}/me`, { headers: { cookie: `avtosh_session=${first.token}` } }),
    );
    expect(oldMe.status).toBe(401); // old session revoked
  });
});

describe("POST /auth/logout", () => {
  it("revokes the session and clears the cookie idempotently", async () => {
    const phone = nextPhone();
    const { token } = await login(phone);
    const first = await post(logoutRoute, "/logout", {}, { cookie: `avtosh_session=${token}` });
    expect(first.status).toBe(200);
    const setCookie = first.response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("avtosh_session=;");
    expect(setCookie).toContain("Max-Age=0");
    const me = await meRoute(
      new Request(`${BASE}/me`, { headers: { cookie: `avtosh_session=${token}` } }),
    );
    expect(me.status).toBe(401);
    const again = await post(logoutRoute, "/logout", {}, { cookie: `avtosh_session=${token}` });
    expect(again.status).toBe(200); // idempotent
  });

  it("rejects cross-origin logout attempts", async () => {
    const phone = nextPhone();
    const { token } = await login(phone);
    const { status, body } = await post(
      logoutRoute,
      "/logout",
      {},
      {
        cookie: `avtosh_session=${token}`,
        origin: "https://evil.example",
        host: "localhost",
      },
    );
    expect(status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN_ORIGIN");
  });
});
