import { NextResponse } from "next/server";
import {
  verifyStorageSignature,
  writeLocalObject,
} from "@/providers/storage/local-provider";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12_582_912; // mirrors the bucket-side 12MB limit

/**
 * Dev/E2E-only signed direct-upload target (the local stand-in for
 * Supabase Storage's signed upload URL). Inert unless
 * STORAGE_DRIVER=local outside production. Authorization is the HMAC
 * signature issued by the local provider; paths never come from
 * client-shaped input.
 */
export async function PUT(request: Request): Promise<Response> {
  if (process.env.STORAGE_DRIVER !== "local" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  const bucket = params.get("bucket") ?? "";
  const path = params.get("path") ?? "";
  const expiresAtMs = Number(params.get("expires"));
  const sig = params.get("sig") ?? "";
  if (!verifyStorageSignature({ method: "PUT", bucket, path, expiresAtMs, signature: sig })) {
    return NextResponse.json({ error: "Invalid or expired signature" }, { status: 403 });
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length === 0 || body.length > MAX_BYTES) {
    return NextResponse.json({ error: "Invalid payload size" }, { status: 413 });
  }
  await writeLocalObject(bucket, path, body);
  return NextResponse.json({ ok: true });
}
