import {
  type SignedUpload,
  type StorageProvider,
} from "@/providers/storage/types";

/**
 * In-memory storage provider for deterministic tests. Signed upload
 * URLs are opaque memory:// URLs; tests simulate the browser's direct
 * upload with uploadViaSignedUrl. Nothing is ever persisted.
 */
export interface MemoryStorageProvider extends StorageProvider {
  objects: Map<string, { data: Buffer; contentType: string }>;
  issuedUploads: Map<string, { bucket: string; path: string }>;
  uploadViaSignedUrl(url: string, data: Buffer, contentType?: string): void;
  has(bucket: string, path: string): boolean;
  reset(): void;
}

function key(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

export function createMemoryStorageProvider(): MemoryStorageProvider {
  let uploadCounter = 0;
  const provider: MemoryStorageProvider = {
    objects: new Map(),
    issuedUploads: new Map(),

    async createSignedUploadUrl(bucket, path): Promise<SignedUpload> {
      uploadCounter += 1;
      const url = `memory://signed-upload/${uploadCounter}`;
      provider.issuedUploads.set(url, { bucket, path });
      return { url, token: `memory-token-${uploadCounter}` };
    },

    async downloadObject(bucket, path): Promise<Buffer | null> {
      const stored = provider.objects.get(key(bucket, path));
      return stored === undefined ? null : stored.data;
    },

    async uploadObject(bucket, path, data, contentType): Promise<void> {
      provider.objects.set(key(bucket, path), { data, contentType });
    },

    async deleteObject(bucket, path): Promise<void> {
      provider.objects.delete(key(bucket, path));
    },

    async createSignedReadUrl(bucket, path): Promise<string> {
      return `memory://signed-read/${key(bucket, path)}`;
    },

    uploadViaSignedUrl(url, data, contentType = "application/octet-stream") {
      const target = provider.issuedUploads.get(url);
      if (target === undefined) {
        throw new Error("Unknown signed upload URL");
      }
      provider.objects.set(key(target.bucket, target.path), {
        data,
        contentType,
      });
    },

    has(bucket, path) {
      return provider.objects.has(key(bucket, path));
    },

    reset() {
      provider.objects.clear();
      provider.issuedUploads.clear();
      uploadCounter = 0;
    },
  };
  return provider;
}
