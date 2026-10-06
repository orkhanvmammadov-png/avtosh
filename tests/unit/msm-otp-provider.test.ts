import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMsmRequestXml,
  createMsmSmsOtpProvider,
  msmRecipientFromE164,
  sendMsmSms,
} from "@/providers/sms/msm-otp-provider";
import { MSM_SEND_ENDPOINT } from "@/lib/config/msm";
import { WhatsAppDeliveryError } from "@/providers/whatsapp/types";
import { planMsmSmoke, MSM_SMOKE_TEXT } from "../../scripts/sms/msm-smoke-guards.mts";

/**
 * MSM adapter transport contract with an injected fetch — request
 * shape, phone conversion, XML escaping, documented response codes,
 * no-retry behavior, and secret redaction. Controlled fake
 * credentials only; no network.
 */

const previousEnv: Record<string, string | undefined> = {};
const fetchMock = vi.fn();

function okXml(id = "msg-123"): Response {
  return new Response(
    `<SMS-Response><STATUS res="100" restxt="OK" id="${id}" charge="1" balance="99"/></SMS-Response>`,
    { status: 200, headers: { "content-type": "application/xml" } },
  );
}

function errXml(res: string, restxt: string): Response {
  return new Response(`<SMS-Response><STATUS res="${res}" restxt="${restxt}"/></SMS-Response>`, {
    status: 200,
    headers: { "content-type": "application/xml" },
  });
}

let infoLog: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  for (const key of ["MSM_USERNAME", "MSM_API_KEY", "MSM_SENDER"]) previousEnv[key] = process.env[key];
  process.env.MSM_USERNAME = "unit-msm-user";
  process.env.MSM_API_KEY = "unit-msm-secret-key";
  delete process.env.MSM_SENDER; // exercise the Owner-confirmed default
  vi.stubGlobal("fetch", fetchMock);
});

beforeEach(() => {
  infoLog = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("request shape", () => {
  it("POSTs XML to exactly the v1 HTTPS endpoint with no query parameters and no redirects", async () => {
    fetchMock.mockResolvedValueOnce(okXml());
    await sendMsmSms({ phoneE164: "+994501234567", text: "hello" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://v1.msm.az/sendsms");
    expect(url).toBe(MSM_SEND_ENDPOINT);
    expect(url).not.toContain("?");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>)["content-type"]).toBe(
      "application/xml; charset=utf-8",
    );
    // Exact full-document assertion — the Owner-supplied contract
    // uses SMS-InsRequest as root; nothing may drift (opening tag,
    // CLIENT and INSERT attributes, closing tag).
    expect(String(init.body)).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<SMS-InsRequest>` +
        `<CLIENT user="unit-msm-user" pwd="unit-msm-secret-key" from="Avtosh.az"/>` +
        `<INSERT to="501234567" text="hello"/>` +
        `</SMS-InsRequest>`,
    );
  });

  it("the smoke script's send path produces the identical exact structure", async () => {
    // The smoke sends through the same sendMsmSms with its fixed text.
    fetchMock.mockResolvedValueOnce(okXml());
    await sendMsmSms({ phoneE164: "+994501234567", text: MSM_SMOKE_TEXT });
    expect(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<SMS-InsRequest>` +
        `<CLIENT user="unit-msm-user" pwd="unit-msm-secret-key" from="Avtosh.az"/>` +
        `<INSERT to="501234567" text="${MSM_SMOKE_TEXT}"/>` +
        `</SMS-InsRequest>`,
    );
  });

  it("converts +994501234567 to 501234567 exactly once and refuses other shapes with no network call", () => {
    expect(msmRecipientFromE164("+994501234567")).toBe("501234567");
    expect(msmRecipientFromE164("+994701112233")).toBe("701112233");
    for (const bad of ["+79031234567", "994501234567", "+99450123456", "+9945012345678", "0501234567"]) {
      expect(() => msmRecipientFromE164(bad), bad).toThrow(WhatsAppDeliveryError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("XML-escapes every attribute value", () => {
    const xml = buildMsmRequestXml({
      username: `u&<>"'`,
      apiKey: `k"quote`,
      sender: `S&M <'>`,
      to: "501234567",
      text: `a<b&c>"d'`,
    });
    expect(xml).toContain(`user="u&amp;&lt;&gt;&quot;&apos;"`);
    expect(xml).toContain(`pwd="k&quot;quote"`);
    expect(xml).toContain(`from="S&amp;M &lt;&apos;&gt;"`);
    expect(xml).toContain(`text="a&lt;b&amp;c&gt;&quot;d&apos;"`);
    expect(xml).not.toMatch(/="[^"]*<[^"]*"/);
  });
});

describe("response handling — acceptance vs failure, never retry", () => {
  it("res=100 resolves with the message id (provider acceptance, not delivery)", async () => {
    fetchMock.mockResolvedValueOnce(okXml("abc-9"));
    const result = await sendMsmSms({ phoneE164: "+994501234567", text: "x" });
    expect(result.messageId).toBe("abc-9");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["0", "malformed"],
    ["10", "configuration"],
    ["20", "invalid number"],
    ["25", "blacklist"],
    ["30", "unauthorized network"],
    ["40", "invalid credentials"],
    ["50", "unauthorized sender"],
    ["60", "insufficient balance"],
    ["80", "invalid scheduling"],
    ["90", "message too large"],
    ["200", "server error"],
  ])("res=%s fails closed with the numeric code only, exactly one fetch", async (res, restxt) => {
    fetchMock.mockResolvedValueOnce(errXml(res, restxt));
    let caught: unknown;
    await sendMsmSms({ phoneE164: "+994501234567", text: "x" }).catch((e) => (caught = e));
    expect(caught).toBeInstanceOf(WhatsAppDeliveryError);
    const message = (caught as Error).message;
    expect(message).toContain(`res=${res}`);
    expect(message).not.toContain(restxt); // free text never propagates
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("malformed XML, HTTP errors and timeouts fail closed after exactly one attempt", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not xml at all", { status: 200 }));
    await expect(sendMsmSms({ phoneE164: "+994501234567", text: "x" })).rejects.toBeInstanceOf(
      WhatsAppDeliveryError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response("err", { status: 500 }));
    await expect(sendMsmSms({ phoneE164: "+994501234567", text: "x" })).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new Error("The operation was aborted due to timeout"));
    await expect(sendMsmSms({ phoneE164: "+994501234567", text: "x" })).rejects.toThrow(/unreachable/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // ambiguous — never retried
  });
});

describe("OTP provider wrapper and secret redaction", () => {
  it("sends the ASCII OTP text and refuses non-digit OTP shapes", async () => {
    fetchMock.mockResolvedValueOnce(okXml());
    await createMsmSmsOtpProvider().sendOtp({ phoneE164: "+994501234567", code: "123456" });
    const body = String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body);
    expect(body).toContain(`text="Avtosh.az giris kodu: 123456"`);
    await expect(
      createMsmSmsOtpProvider().sendOtp({ phoneE164: "+994501234567", code: "12 OR 1=1" }),
    ).rejects.toBeInstanceOf(WhatsAppDeliveryError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("errors and logs never contain credentials, the OTP, the XML, or the full phone number", async () => {
    fetchMock.mockResolvedValueOnce(errXml("40", "Invalid credentials for unit-msm-user"));
    let caught: Error | undefined;
    await createMsmSmsOtpProvider()
      .sendOtp({ phoneE164: "+994501234567", code: "654321" })
      .catch((e) => (caught = e as Error));
    const surfaces = [
      caught?.message ?? "",
      ...(infoLog.mock.calls as unknown[][]).map((c) => String(c[0])),
    ].join("\n");
    expect(surfaces).not.toContain("unit-msm-secret-key");
    expect(surfaces).not.toContain("unit-msm-user");
    expect(surfaces).not.toContain("654321");
    expect(surfaces).not.toContain("994501234567");
    expect(surfaces).not.toContain("<CLIENT");
  });

  it("the acceptance log carries only the res code and message id", async () => {
    fetchMock.mockResolvedValueOnce(okXml("id-7"));
    await sendMsmSms({ phoneE164: "+994501234567", text: "x" });
    const logged = (infoLog.mock.calls as unknown[][]).map((c) => String(c[0])).join("\n");
    expect(logged).toContain('"evt":"otp.msm_send_accepted"');
    expect(logged).toContain('"message_id":"id-7"');
    expect(logged).not.toContain("501234567");
    expect(logged).not.toContain("unit-msm");
  });
});

describe("manual smoke gating (never CI, explicit opt-in)", () => {
  const good = {
    MSM_SMOKE: "1",
    MSM_SMOKE_CONFIRM: "YES",
    MSM_SMOKE_TO: "+994501234567",
  };

  it("refuses in CI, without opt-in, without confirmation, and without an explicit number", () => {
    expect(planMsmSmoke({ ...good, CI: "true" })).toMatchObject({ ok: false });
    expect(planMsmSmoke({ ...good, MSM_SMOKE: undefined })).toMatchObject({ ok: false });
    expect(planMsmSmoke({ ...good, MSM_SMOKE_CONFIRM: undefined })).toMatchObject({ ok: false });
    expect(planMsmSmoke({ ...good, MSM_SMOKE_TO: undefined })).toMatchObject({ ok: false });
    expect(planMsmSmoke({ ...good, MSM_SMOKE_TO: "0501234567" })).toMatchObject({ ok: false });
  });

  it("accepts an explicit Owner-supplied number and uses a fixed non-secret text", () => {
    expect(planMsmSmoke(good)).toEqual({ ok: true, phoneE164: "+994501234567" });
    expect(MSM_SMOKE_TEXT).not.toMatch(/\d{4,}/); // never OTP-shaped
  });
});
