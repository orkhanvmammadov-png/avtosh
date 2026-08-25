import sharp from "sharp";
import { expect } from "vitest";
import type { MemoryStorageProvider } from "@/providers/storage/memory-provider";

/** Shared HTTP-level helpers for owner listing integration tests. */

export const LISTINGS_BASE = "http://localhost/api/v1/me/listings";

export interface Envelope {
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}

export type Route = (
  request: Request,
  context?: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export async function api(
  route: Route,
  method: string,
  url: string,
  options: {
    body?: unknown;
    cookie?: string;
    params?: Record<string, string>;
    origin?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: Envelope; response: Response }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(options.headers ?? {}) };
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  if (options.origin !== undefined) {
    headers.origin = options.origin;
    headers.host = "localhost";
  }
  const response = await route(
    new Request(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    options.params === undefined ? undefined : { params: Promise.resolve(options.params) },
  );
  return { status: response.status, body: (await response.json()) as Envelope, response };
}

export async function makeJpeg(width = 640, height = 480): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 60, b: 90 } },
  })
    .jpeg()
    .toBuffer();
}

export async function withEnv<T>(
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
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export interface ListingRoutes {
  create: Route;
  patch: Route;
  uploadUrl: Route;
  confirm: Route;
}

export async function createDraftVia(
  routes: ListingRoutes,
  cookie: string,
  category = "CAR",
): Promise<{ id: string; revision: number }> {
  const { status, body } = await api(routes.create, "POST", LISTINGS_BASE, {
    body: { category },
    cookie,
  });
  expect(status).toBe(201);
  const listing = body.data?.listing as { id: string; revision: number };
  return { id: listing.id, revision: listing.revision };
}

export async function uploadAndConfirmVia(
  routes: ListingRoutes,
  storage: MemoryStorageProvider,
  cookie: string,
  listingId: string,
): Promise<{ imageId: string; revision: number }> {
  const auth = await api(routes.uploadUrl, "POST", `${LISTINGS_BASE}/${listingId}/images/upload-url`, {
    body: { declared_mime_type: "image/jpeg", declared_size_bytes: 5000 },
    cookie,
    params: { listingId },
  });
  expect(auth.status).toBe(200);
  storage.uploadViaSignedUrl(auth.body.data?.upload_url as string, await makeJpeg(), "image/jpeg");
  const confirm = await api(routes.confirm, "POST", `${LISTINGS_BASE}/${listingId}/images/confirm`, {
    body: { upload_id: auth.body.data?.upload_id },
    cookie,
    params: { listingId },
  });
  expect(confirm.status).toBe(201);
  return {
    imageId: (confirm.body.data?.image as { id: string }).id,
    revision: confirm.body.data?.revision as number,
  };
}

/** Assertion message for unexpected statuses: status + safe body + request id. */
export function explain(r: { status: number; body: Envelope; response: Response }): string {
  return `status=${r.status} request_id=${r.response.headers.get("x-request-id")} body=${JSON.stringify(r.body).slice(0, 600)}`;
}
