import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSql, getSql } from "@/lib/server/db/client";
import { createTestUserSession } from "./helpers/session";
import {
  createMemoryWhatsAppProvider,
  type MemoryWhatsAppProvider,
} from "@/providers/whatsapp/memory-provider";
import { setWhatsAppOtpProviderForTesting } from "@/providers/whatsapp/factory";
import { handleKapitalCallback, reconcileProviderPayments } from "@/services/payment-checkout";
import { POST as otpRequestRoute } from "@/app/api/v1/auth/otp/request/route";
import { POST as otpResendRoute } from "@/app/api/v1/auth/otp/resend/route";
import { POST as otpVerifyRoute } from "@/app/api/v1/auth/otp/verify/route";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";
import { PUT as favoriteRoute } from "@/app/api/v1/me/favorites/[publicId]/route";
import { POST as createListingRoute } from "@/app/api/v1/me/listings/route";
import { POST as claimRoute } from "@/app/api/v1/moderator/listings/[listingId]/claim/route";
import { POST as contactRoute } from "@/app/api/v1/listings/[publicId]/contact/route";
import { POST as reportRoute } from "@/app/api/v1/listings/[publicId]/report/route";
import { GET as brandsRoute } from "@/app/api/v1/catalog/brands/route";
import { GET as searchRoute } from "@/app/api/v1/listings/route";
import { GET as expireJobRoute } from "@/app/api/jobs/expire-listings/route";

/**
 * Owner-only pilot gate, route level, in FULL launch mode. During
 * the pilot a non-allowlisted visitor can neither trigger SMS nor
 * create/change content, start payments, or reveal contacts — and a
 * session minted BEFORE the pilot never bypasses it. Public reads,
 * cron-authenticated jobs and session-independent payment
 * verification keep working.
 */

const PILOT_PHONE = "+994512223344";
const OUTSIDER_PHONE = "+994559998877";
const CRON_SECRET = "pilot-test-cron-secret-0001";

let provider: MemoryWhatsAppProvider;
let outsider: { cookie: string };
let pilotUser: { cookie: string };
let outsiderChallengeId = "";
let activePublicId = "";

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(
  handler: Handler,
  method: string,
  url: string,
  options: { body?: unknown; cookie?: string; params?: Record<string, string>; bearer?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  if (options.bearer !== undefined) headers.authorization = `Bearer ${options.bearer}`;
  const request = new Request(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return handler(
    request,
    options.params === undefined ? undefined : { params: Promise.resolve(options.params) },
  );
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — run via: pnpm test:integration:db");
  }
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.OTP_MIN_INTERVAL_SECONDS = "0";
  provider = createMemoryWhatsAppProvider();
  setWhatsAppOtpProviderForTesting(provider);

  // PRE-PILOT state: an outsider session and a live outsider OTP
  // challenge both exist before the gate is enabled.
  outsider = await createTestUserSession(OUTSIDER_PHONE);
  pilotUser = await createTestUserSession(PILOT_PHONE, { roles: ["MODERATOR"] });
  const preChallenge = await call(otpRequestRoute, "POST", "http://localhost/api/v1/auth/otp/request", {
    body: { phone: OUTSIDER_PHONE },
  });
  expect(preChallenge.status).toBe(200);
  outsiderChallengeId = ((await preChallenge.json()) as { data: { challenge_id: string } }).data
    .challenge_id;

  // ACTIVE listing fixture (unique lp-* slugs) for the contact tests.
  const sql = getSql();
  const [cat] = await sql<{ id: string }[]>`select id from categories where code = 'CAR'`;
  const [brand] = await sql<{ id: string }[]>`
    insert into brands (name, slug) values ('LpBrand', 'lp-brand') returning id
  `;
  await sql`insert into brand_categories (brand_id, category_id) values (${brand!.id}, ${cat!.id})`;
  const [model] = await sql<{ id: string }[]>`
    insert into models (brand_id, category_id, name, slug)
    values (${brand!.id}, ${cat!.id}, 'LpModel', 'lp-model') returning id
  `;
  const [city] = await sql<{ id: string }[]>`
    insert into cities (name_az, slug) values ('LpBakı', 'lp-baki') returning id
  `;
  const [listing] = await sql<{ public_id: string }[]>`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year,
      price_minor, mileage, description, contact_phone_e164, seller_name,
      status, published_at, current_expires_at)
    values (${(await createTestUserSession("+994519111222")).userId}, ${cat!.id}, ${brand!.id}, ${model!.id}, ${city!.id}, 2021,
      1500000, 40000, 'Lp təsvir', '+994501112233', 'Lp Seller',
      'ACTIVE', now(), now() + interval '10 days')
    returning public_id::text as public_id
  `;
  activePublicId = listing!.public_id;

  process.env.LAUNCH_PILOT_PHONES = PILOT_PHONE; // pilot ON from here
});

afterAll(async () => {
  delete process.env.LAUNCH_PILOT_PHONES;
  delete process.env.OTP_MIN_INTERVAL_SECONDS;
  delete process.env.CRON_SECRET;
  setWhatsAppOtpProviderForTesting(null);
  await closeSql();
});

describe("OTP paths under the pilot", () => {
  it("denies a non-allowlisted phone with the generic throttle answer and sends no SMS", async () => {
    provider.reset();
    const response = await call(otpRequestRoute, "POST", "http://localhost/api/v1/auth/otp/request", {
      body: { phone: "+994551112233" },
    });
    expect(response.status).toBe(429);
    expect(await errorCode(response)).toBe("OTP_RATE_LIMITED");
    expect(provider.sent).toHaveLength(0);
  });

  it("allows the pilot phone end to end (request → verify → session)", async () => {
    provider.reset();
    const request = await call(otpRequestRoute, "POST", "http://localhost/api/v1/auth/otp/request", {
      body: { phone: PILOT_PHONE },
    });
    expect(request.status).toBe(200);
    const challengeId = ((await request.json()) as { data: { challenge_id: string } }).data
      .challenge_id;
    const code = provider.lastCodeFor(PILOT_PHONE);
    expect(code).toBeDefined();
    const verify = await call(otpVerifyRoute, "POST", "http://localhost/api/v1/auth/otp/verify", {
      body: { challenge_id: challengeId, otp: code },
    });
    expect(verify.status).toBe(200);
  });

  it("a pre-pilot outsider challenge cannot resend (no SMS) nor verify", async () => {
    provider.reset();
    const resend = await call(otpResendRoute, "POST", "http://localhost/api/v1/auth/otp/resend", {
      body: { challenge_id: outsiderChallengeId },
    });
    expect(resend.status).toBe(429);
    expect(provider.sent).toHaveLength(0);
    const code = provider.lastCodeFor(OUTSIDER_PHONE); // from the pre-pilot send
    const verify = await call(otpVerifyRoute, "POST", "http://localhost/api/v1/auth/otp/verify", {
      body: { challenge_id: outsiderChallengeId, otp: code ?? "000000" },
    });
    expect(verify.status).toBe(400);
    expect(await errorCode(verify)).toBe("OTP_INVALID");
  });
});

describe("existing sessions never bypass the pilot", () => {
  it("an outsider session is anonymous on every authenticated route", async () => {
    const me = await call(meRoute, "GET", "http://localhost/api/v1/auth/me", {
      cookie: outsider.cookie,
    });
    expect(me.status).toBe(401);
    const favorite = await call(favoriteRoute, "PUT", "http://localhost/api/v1/me/favorites/1", {
      cookie: outsider.cookie,
      params: { publicId: "1" },
    });
    expect(favorite.status).toBe(401);
    const createListing = await call(createListingRoute, "POST", "http://localhost/api/v1/me/listings", {
      cookie: outsider.cookie,
      body: {},
    });
    expect(createListing.status).toBe(401);
    const claim = await call(
      claimRoute,
      "POST",
      "http://localhost/api/v1/moderator/listings/00000000-0000-0000-0000-000000000000/claim",
      { cookie: outsider.cookie, params: { listingId: "00000000-0000-0000-0000-000000000000" } },
    );
    expect(claim.status).toBe(401);
  });

  it("a pilot-phone session keeps working, including staff routes", async () => {
    const me = await call(meRoute, "GET", "http://localhost/api/v1/auth/me", {
      cookie: pilotUser.cookie,
    });
    expect(me.status).toBe(200);
    const claim = await call(
      claimRoute,
      "POST",
      "http://localhost/api/v1/moderator/listings/00000000-0000-0000-0000-000000000000/claim",
      { cookie: pilotUser.cookie, params: { listingId: "00000000-0000-0000-0000-000000000000" } },
    );
    // Authorization passed (not 401/403) — the fixture listing simply
    // does not exist / is not claimable.
    expect([401, 403]).not.toContain(claim.status);
  });
});

describe("contact reveal during the pilot — session-gated", () => {
  function contactCall(cookie?: string) {
    return call(contactRoute, "POST", `http://localhost/api/v1/listings/${activePublicId}/contact`, {
      params: { publicId: activePublicId },
      cookie,
    });
  }

  it("anonymous requests refuse with the launch 503", async () => {
    const contact = await contactCall();
    expect(contact.status).toBe(503);
    expect(await errorCode(contact)).toBe("SERVICE_READ_ONLY");
  });

  it("an outsider session refuses identically (no bypass)", async () => {
    const contact = await contactCall(outsider.cookie);
    expect(contact.status).toBe(503);
    expect(await errorCode(contact)).toBe("SERVICE_READ_ONLY");
  });

  it("the pilot session receives the listing contact, uncached", async () => {
    const contact = await contactCall(pilotUser.cookie);
    expect(contact.status).toBe(200);
    expect(contact.headers.get("cache-control")).toBe("no-store");
    const body = (await contact.json()) as { data: { contact: { phone?: string } } };
    expect(body.data.contact.phone).toContain("+994");
  });

  it("public FULL (pilot variable removed) remains anonymous", async () => {
    delete process.env.LAUNCH_PILOT_PHONES;
    try {
      const contact = await contactCall();
      expect(contact.status).toBe(200);
    } finally {
      process.env.LAUNCH_PILOT_PHONES = PILOT_PHONE;
    }
  });

  it("reports stay blocked during the pilot, even for the pilot session", async () => {
    for (const cookie of [undefined, pilotUser.cookie]) {
      const report = await call(reportRoute, "POST", `http://localhost/api/v1/listings/${activePublicId}/report`, {
        params: { publicId: activePublicId },
        body: { reason_code: "FRAUD_SUSPECTED" },
        cookie,
      });
      expect(report.status).toBe(503);
      expect(await errorCode(report)).toBe("SERVICE_READ_ONLY");
    }
  });
});

describe("anonymous mutations, public reads, jobs and payment paths", () => {

  it("public read-only browsing stays open", async () => {
    const brands = await call(brandsRoute, "GET", "http://localhost/api/v1/catalog/brands?category=CAR");
    expect(brands.status).toBe(200);
    const search = await call(searchRoute, "GET", "http://localhost/api/v1/listings?category=CAR");
    expect(search.status).toBe(200);
  });

  it("cron-authenticated jobs still run (reconciliation stays available)", async () => {
    const job = await call(expireJobRoute, "GET", "http://localhost/api/jobs/expire-listings", {
      bearer: CRON_SECRET,
    });
    expect(job.status).toBe(200);
  });

  it("session-independent payment verification is not blocked by the pilot", async () => {
    // Unknown order: the callback must run (GENERIC view), never throw
    // a launch/pilot refusal; full fulfillment-under-pilot is covered
    // in payment-checkout.test.ts with its fixtures.
    const result = await handleKapitalCallback(null, "999999999");
    expect(result.view).toBe("GENERIC");
    const summary = await reconcileProviderPayments({ olderThanSeconds: 0, limit: 1 });
    expect(summary).toHaveProperty("checked");
  });
});
