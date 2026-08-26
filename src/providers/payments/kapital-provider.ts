import { kapitalConfig } from "@/lib/config/kapital";
import { majorToMinorExact } from "@/lib/payments/money";
import {
  PaymentProviderError,
  type CreateOrderInput,
  type CreatedProviderOrder,
  type PaymentProviderClient,
  type ProviderOrderDetails,
} from "@/providers/payments/types";

/**
 * Kapital Bank e-commerce REST adapter.
 *
 * Contract (official docs at https://pg.kapitalbank.az/docs):
 *   POST {base}/order            — create Order_SMS purchase order
 *   GET  {base}/order/{id}       — authoritative order state
 * HTTP Basic Auth. The Authorization header is built here and only
 * here; it is never logged, persisted, or returned. Responses are
 * validated strictly — a malformed provider payload throws a
 * CONTRACT error and can never look like a successful payment.
 */

interface KapitalOrderEnvelope {
  order?: {
    id?: unknown;
    password?: unknown;
    hppUrl?: unknown;
    status?: unknown;
    amount?: unknown;
    currency?: unknown;
    trans?: { actionId?: unknown }[];
  };
}

function authorizationHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function kapitalFetch(path: string, init: RequestInit): Promise<KapitalOrderEnvelope> {
  const config = kapitalConfig();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: authorizationHeader(config.username, config.password),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
  } catch {
    // timeout / DNS / connection reset — payment state never moves on this
    throw new PaymentProviderError("NETWORK", "Payment provider is unreachable.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new PaymentProviderError("AUTH", "Payment provider rejected the merchant credentials.");
  }
  if (!response.ok) {
    throw new PaymentProviderError("CONTRACT", `Payment provider returned HTTP ${response.status}.`);
  }
  try {
    return (await response.json()) as KapitalOrderEnvelope;
  } catch {
    throw new PaymentProviderError("CONTRACT", "Payment provider returned malformed JSON.");
  }
}

/** hppUrl must be a sane provider URL — never an open-redirect primitive. */
function assertSafeHppUrl(raw: string): void {
  const config = kapitalConfig();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PaymentProviderError("CONTRACT", "Provider returned an invalid payment page URL.");
  }
  if (config.requireHttpsHpp && url.protocol !== "https:") {
    throw new PaymentProviderError("CONTRACT", "Provider payment page URL must use HTTPS.");
  }
  if (!config.allowedHppHosts.includes(url.host)) {
    throw new PaymentProviderError("CONTRACT", "Provider payment page host is not allowed.");
  }
}

export function createKapitalProvider(): PaymentProviderClient {
  return {
    async createOrder(input: CreateOrderInput): Promise<CreatedProviderOrder> {
      const envelope = await kapitalFetch("/order", {
        method: "POST",
        body: JSON.stringify({
          order: {
            typeRid: "Order_SMS",
            amount: input.amountMajor,
            currency: input.currency,
            language: input.language,
            description: input.description,
            hppRedirectUrl: input.redirectUrl,
          },
        }),
      });
      const order = envelope.order;
      const id = order?.id;
      const password = order?.password;
      const hppUrl = order?.hppUrl;
      if (
        order === undefined ||
        (typeof id !== "number" && typeof id !== "string") ||
        typeof password !== "string" ||
        password.length === 0 ||
        typeof hppUrl !== "string"
      ) {
        throw new PaymentProviderError("CONTRACT", "Provider create-order response is incomplete.");
      }
      assertSafeHppUrl(hppUrl);
      return {
        providerOrderId: String(id),
        hppUrl,
        hppSecret: password,
        status: typeof order.status === "string" ? order.status : "Preparing",
      };
    },

    async getOrderDetails(providerOrderId: string): Promise<ProviderOrderDetails> {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(providerOrderId)) {
        throw new PaymentProviderError("CONTRACT", "Invalid provider order id.");
      }
      const envelope = await kapitalFetch(
        `/order/${encodeURIComponent(providerOrderId)}?tranDetailLevel=2`,
        { method: "GET" },
      );
      const order = envelope.order;
      const id = order?.id;
      const status = order?.status;
      if (
        order === undefined ||
        (typeof id !== "number" && typeof id !== "string") ||
        typeof status !== "string"
      ) {
        throw new PaymentProviderError("CONTRACT", "Provider order-details response is incomplete.");
      }
      const amountMinor = majorToMinorExact(order.amount);
      if (amountMinor === null) {
        throw new PaymentProviderError("CONTRACT", "Provider order amount is malformed.");
      }
      const currency = typeof order.currency === "string" ? order.currency : "";
      const action = Array.isArray(order.trans) ? order.trans[0]?.actionId : undefined;
      return {
        providerOrderId: String(id),
        status,
        amountMinor,
        currency,
        providerTransactionId:
          typeof action === "string" || typeof action === "number" ? String(action) : null,
      };
    },
  };
}

/**
 * Builds the buyer-facing checkout URL from the provider response.
 *
 * The official documentation is internally ambiguous about hppUrl:
 * the flow narrative shows `{{order.hppUrl}}/flex?id=…` while the
 * create-order sample already returns `https://host/flex`. Both
 * documented shapes are tolerated: a bare-origin hppUrl gains the
 * `/flex` path; an hppUrl that already ends in `/flex` is used as-is.
 * `/flex/flex` can never be produced. Host/HTTPS policy was already
 * enforced on hppUrl at create time and the host is preserved here.
 */
export function buildHppRedirect(hppUrl: string, providerOrderId: string, hppSecret: string): string {
  const url = new URL(hppUrl);
  const trimmedPath = url.pathname.replace(/\/+$/, "");
  if (trimmedPath === "") {
    // bare-origin documented shape → the flow narrative's /flex path
    url.pathname = "/flex";
  } else {
    // any explicit path (the sample response's /flex, or a future
    // provider-chosen path) is used exactly as returned — never
    // append again, so /flex/flex is impossible
    url.pathname = trimmedPath;
  }
  url.searchParams.set("id", providerOrderId);
  url.searchParams.set("password", hppSecret);
  return url.toString();
}
