import { mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  KAPITAL_PRODUCTION_ORIGIN,
  KAPITAL_TEST_ORIGIN,
  assertHttpsCheckoutUrl,
  pathOccupied,
  planSmokeRun,
  writeUrlFileExclusive,
} from "../../scripts/payments/kapital-smoke-guards.mts";

// Fail-closed gating for the manual production smoke script: every
// refusal path the review demanded, plus the exclusive 0600 URL file.

const PROD_API = `${KAPITAL_PRODUCTION_ORIGIN}/api`;
const TEST_API = `${KAPITAL_TEST_ORIGIN}/api`;

function createEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    KAPITAL_SMOKE: "1",
    KAPITAL_API_BASE_URL: PROD_API,
    KAPITAL_SMOKE_CONFIRM_PRODUCTION: "YES",
    KAPITAL_SMOKE_AMOUNT: "0.05",
    NEXT_PUBLIC_APP_URL: "https://www.avtosh.az",
    ...overrides,
  };
}

describe("planSmokeRun refusal paths", () => {
  it("refuses without the explicit opt-in", () => {
    expect(planSmokeRun(createEnv({ KAPITAL_SMOKE: undefined }))).toMatchObject({ ok: false });
  });

  it("validates the API origin exactly — substring lookalikes are refused", () => {
    for (const url of [
      "https://e-commerce.kapitalbank.az.attacker.tld/api", // substring trap
      "https://evil-e-commerce.kapitalbank.az.example/api",
      "http://e-commerce.kapitalbank.az/api", // wrong scheme
      "https://example.com/api",
      "not a url",
      undefined,
    ]) {
      const decision = planSmokeRun(createEnv({ KAPITAL_API_BASE_URL: url }));
      expect(decision.ok, String(url)).toBe(false);
    }
    expect(planSmokeRun(createEnv()).ok).toBe(true);
    expect(planSmokeRun(createEnv({ KAPITAL_API_BASE_URL: TEST_API })).ok).toBe(true);
  });

  it("create mode requires explicit confirmation on EVERY host, including the bank test terminal", () => {
    for (const api of [PROD_API, TEST_API]) {
      const decision = planSmokeRun(
        createEnv({ KAPITAL_API_BASE_URL: api, KAPITAL_SMOKE_CONFIRM_PRODUCTION: undefined }),
      );
      expect(decision.ok, api).toBe(false);
    }
  });

  it("create mode requires an explicitly supplied approved amount — no default", () => {
    expect(planSmokeRun(createEnv({ KAPITAL_SMOKE_AMOUNT: undefined }))).toMatchObject({ ok: false });
    expect(planSmokeRun(createEnv({ KAPITAL_SMOKE_AMOUNT: "" }))).toMatchObject({ ok: false });
    for (const bad of ["0", "0.000", "10.01", "999", "abc", "-1", "1,00"]) {
      expect(planSmokeRun(createEnv({ KAPITAL_SMOKE_AMOUNT: bad })).ok, bad).toBe(false);
    }
  });

  it("a production order requires an explicit HTTPS app URL — no localhost fallback", () => {
    expect(planSmokeRun(createEnv({ NEXT_PUBLIC_APP_URL: undefined }))).toMatchObject({ ok: false });
    expect(planSmokeRun(createEnv({ NEXT_PUBLIC_APP_URL: "" }))).toMatchObject({ ok: false });
    expect(planSmokeRun(createEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }))).toMatchObject({
      ok: false,
    });
    expect(planSmokeRun(createEnv({ NEXT_PUBLIC_APP_URL: "not a url" }))).toMatchObject({ ok: false });
  });

  it("an approved production plan carries the redirect built from the app origin", () => {
    const decision = planSmokeRun(createEnv());
    expect(decision).toMatchObject({
      ok: true,
      plan: {
        mode: "create",
        isProduction: true,
        amountMajor: "0.05",
        redirectUrl: "https://www.avtosh.az/odenis/kapital/netice",
      },
    });
  });

  it("verify mode needs only a well-shaped order id", () => {
    const env = createEnv({
      KAPITAL_SMOKE_ORDER_ID: "12345",
      KAPITAL_SMOKE_CONFIRM_PRODUCTION: undefined,
      KAPITAL_SMOKE_AMOUNT: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
    });
    expect(planSmokeRun(env)).toMatchObject({ ok: true, plan: { mode: "verify", orderId: "12345" } });
    expect(planSmokeRun({ ...env, KAPITAL_SMOKE_ORDER_ID: "../etc" })).toMatchObject({ ok: false });
  });
});

describe("checkout URL must be HTTPS, independently of NODE_ENV", () => {
  it("accepts only https checkout URLs", () => {
    expect(assertHttpsCheckoutUrl("https://hpp.example/flex?id=1&password=x")).toEqual({ ok: true });
    expect(assertHttpsCheckoutUrl("http://hpp.example/flex?id=1&password=x")).toMatchObject({
      ok: false,
    });
    expect(assertHttpsCheckoutUrl("ftp://hpp.example/flex")).toMatchObject({ ok: false });
    expect(assertHttpsCheckoutUrl("not a url")).toMatchObject({ ok: false });
  });

  it("refusal reasons never echo the URL (it embeds the order password)", () => {
    const refused = assertHttpsCheckoutUrl("http://hpp.example/flex?id=1&password=supersecret");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).not.toContain("supersecret");
      expect(refused.reason).not.toContain("hpp.example");
    }
  });
});

describe("exclusive URL file", () => {
  it("writes a fresh file with mode 0600 exactly once", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kapital-smoke-"));
    const file = path.join(dir, "url.txt");
    expect(pathOccupied(file)).toBe(false);
    expect(writeUrlFileExclusive(file, "sensitive\n")).toEqual({ ok: true });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe("sensitive\n");
    // Never overwrites.
    expect(writeUrlFileExclusive(file, "other")).toMatchObject({ ok: false });
    expect(readFileSync(file, "utf8")).toBe("sensitive\n");
  });

  it("refuses an existing file and an existing (even dangling) symlink", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kapital-smoke-"));
    const existing = path.join(dir, "existing.txt");
    writeFileSync(existing, "old");
    expect(pathOccupied(existing)).toBe(true);
    expect(writeUrlFileExclusive(existing, "new")).toMatchObject({ ok: false });

    const link = path.join(dir, "link.txt");
    symlinkSync(path.join(dir, "nowhere.txt"), link); // dangling
    expect(pathOccupied(link)).toBe(true);
    expect(writeUrlFileExclusive(link, "new")).toMatchObject({ ok: false });
    expect(pathOccupied(path.join(dir, "nowhere.txt"))).toBe(false); // never followed
  });
});
