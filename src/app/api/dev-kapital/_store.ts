import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Dev/E2E-only fake Kapital Bank order store (filesystem, gitignored).
 * Inert unless PAYMENT_FAKE_KAPITAL=1 outside production. Exists so
 * the REAL Kapital adapter can be exercised end-to-end over HTTP
 * (request shape, Basic Auth, response parsing) without the live
 * provider. Never contains real card data.
 */

export interface FakeKapitalOrder {
  id: string;
  password: string;
  secret: string;
  amount: string;
  currency: string;
  language: string;
  description: string;
  hppRedirectUrl: string;
  status: string;
  actionId: string | null;
}

export function fakeKapitalEnabled(): boolean {
  return process.env.PAYMENT_FAKE_KAPITAL === "1" && process.env.NODE_ENV !== "production";
}

/** Basic-auth guard mirroring the real provider's behavior. */
export function fakeKapitalAuthorized(request: Request): boolean {
  const expected = `Basic ${Buffer.from(
    `${process.env.KAPITAL_USERNAME ?? ""}:${process.env.KAPITAL_PASSWORD ?? ""}`,
  ).toString("base64")}`;
  return request.headers.get("authorization") === expected;
}

function storeDir(): string {
  return path.join(process.cwd(), ".dev-storage", "kapital");
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function saveFakeOrder(order: FakeKapitalOrder): Promise<void> {
  if (!SAFE_ID.test(order.id)) throw new Error("unsafe id");
  await mkdir(storeDir(), { recursive: true });
  await writeFile(path.join(storeDir(), `${order.id}.json`), JSON.stringify(order, null, 2));
}

export async function readFakeOrder(id: string): Promise<FakeKapitalOrder | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(storeDir(), `${id}.json`), "utf8")) as FakeKapitalOrder;
  } catch {
    return null;
  }
}
