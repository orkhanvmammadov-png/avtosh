import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSafeObjectRef,
  createLocalStorageProvider,
  signStorageUrl,
  verifyStorageSignature,
} from "@/providers/storage/local-provider";

/** Dev/E2E-only filesystem storage driver — safety properties. */

let dir = "";
const previousEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  const sub = `unit-${process.pid}`;
  dir = path.join(process.cwd(), ".dev-storage", sub);
  for (const key of ["STORAGE_DRIVER", "LOCAL_STORAGE_SUBDIR", "LOCAL_STORAGE_SECRET"]) {
    previousEnv[key] = process.env[key];
  }
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_STORAGE_SUBDIR = sub;
  process.env.LOCAL_STORAGE_SECRET = "unit-test-secret";
});

afterAll(() => {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("path safety", () => {
  it.each(["../escape", "a/../../b", "a\\b", "a b", "", "/abs"])(
    "rejects unsafe path %j",
    (bad) => {
      expect(() => assertSafeObjectRef("bucket", bad)).toThrow();
    },
  );

  it("accepts server-shaped paths", () => {
    expect(() => assertSafeObjectRef("listing-images", "listings/abc-123.webp")).not.toThrow();
    expect(() => assertSafeObjectRef("listing-uploads", "uploads/u1/l1/up1")).not.toThrow();
  });
});

describe("signed URL verification", () => {
  const future = () => Date.now() + 60_000;

  it("round-trips a valid signature", () => {
    const expires = future();
    const sig = signStorageUrl("PUT", "b", "p/x", expires);
    expect(
      verifyStorageSignature({ method: "PUT", bucket: "b", path: "p/x", expiresAtMs: expires, signature: sig }),
    ).toBe(true);
  });

  it("rejects expiry tampering, path swaps, method swaps, and expired URLs", () => {
    const expires = future();
    const sig = signStorageUrl("PUT", "b", "p/x", expires);
    expect(verifyStorageSignature({ method: "PUT", bucket: "b", path: "p/x", expiresAtMs: expires + 1, signature: sig })).toBe(false);
    expect(verifyStorageSignature({ method: "PUT", bucket: "b", path: "p/y", expiresAtMs: expires, signature: sig })).toBe(false);
    expect(verifyStorageSignature({ method: "GET", bucket: "b", path: "p/x", expiresAtMs: expires, signature: sig })).toBe(false);
    const past = Date.now() - 1000;
    const expiredSig = signStorageUrl("PUT", "b", "p/x", past);
    expect(verifyStorageSignature({ method: "PUT", bucket: "b", path: "p/x", expiresAtMs: past, signature: expiredSig })).toBe(false);
    expect(verifyStorageSignature({ method: "PUT", bucket: "b", path: "../../etc", expiresAtMs: expires, signature: sig })).toBe(false);
  });
});

describe("provider object lifecycle", () => {
  it("stores, reads, signs, and deletes objects on the local filesystem", async () => {
    const provider = createLocalStorageProvider();
    const payload = Buffer.from("webp-bytes");
    await provider.uploadObject("listing-images", "listings/test.webp", payload, "image/webp");
    expect(await provider.downloadObject("listing-images", "listings/test.webp")).toEqual(payload);
    const readUrl = await provider.createSignedReadUrl("listing-images", "listings/test.webp", 60);
    expect(readUrl).toContain("/api/dev-storage/object?");
    const upload = await provider.createSignedUploadUrl("listing-uploads", "uploads/u/l/x", 60);
    expect(upload.url).toContain("/api/dev-storage/upload?");
    expect(upload.token).toBeNull();
    await provider.deleteObject("listing-images", "listings/test.webp");
    expect(await provider.downloadObject("listing-images", "listings/test.webp")).toBeNull();
  });
});
