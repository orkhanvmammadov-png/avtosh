"use client";

import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
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
}: {
  publicId: string;
  displayName: string | null;
  maskedPhone: string | null;
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
  // fixed mobile contact bar below desk, and the unchromed CTA block
  // inside the O.7 identity panel at desk+ (the panel supplies the
  // surface). Same DOM, same testids, same reveal/rate-limit behavior.
  return (
    <aside
      aria-labelledby="contact-title"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-navy-border bg-navy p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white md:static md:border-0 md:bg-transparent md:p-0"
      data-testid="contact-card"
    >
      <h2 id="contact-title" className="sr-only">{UI.seller}</h2>
      <div className="mx-auto flex max-w-xl items-center gap-3 md:mx-0 md:block md:max-w-none">
        <div className="min-w-0 flex-1 md:hidden">
          <p className="truncate text-sm font-semibold text-white">{displayName ?? "Satıcı"}</p>
          {contact === null && maskedPhone ? (
            <p className="truncate font-mono text-xs text-on-navy-muted" data-testid="contact-masked">{maskedPhone}</p>
          ) : null}
        </div>
        {contact === null ? (
          <div className="shrink-0 md:block">
            <Button onClick={reveal} disabled={loading || maskedPhone === null} className="min-h-12 w-full min-w-40 md:min-h-11 md:w-auto md:min-w-0 md:px-[22px] md:text-[13px] desk:w-full xl:min-h-12 xl:text-sm" data-testid="contact-reveal">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 4h4l2 5-2.5 1.5a11 11 0 0 0 4 4L15 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 2-2z" />
              </svg>
              {loading ? UI.loading : UI.showPhone}
            </Button>
            {maskedPhone === null ? <p className="mt-1 text-xs text-on-navy-muted desk:mt-2">{UI.contactUnavailable}</p> : null}
            {error ? <p role="alert" className="mt-1 text-xs text-[#F2B8B5] desk:mt-2 desk:text-sm">{error}</p> : null}
          </div>
        ) : (
          <div className="flex shrink-0 gap-2 md:items-center desk:flex-col desk:items-stretch">
            {/* Revealed: phone = PRIMARY, WhatsApp = SECONDARY (existing contract). */}
            <a href={`tel:${contact.phone}`} className={buttonClasses("primary", "min-h-12 w-full whitespace-nowrap md:min-h-11 md:w-auto md:px-4 desk:w-full xl:min-h-12")} data-testid="contact-call">
              {UI.callSeller}: {contact.phone}
            </a>
            <a
              href={contact.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses("secondary", "w-full border-navy-border bg-transparent text-white hover:border-green-dark hover:text-green-dark active:bg-white/5 md:w-auto desk:w-full")}
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
