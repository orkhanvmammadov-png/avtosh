/**
 * Payment-provider abstraction (Phase 4.12). Services depend only on
 * these normalized shapes; Kapital-specific transport stays inside
 * the adapter. A future officially documented webhook contract would
 * be added here as a new capability without touching callers.
 */

export interface CreateOrderInput {
  /** Exact major-unit decimal string, e.g. "2.00" (never a float). */
  amountMajor: string;
  currency: string;
  language: string;
  description: string;
  /** Absolute merchant URL the HPP redirects the buyer back to. */
  redirectUrl: string;
}

export interface CreatedProviderOrder {
  providerOrderId: string;
  /** Hosted-payment-page base URL exactly as returned by the provider. */
  hppUrl: string;
  /** Order password required to open the HPP. Provider-sensitive. */
  hppSecret: string;
  /** Raw provider order status at creation time (e.g. "Preparing"). */
  status: string;
}

export interface ProviderOrderDetails {
  providerOrderId: string;
  /** Raw provider status string, unmapped (e.g. "FullyPaid"). */
  status: string;
  /** Exact minor-unit amount parsed from the provider's decimal. */
  amountMinor: number;
  currency: string;
  /** First transaction id when the provider reports one. */
  providerTransactionId: string | null;
}

export interface PaymentProviderClient {
  createOrder(input: CreateOrderInput): Promise<CreatedProviderOrder>;
  getOrderDetails(providerOrderId: string): Promise<ProviderOrderDetails>;
}

/** Raised for transport/contract failures — payment state never moves on it. */
export class PaymentProviderError extends Error {
  readonly kind: "CONFIG" | "NETWORK" | "AUTH" | "CONTRACT";
  constructor(kind: PaymentProviderError["kind"], message: string) {
    super(message);
    this.name = "PaymentProviderError";
    this.kind = kind;
  }
}
