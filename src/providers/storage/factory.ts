import { createLocalStorageProvider } from "@/providers/storage/local-provider";
import { createSupabaseStorageProvider } from "@/providers/storage/supabase-provider";
import type { StorageProvider } from "@/providers/storage/types";

/**
 * Storage provider selection: Supabase in real environments (fails
 * with a clear configuration error when SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY are absent), an injected fake in tests.
 */

let testOverride: StorageProvider | null = null;

/** Test seam — refuses to operate in production builds. */
export function setStorageProviderForTesting(
  provider: StorageProvider | null,
): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Storage provider overrides are not allowed in production.");
  }
  testOverride = provider;
}

export function getStorageProvider(): StorageProvider {
  if (testOverride !== null) {
    return testOverride;
  }
  // Dev/E2E filesystem driver — opt-in via env, refused in production
  // builds (see local-provider.ts). Real environments use Supabase.
  if (process.env.STORAGE_DRIVER === "local" && process.env.NODE_ENV !== "production") {
    return createLocalStorageProvider();
  }
  return createSupabaseStorageProvider();
}
