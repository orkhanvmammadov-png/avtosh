/**
 * Object-storage abstraction. Services depend only on this interface;
 * the Supabase adapter and the in-memory test provider implement it.
 * All paths are server-generated — providers never see client input.
 */
export interface SignedUpload {
  /** URL the browser PUTs/POSTs the file to. */
  url: string;
  /** Provider-specific token when required (Supabase signed uploads). */
  token: string | null;
}

export interface StorageProvider {
  createSignedUploadUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number,
  ): Promise<SignedUpload>;
  /** Returns null when the object does not exist. */
  downloadObject(bucket: string, path: string): Promise<Buffer | null>;
  uploadObject(
    bucket: string,
    path: string,
    data: Buffer,
    contentType: string,
  ): Promise<void>;
  deleteObject(bucket: string, path: string): Promise<void>;
  createSignedReadUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number,
  ): Promise<string>;
}

export class StorageOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageOperationError";
  }
}
