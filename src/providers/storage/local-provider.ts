import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  StorageOperationError,
  type SignedUpload,
  type StorageProvider,
} from "@/providers/storage/types";

/**
 * Filesystem storage driver for local development and E2E only —
 * enabled exclusively via STORAGE_DRIVER=local and refused in
 * production builds. It preserves the production browser contract
 * (signed URL → direct PUT → server-side download at confirm) without
 * Supabase credentials. Signed URLs are HMAC-bound to method, bucket,
 * path, and expiry; object keys remain 100% server-generated.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function assertLocalStorageAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new StorageOperationError(
      "The local storage driver is not allowed in production.",
    );
  }
  if (process.env.STORAGE_DRIVER !== "local") {
    throw new StorageOperationError("The local storage driver is not enabled.");
  }
}

/**
 * Statically scoped to <cwd>/.dev-storage so build tracing includes
 * only that folder; tests may isolate into a sanitized subdirectory.
 */
export function localStorageRoot(): string {
  const base = path.join(process.cwd(), ".dev-storage");
  const sub = process.env.LOCAL_STORAGE_SUBDIR;
  return sub !== undefined && SAFE_SEGMENT.test(sub) ? path.join(base, sub) : base;
}

function signingSecret(): string {
  return process.env.LOCAL_STORAGE_SECRET ?? "avtosh-local-dev-storage";
}

/** Rejects traversal and any client-shaped path segment outright. */
export function assertSafeObjectRef(bucket: string, objectPath: string): void {
  const segments = [bucket, ...objectPath.split("/")];
  for (const segment of segments) {
    // SAFE_SEGMENT alone would admit "." / ".." (dots are allowed in
    // filenames) — reject dot-only segments explicitly.
    if (!SAFE_SEGMENT.test(segment) || /^\.+$/.test(segment)) {
      throw new StorageOperationError("Unsafe storage path.");
    }
  }
}

function objectFile(bucket: string, objectPath: string): string {
  assertSafeObjectRef(bucket, objectPath);
  return path.join(localStorageRoot(), bucket, ...objectPath.split("/"));
}

export function signStorageUrl(
  method: "PUT" | "GET",
  bucket: string,
  objectPath: string,
  expiresAtMs: number,
): string {
  return createHmac("sha256", signingSecret())
    .update(`${method}:${bucket}:${objectPath}:${expiresAtMs}`)
    .digest("hex");
}

export function verifyStorageSignature(input: {
  method: "PUT" | "GET";
  bucket: string;
  path: string;
  expiresAtMs: number;
  signature: string;
}): boolean {
  if (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs < Date.now()) {
    return false;
  }
  try {
    assertSafeObjectRef(input.bucket, input.path);
  } catch {
    return false;
  }
  const expected = Buffer.from(
    signStorageUrl(input.method, input.bucket, input.path, input.expiresAtMs),
    "hex",
  );
  const provided = Buffer.from(input.signature, "hex");
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}

function buildUrl(
  route: "upload" | "object",
  method: "PUT" | "GET",
  bucket: string,
  objectPath: string,
  expiresInSeconds: number,
): string {
  const expiresAtMs = Date.now() + expiresInSeconds * 1000;
  const sig = signStorageUrl(method, bucket, objectPath, expiresAtMs);
  const params = new URLSearchParams({
    bucket,
    path: objectPath,
    expires: String(expiresAtMs),
    sig,
  });
  return `/api/dev-storage/${route}?${params.toString()}`;
}

export async function writeLocalObject(
  bucket: string,
  objectPath: string,
  data: Buffer,
): Promise<void> {
  const file = objectFile(bucket, objectPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

export async function readLocalObject(
  bucket: string,
  objectPath: string,
): Promise<Buffer | null> {
  try {
    return await readFile(objectFile(bucket, objectPath));
  } catch {
    return null;
  }
}

export function createLocalStorageProvider(): StorageProvider {
  assertLocalStorageAllowed();
  return {
    async createSignedUploadUrl(bucket, objectPath, expiresInSeconds): Promise<SignedUpload> {
      assertSafeObjectRef(bucket, objectPath);
      return {
        url: buildUrl("upload", "PUT", bucket, objectPath, expiresInSeconds),
        token: null,
      };
    },

    async downloadObject(bucket, objectPath): Promise<Buffer | null> {
      return readLocalObject(bucket, objectPath);
    },

    async uploadObject(bucket, objectPath, data): Promise<void> {
      await writeLocalObject(bucket, objectPath, data);
    },

    async deleteObject(bucket, objectPath): Promise<void> {
      await rm(objectFile(bucket, objectPath), { force: true });
    },

    async createSignedReadUrl(bucket, objectPath, expiresInSeconds): Promise<string> {
      assertSafeObjectRef(bucket, objectPath);
      return buildUrl("object", "GET", bucket, objectPath, expiresInSeconds);
    },
  };
}
