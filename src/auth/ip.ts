import { requireOtpPepper } from "@/auth/config";
import { hashIp } from "@/auth/otp-crypto";

/**
 * Privacy-preserving client IP key for rate limiting.
 *
 * Trust model: on Vercel the platform sets x-forwarded-for with the
 * real client address first; behind Cloudflare the platform chain
 * still terminates at Vercel. Self-hosted deployments must ensure the
 * edge strips/overwrites client-supplied values — this header is only
 * as trustworthy as the proxy in front of the app. When no header is
 * present (local dev, direct invocation) IP limiting is skipped
 * rather than trusting fabrication. Never returns or stores a raw IP.
 */
export function clientIpHash(request: Request): string | null {
  const header = request.headers.get("x-forwarded-for");
  const first = header?.split(",")[0]?.trim();
  if (first === undefined || first.length === 0 || first.length > 64) {
    return null;
  }
  return hashIp(requireOtpPepper(), first);
}
