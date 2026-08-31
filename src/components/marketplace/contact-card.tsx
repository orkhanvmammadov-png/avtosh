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
export function ContactCard({ publicId, displayName, maskedPhone }: { publicId: string; displayName: string | null; maskedPhone: string | null }) {
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

  // ONE instance serves both form factors purely via classes: a fixed
  // bottom action bar below the desk breakpoint, the sidebar card at
  // desk+. Same DOM, same testids, same reveal/rate-limit behavior.
  return (
    <aside
      aria-labelledby="contact-title"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raised p-3 shadow-overlay desk:static desk:rounded-card desk:border desk:p-6 desk:shadow-card"
      data-testid="contact-card"
    >
      <div className="mx-auto flex max-w-xl items-center gap-3 desk:mx-0 desk:block desk:max-w-none">
        <div className="min-w-0 flex-1 desk:flex-none">
          <h2 id="contact-title" className="hidden text-sm font-semibold uppercase tracking-wide text-faint desk:block">{UI.seller}</h2>
          <p className="truncate text-sm font-semibold text-navy desk:mt-1 desk:text-lg">{displayName ?? "Satıcı"}</p>
          {contact === null && maskedPhone ? (
            <p className="truncate font-mono text-xs text-muted desk:mt-2 desk:text-base" data-testid="contact-masked">{maskedPhone}</p>
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
            {maskedPhone === null ? <p className="mt-2 hidden text-sm text-muted desk:block">{UI.contactUnavailable}</p> : null}
            {error ? <p role="alert" className="mt-1 text-xs text-danger desk:mt-2 desk:text-sm">{error}</p> : null}
          </div>
        ) : (
          <div className="flex shrink-0 gap-2 desk:mt-4 desk:flex-col">
            <a href={`tel:${contact.phone}`} className={buttonClasses("primary", "w-full whitespace-nowrap")} data-testid="contact-call">
              {UI.callSeller}: {contact.phone}
            </a>
            <a href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", "w-full")} data-testid="contact-whatsapp">
              {UI.whatsapp}
            </a>
          </div>
        )}
      </div>
    </aside>
  );
}
