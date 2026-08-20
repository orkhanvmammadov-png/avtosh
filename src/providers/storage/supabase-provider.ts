import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env/server";
import {
  StorageOperationError,
  type SignedUpload,
  type StorageProvider,
} from "@/providers/storage/types";

/**
 * Supabase Storage adapter. Uses the service-role key, so this module
 * is server-only and the client is created lazily — never during
 * build and never in client bundles. Raw Supabase errors are wrapped;
 * bucket internals and credentials never leak to callers.
 */

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cachedClient === null) {
    const env = serverEnv();
    if (env.SUPABASE_URL === undefined || env.SUPABASE_SERVICE_ROLE_KEY === undefined) {
      throw new StorageOperationError(
        "Supabase Storage is not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
      );
    }
    cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedClient;
}

export function createSupabaseStorageProvider(): StorageProvider {
  return {
    async createSignedUploadUrl(bucket, path): Promise<SignedUpload> {
      // Supabase signed upload URLs currently have a fixed short
      // provider-side validity; our own expires_at governs the
      // application-level window.
      const { data, error } = await getClient()
        .storage.from(bucket)
        .createSignedUploadUrl(path);
      if (error !== null || data === null) {
        throw new StorageOperationError("Failed to create signed upload URL.");
      }
      return { url: data.signedUrl, token: data.token };
    },

    async downloadObject(bucket, path): Promise<Buffer | null> {
      const { data, error } = await getClient().storage.from(bucket).download(path);
      if (error !== null || data === null) {
        return null;
      }
      return Buffer.from(await data.arrayBuffer());
    },

    async uploadObject(bucket, path, data, contentType): Promise<void> {
      const { error } = await getClient()
        .storage.from(bucket)
        .upload(path, data, { contentType, upsert: true });
      if (error !== null) {
        throw new StorageOperationError("Failed to store processed object.");
      }
    },

    async deleteObject(bucket, path): Promise<void> {
      const { error } = await getClient().storage.from(bucket).remove([path]);
      if (error !== null) {
        throw new StorageOperationError("Failed to delete storage object.");
      }
    },

    async createSignedReadUrl(bucket, path, expiresInSeconds): Promise<string> {
      const { data, error } = await getClient()
        .storage.from(bucket)
        .createSignedUrl(path, expiresInSeconds);
      if (error !== null || data === null) {
        throw new StorageOperationError("Failed to create signed read URL.");
      }
      return data.signedUrl;
    },
  };
}
