"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SELLER } from "@/lib/marketplace/labels";
import type { OwnerManagement } from "@/lib/seller/management";

/**
 * O.12 Stage B seller lifecycle actions (02-my-listings.md +
 * 04-reactivation-flows.md): "Deaktiv et" (ghost, reversible-navy
 * confirm dialog / 390 bottom sheet) and "Aktiv et". All eligibility
 * comes from the server-derived management DTO; after every mutation
 * the card re-renders from a fresh server read (router.refresh()) —
 * the client never invents lifecycle state. Feedback uses the exact
 * approved copy in an aria-live region. Edit navigation is Stage C:
 * an EDIT_INCOMPLETE outcome shows the approved notice, never a link.
 */
export function ListingLifecycleActions({
  listingId,
  revision,
  management,
}: {
  listingId: string;
  revision: number;
  management: OwnerManagement;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "info" | "error"; text: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // dialog semantics: focus moves in on open, Esc closes, focus returns
  useEffect(() => {
    if (!confirming) return;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirming(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  async function post(action: "deactivate" | "reactivate"): Promise<void> {
    if (pending) return; // double-submit guard; server stays authoritative
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/v1/me/listings/${listingId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected_revision: revision }),
      });
      const payload = (await response.json()) as {
        data?: { outcome?: string };
        error?: { code?: string };
      };
      if (!response.ok) {
        setFeedback({
          tone: "error",
          text:
            payload.error?.code === "LISTING_REVISION_CONFLICT"
              ? SELLER.lifecycleConflict
              : SELLER.saveError,
        });
        return;
      }
      if (action === "deactivate") {
        setFeedback({ tone: "success", text: SELLER.toastDeactivated });
      } else {
        const outcome = payload.data?.outcome;
        if (outcome === "REACTIVATED") {
          setFeedback({ tone: "success", text: SELLER.toastActivated });
        } else if (outcome === "EDIT_INCOMPLETE") {
          // not an error: the edit must be completed and submitted
          // (Stage C adds the navigation into AXIN edit mode)
          setFeedback({ tone: "info", text: SELLER.activateWithDraftNotice });
        }
        // AWAITING_MODERATION / CORRECTION_REQUIRED / RENEWAL_REQUIRED:
        // the refreshed server DTO renders the approved state lines
      }
      router.refresh();
    } catch {
      setFeedback({ tone: "error", text: SELLER.saveError });
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2">
      {management.canDeactivate ? (
        <button
          ref={triggerRef}
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
          data-testid="owner-deactivate"
          className="inline-flex min-h-11 items-center justify-center rounded-control px-3 text-sm font-semibold tracking-[0.01em] text-slate-strong transition-colors duration-150 hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {SELLER.actionDeactivate}
        </button>
      ) : null}

      {management.canReactivate ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => void post("reactivate")}
          data-testid="owner-reactivate"
          className="inline-flex min-h-11 items-center justify-center rounded-control border border-primary px-3 text-sm font-semibold tracking-[0.01em] text-primary transition-colors duration-150 hover:bg-primary-tint disabled:cursor-not-allowed disabled:opacity-50"
        >
          {SELLER.actionActivate}
        </button>
      ) : null}

      <p aria-live="polite" className="m-0 min-h-0" data-testid="owner-lifecycle-feedback">
        {feedback !== null ? (
          <span
            className={`block max-w-44 text-xs leading-snug ${
              feedback.tone === "success"
                ? "font-semibold text-success"
                : feedback.tone === "info"
                  ? "text-slate-strong"
                  : "font-medium text-danger"
            }`}
          >
            {feedback.text}
          </span>
        ) : null}
      </p>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={() => setConfirming(false)}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`deactivate-title-${listingId}`}
            aria-describedby={`deactivate-body-${listingId}`}
            tabIndex={-1}
            data-testid="deactivate-dialog"
            onClick={(event) => event.stopPropagation()}
            className="w-full rounded-t-[14px] bg-raised p-5 outline-none md:w-[400px] md:rounded-card"
          >
            <h2 id={`deactivate-title-${listingId}`} className="text-[15px] font-bold text-ink">
              {SELLER.deactivateDialogTitle}
            </h2>
            <p id={`deactivate-body-${listingId}`} className="mt-2 text-[13px] leading-relaxed text-slate-strong">
              {SELLER.deactivateDialogBody}
            </p>
            <div className="mt-4 flex flex-col gap-2 md:flex-row md:justify-end">
              <button
                type="button"
                disabled={pending}
                onClick={() => void post("deactivate")}
                data-testid="deactivate-confirm"
                className="inline-flex min-h-11 items-center justify-center rounded-control bg-navy px-4 text-sm font-semibold text-white transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 md:order-2"
              >
                {SELLER.actionDeactivate}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirming(false);
                  triggerRef.current?.focus();
                }}
                data-testid="deactivate-cancel"
                className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:border-muted md:order-1"
              >
                {SELLER.deactivateDialogCancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
