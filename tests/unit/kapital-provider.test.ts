import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildHppRedirect,
  createKapitalProvider,
} from "@/providers/payments/kapital-provider";
import { PaymentProviderError } from "@/providers/payments/types";

/**
 * Transport contract of the Kapital adapter with an injected fetch —
 * request shape, Basic Auth handling, strict response validation.
 * Controlled fake credentials only; no network.
 */

const previousEnv: Record<string, string | undefined> = {};
const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeAll(() => {
  for (const key of ["KAPITAL_API_BASE_URL", "KAPITAL_USERNAME", "KAPITAL_PASSWORD"]) {
    previousEnv[key] = process.env[key];
  }
  process.env.KAPITAL_API_BASE_URL = "https://txpgtst.kapitalbank.az/api";
  process.env.KAPITAL_USERNAME = "unit-merchant";
  process.env.KAPITAL_PASSWORD = "unit-secret";
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => fetchMock.mockReset());

afterAll(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const goodCreateResponse = {
  order: {
    id: 123456,
    password: "hpp-pass",
    secret: "provider-secret",
    status: "Preparing",
    hppUrl: "https://txpgtst.kapitalbank.az/flex",
  },
};

describe("createOrder", () => {
  it("sends the documented Order_SMS body with Basic Auth and no COF fields", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(goodCreateResponse));
    const created = await createKapitalProvider().createOrder({
      amountMajor: "2.00",
      currency: "AZN",
      language: "az",
      description: "AVTOSH.AZ elan 10001",
      redirectUrl: "https://avtosh.az/odenis/kapital/netice",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://txpgtst.kapitalbank.az/api/order");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from("unit-merchant:unit-secret").toString("base64")}`,
    );
    const body = JSON.parse(init.body as string) as { order: Record<string, unknown> };
    expect(body).toEqual({
      order: {
        typeRid: "Order_SMS",
        amount: "2.00",
        currency: "AZN",
        language: "az",
        description: "AVTOSH.AZ elan 10001",
        hppRedirectUrl: "https://avtosh.az/odenis/kapital/netice",
      },
    });
    expect(Object.keys(body.order)).not.toContain("hppCofCapturePurposes");
    expect(created).toEqual({
      providerOrderId: "123456",
      hppUrl: "https://txpgtst.kapitalbank.az/flex",
      hppSecret: "hpp-pass",
      status: "Preparing",
    });
  });

  it.each<[unknown, string]>([
    [{}, "missing order"],
    [{ order: { id: 1, hppUrl: "https://txpgtst.kapitalbank.az/flex" } }, "missing password"],
    [{ order: { id: 1, password: "p" } }, "missing hppUrl"],
  ])("rejects incomplete create responses (%j)", async (payload) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(payload));
    await expect(
      createKapitalProvider().createOrder({
        amountMajor: "2.00",
        currency: "AZN",
        language: "az",
        description: "x",
        redirectUrl: "https://avtosh.az/x",
      }),
    ).rejects.toMatchObject({ name: "PaymentProviderError", kind: "CONTRACT" });
  });

  it("rejects an hppUrl on a host outside the provider policy (no open redirect)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ order: { id: 1, password: "p", hppUrl: "https://evil.example/flex" } }),
    );
    await expect(
      createKapitalProvider().createOrder({
        amountMajor: "2.00",
        currency: "AZN",
        language: "az",
        description: "x",
        redirectUrl: "https://avtosh.az/x",
      }),
    ).rejects.toMatchObject({ kind: "CONTRACT" });
  });

  it("maps auth and network failures without inventing state", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "no" }, 401));
    await expect(
      createKapitalProvider().createOrder({
        amountMajor: "2.00", currency: "AZN", language: "az", description: "x", redirectUrl: "https://a.b/x",
      }),
    ).rejects.toMatchObject({ kind: "AUTH" });
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(
      createKapitalProvider().createOrder({
        amountMajor: "2.00", currency: "AZN", language: "az", description: "x", redirectUrl: "https://a.b/x",
      }),
    ).rejects.toMatchObject({ kind: "NETWORK" });
  });
});

describe("getOrderDetails", () => {
  it("queries the documented endpoint and parses amounts exactly", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        order: { id: 123456, status: "FullyPaid", amount: "2.00", currency: "AZN", trans: [{ actionId: 987 }] },
      }),
    );
    const details = await createKapitalProvider().getOrderDetails("123456");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("https://txpgtst.kapitalbank.az/api/order/123456");
    expect(details).toEqual({
      providerOrderId: "123456",
      status: "FullyPaid",
      amountMinor: 200,
      currency: "AZN",
      providerTransactionId: "987",
    });
  });

  it("rejects malformed amounts and unsafe order ids", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ order: { id: 1, status: "FullyPaid", amount: "2,00", currency: "AZN" } }),
    );
    await expect(createKapitalProvider().getOrderDetails("1")).rejects.toMatchObject({ kind: "CONTRACT" });
    await expect(createKapitalProvider().getOrderDetails("../evil")).rejects.toBeInstanceOf(PaymentProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // unsafe id never reaches fetch
  });

  it("treats malformed JSON as a contract failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>oops</html>", { status: 200 }));
    await expect(createKapitalProvider().getOrderDetails("1")).rejects.toMatchObject({ kind: "CONTRACT" });
  });
});

describe("buildHppRedirect", () => {
  it("appends id/password to the returned URL without mutating its path", () => {
    expect(buildHppRedirect("https://txpgtst.kapitalbank.az/flex", "42", "pw")).toBe(
      "https://txpgtst.kapitalbank.az/flex?id=42&password=pw",
    );
  });
});
