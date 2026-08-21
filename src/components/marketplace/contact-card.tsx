"use client";

import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { UI } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";

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
    } catch {
      setError(UI.contactUnavailable);
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside aria-labelledby="contact-title" className="rounded-card border border-line bg-white p-4 md:p-6" data-testid="contact-card">
      <h2 id="contact-title" className="text-sm font-semibold uppercase tracking-wide text-muted">{UI.seller}</h2>
      <p className="mt-1 text-lg font-semibold text-navy">{displayName ?? "Satıcı"}</p>
      {contact === null ? (
        <>
          {maskedPhone ? <p className="mt-2 font-mono text-base text-muted" data-testid="contact-masked">{maskedPhone}</p> : null}
          <Button onClick={reveal} disabled={loading || maskedPhone === null} className="mt-4 w-full" data-testid="contact-reveal">
            {loading ? UI.loading : UI.showPhone}
          </Button>
          {maskedPhone === null ? <p className="mt-2 text-sm text-muted">{UI.contactUnavailable}</p> : null}
          {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
        </>
      ) : (
        <div className="mt-4 space-y-2">
          <a href={`tel:${contact.phone}`} className={buttonClasses("primary", "w-full")} data-testid="contact-call">
            {UI.callSeller}: {contact.phone}
          </a>
          <a href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", "w-full")} data-testid="contact-whatsapp">
            {UI.whatsapp}
          </a>
        </div>
      )}
    </aside>
  );
}
