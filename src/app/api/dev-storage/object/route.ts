import { NextResponse } from "next/server";
import {
  readLocalObject,
  verifyStorageSignature,
} from "@/providers/storage/local-provider";

export const dynamic = "force-dynamic";

/** Dev/E2E-only signed read endpoint for locally stored objects. */
export async function GET(request: Request): Promise<Response> {
  if (process.env.STORAGE_DRIVER !== "local" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  const bucket = params.get("bucket") ?? "";
  const path = params.get("path") ?? "";
  const expiresAtMs = Number(params.get("expires"));
  const sig = params.get("sig") ?? "";
  if (!verifyStorageSignature({ method: "GET", bucket, path, expiresAtMs, signature: sig })) {
    return NextResponse.json({ error: "Invalid or expired signature" }, { status: 403 });
  }
  const data = await readLocalObject(bucket, path);
  if (data === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "content-type": path.endsWith(".webp") ? "image/webp" : "application/octet-stream",
      "cache-control": "private, no-store",
    },
  });
}
