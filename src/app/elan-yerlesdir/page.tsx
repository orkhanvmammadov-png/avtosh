import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { UI } from "@/lib/marketplace/labels";

export const metadata: Metadata = {
  title: `${UI.postListing} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * Authenticated placeholder for the seller wizard (explicitly out of
 * Phase 4.10 scope). Exists so the header CTA has a working protected
 * destination and the login-intent round trip is real.
 */
export default async function PostListingPage() {
  const auth = await getCurrentAuthFromCookies();
  if (auth === null) {
    redirect("/giris?return_to=%2Felan-yerlesdir");
  }
  return (
    <div className="py-16 text-center" data-testid="seller-stub">
      <h1 className="text-2xl font-bold text-navy">{UI.sellerComingSoon}</h1>
      <p className="mt-2 text-sm text-muted">{UI.sellerComingSoonHint}</p>
    </div>
  );
}
