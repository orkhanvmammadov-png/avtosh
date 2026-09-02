"use client";

import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { PromotionBadge } from "@/components/ui/promotion-badge";
import { UI } from "@/lib/marketplace/labels";
import { publicFetch, PublicApiError } from "@/lib/marketplace/public-api";

/**
 * Seller contact: masked until the buyer explicitly reveals it through
 * POST /api/v1/listings/:publicId/contact. Non-contactable listings
 * never render this component (the server decides).
 */
export function ContactCard({
  publicId,
  displayName,
  maskedPhone,
  priceLabel,
  premium = false,
}: {
  publicId: string;
  displayName: string | null;
  maskedPhone: string | null;
  /** Presentation-only: Condensed price rendered inside the panel (≥desk). */
  priceLabel?: string;
  premium?: boolean;
}) {
  const [contact, setContact] = useState<{ phone: string; whatsappUrl: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await publicFetch<{ contact: { phone: string; whatsappUrl: string } }>(
        `/api/v1/listings/${encodeURIComponent(publicId)}/contact`,
        { method: "POST" },
      );
      setContact(data.contact);
    } catch (err) {
      // 429 gets its own Azerbaijani message; never a raw API error, never a silent retry.
      setError(err instanceof PublicApiError && err.code === "CONTACT_RATE_LIMITED" ? UI.contactRateLimited : UI.contactUnavailable);
    } finally {
      setLoading(false);
    }
  }

  // ONE instance serves both form factors purely via classes: the
  // approved fixed MobileStickyContact bar below desk, the sticky
  // navy-raised ContactPanel at desk+. Same DOM, same testids, same
  // reveal/rate-limit behavior.
  return (
    <aside
      aria-labelledby="contact-title"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-navy-border bg-navy p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white desk:static desk:rounded-[12px] desk:border desk:bg-navy-raised desk:p-5"
      data-testid="contact-card"
    >
      <div className="mx-auto flex max-w-xl items-center gap-3 desk:mx-0 desk:block desk:max-w-none">
        <div className="min-w-0 flex-1 desk:flex-none">
          {premium ? <span className="mb-2 hidden desk:block"><PromotionBadge type="PREMIUM" /></span> : null}
          {priceLabel !== undefined ? (
            <p className="hidden font-condensed text-[34px] font-bold leading-none desk:block">{priceLabel}</p>
          ) : null}
          <h2 id="contact-title" className="hidden text-[11px] font-semibold uppercase tracking-[0.06em] text-on-navy-muted desk:mt-4 desk:block">{UI.seller}</h2>
          <p className="truncate text-sm font-semibold text-white desk:mt-0.5 desk:text-base">{displayName ?? "Satıcı"}</p>
          {contact === null && maskedPhone ? (
            <p className="truncate font-mono text-xs text-on-navy-muted desk:mt-1.5 desk:text-sm" data-testid="contact-masked">{maskedPhone}</p>
          ) : null}
        </div>
        {contact === null ? (
          <div className="shrink-0 desk:mt-4 desk:block">
            <Button onClick={reveal} disabled={loading || maskedPhone === null} className="w-full min-w-40 desk:min-w-0" data-testid="contact-reveal">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 4h4l2 5-2.5 1.5a11 11 0 0 0 4 4L15 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 2-2z" />
              </svg>
              {loading ? UI.loading : UI.showPhone}
            </Button>
            {maskedPhone === null ? <p className="mt-1 text-xs text-on-navy-muted desk:mt-2">{UI.contactUnavailable}</p> : null}
            {error ? <p role="alert" className="mt-1 text-xs text-[#F2B8B5] desk:mt-2 desk:text-sm">{error}</p> : null}
          </div>
        ) : (
          <div className="flex shrink-0 gap-2 desk:mt-4 desk:flex-col">
            <a href={`tel:${contact.phone}`} className={buttonClasses("primary", "w-full whitespace-nowrap")} data-testid="contact-call">
              {UI.callSeller}: {contact.phone}
            </a>
            <a
              href={contact.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses("secondary", "w-full border-navy-border bg-transparent text-white hover:border-green-dark hover:text-green-dark active:bg-white/5")}
              data-testid="contact-whatsapp"
            >
              {UI.whatsapp}
            </a>
          </div>
        )}
      </div>
    </aside>
  );
}
