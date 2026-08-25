/** Minimal browser-side client for the public API envelope. */

export interface ApiEnvelope<T> {
  data?: T;
  meta?: { next_cursor: string | null; has_more: boolean };
  error?: { code: string; message: string; request_id: string; details?: unknown };
}

export class PublicApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: unknown;
  constructor(
    code: string,
    message: string,
    status: number,
    requestId: string | null,
    details: unknown = null,
  ) {
    super(message);
    this.name = "PublicApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

export async function publicFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T; meta: ApiEnvelope<T>["meta"] }> {
  const response = await fetch(url, { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    body = null;
  }
  if (!response.ok || body === null || body.data === undefined) {
    throw new PublicApiError(
      body?.error?.code ?? "NETWORK_ERROR",
      body?.error?.message ?? "Request failed",
      response.status,
      body?.error?.request_id ?? response.headers.get("x-request-id"),
      body?.error?.details ?? null,
    );
  }
  return { data: body.data, meta: body.meta };
}
