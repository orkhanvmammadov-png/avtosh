"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PublicApiError } from "@/lib/marketplace/public-api";
import { SELLER } from "@/lib/marketplace/labels";
import { createOrGetEditRevision } from "@/lib/seller/owner-api";

/**
 * O.12 "Redaktə et" entry: an explicit POST creates (or converges on)
 * THE open edit revision, then navigates into the edit route. A plain
 * link would let a GET/prefetch create state — this button keeps
 * revision creation an intentional action.
 */
export function EditEntryButton({
  listingId,
  primary,
}: {
  listingId: string;
  primary: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await createOrGetEditRevision(listingId);
      router.push(`/profil/elanlar/${listingId}/redakte`);
    } catch (err) {
      setError(
        err instanceof PublicApiError && err.code === "LISTING_LIFECYCLE_CONFLICT"
          ? SELLER.lifecycleConflict
          : SELLER.saveError,
      );
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => void start()}
        data-testid="owner-edit"
        className={
          primary
            ? "inline-flex min-h-12 items-center justify-center rounded-control bg-primary px-3 text-sm font-semibold tracking-[0.01em] text-white transition-colors duration-150 hover:bg-primary-hover active:bg-primary-pressed disabled:cursor-not-allowed disabled:opacity-50"
            : "inline-flex min-h-12 items-center justify-center rounded-control border border-primary px-3 text-sm font-semibold tracking-[0.01em] text-primary transition-colors duration-150 hover:bg-primary-tint active:bg-primary-tint-pressed disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {SELLER.actionEdit}
      </button>
      {error !== null ? (
        <p aria-live="polite" className="max-w-44 text-xs font-medium text-danger" data-testid="owner-edit-error">
          {error}
        </p>
      ) : null}
    </>
  );
}
