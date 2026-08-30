"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { ADMIN } from "@/lib/marketplace/labels";
import { publicFetch, PublicApiError } from "@/lib/marketplace/public-api";

/**
 * Generic deliberate-confirmation mutation control for the admin
 * console (Phase 4.14 determinism pattern: hydration-gated, full
 * reload on success, explicit conflict recovery). Shows exactly what
 * will change via title/description; an optional single reason field
 * feeds the request body.
 */
export function ConfirmAction({
  label,
  title,
  description,
  url,
  method = "POST",
  body = {},
  reasonField = null,
  variant = "secondary",
  testid,
}: {
  label: string;
  title: string;
  description?: string;
  url: string;
  method?: "POST" | "PATCH";
  body?: Record<string, unknown>;
  reasonField?: { name: string; label: string } | null;
  variant?: "primary" | "secondary";
  testid: string;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  async function execute() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { ...body };
      if (reasonField !== null && reason.trim().length > 0) {
        payload[reasonField.name] = reason.trim();
      }
      await publicFetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      window.location.reload(); // deterministic fresh state
    } catch (err) {
      if (err instanceof PublicApiError && err.code === "LISTING_REVISION_CONFLICT") {
        setConflict(true);
      } else if (err instanceof PublicApiError) {
        setError(err.message);
      } else {
        setError(ADMIN.actionFailed);
      }
      setBusy(false);
    }
  }

  if (conflict) {
    return (
      <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm" data-testid={`${testid}-conflict`}>
        <p className="font-semibold text-danger">{ADMIN.editConflict}</p>
        <Button className="mt-2" onClick={() => window.location.reload()} disabled={!hydrated}>
          {ADMIN.refresh}
        </Button>
      </div>
    );
  }

  if (!open) {
    return (
      <Button variant={variant} onClick={() => setOpen(true)} disabled={!hydrated} data-testid={testid}>
        {label}
      </Button>
    );
  }

  return (
    <section aria-label={title} className="rounded-lg border border-line bg-white p-3" data-testid={`${testid}-confirm`}>
      <p className="text-sm font-semibold text-navy">{title}</p>
      {description !== undefined ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
      {reasonField !== null ? (
        <label className="mt-2 block text-sm font-medium text-navy" htmlFor={`${testid}-reason`}>
          {reasonField.label}
          <textarea
            id={`${testid}-reason`}
            data-testid={`${testid}-reason`}
            className="mt-1 min-h-16 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-navy"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      ) : null}
      {error !== null ? (
        <p role="alert" className="mt-2 text-sm text-danger" data-testid={`${testid}-error`}>
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button onClick={() => void execute()} disabled={busy || !hydrated} data-testid={`${testid}-submit`}>
          {label}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy} data-testid={`${testid}-cancel`}>
          İmtina
        </Button>
      </div>
    </section>
  );
}
