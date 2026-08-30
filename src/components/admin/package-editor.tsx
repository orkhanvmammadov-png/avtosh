"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { aznInputToMinor, minorToAznInput } from "@/lib/format";
import { ADMIN } from "@/lib/marketplace/labels";
import { publicFetch, PublicApiError } from "@/lib/marketplace/public-api";

/**
 * Package row editor: AZN price input (converted exactly to minor
 * units at the boundary), activate/deactivate with confirmation, and
 * optimistic-concurrency conflicts surfaced explicitly.
 */
export function PackageEditor({
  packageId,
  priceMinor,
  isActive,
  version,
}: {
  packageId: string;
  priceMinor: number;
  isActive: boolean;
  version: string;
}) {
  const hydrated = useHydrated();
  const [price, setPrice] = useState(minorToAznInput(String(priceMinor)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirming, setConfirming] = useState<"activate" | "deactivate" | null>(null);

  async function patch(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await publicFetch("/api/v1/admin/promotion-packages", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ package_id: packageId, version, ...body }),
      });
      window.location.reload();
    } catch (error) {
      if (error instanceof PublicApiError && error.code === "LISTING_REVISION_CONFLICT") {
        setConflict(true);
      } else if (error instanceof PublicApiError) {
        setMessage(error.message);
      } else {
        setMessage(ADMIN.actionFailed);
      }
      setBusy(false);
    }
  }

  function savePrice() {
    const minor = aznInputToMinor(price);
    if (minor === null) {
      setMessage("Qiymət tam AZN olmalıdır.");
      return;
    }
    void patch({ price_minor: Number(minor) });
  }

  if (conflict) {
    return (
      <div role="alert" className="text-sm" data-testid={`pkg-conflict-${packageId}`}>
        <p className="font-semibold text-danger">{ADMIN.editConflict}</p>
        <Button className="mt-1" variant="secondary" onClick={() => window.location.reload()} disabled={!hydrated}>
          {ADMIN.refresh}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`pkg-editor-${packageId}`}>
      <label className="flex items-center gap-1 text-sm text-navy">
        <span className="sr-only">{ADMIN.priceAzn}</span>
        <input
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="min-h-12 w-24 rounded-lg border border-line bg-white px-2 text-sm text-navy"
          data-testid="pkg-price-input"
          aria-label={ADMIN.priceAzn}
        />
        <span className="text-muted">AZN</span>
      </label>
      <Button variant="secondary" onClick={savePrice} disabled={busy || !hydrated} data-testid="pkg-save-price">
        {ADMIN.save}
      </Button>
      {confirming !== null ? (
        <span className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1 text-xs" data-testid="pkg-confirm">
          {confirming === "activate" ? ADMIN.activateConfirm : ADMIN.deactivateConfirm}
          <Button
            onClick={() => void patch({ is_active: confirming === "activate" })}
            disabled={busy || !hydrated}
            data-testid="pkg-confirm-submit"
          >
            Bəli
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(null)} disabled={busy}>
            İmtina
          </Button>
        </span>
      ) : isActive ? (
        <Button variant="secondary" onClick={() => setConfirming("deactivate")} disabled={!hydrated} data-testid="pkg-deactivate">
          {ADMIN.deactivate}
        </Button>
      ) : (
        <Button onClick={() => setConfirming("activate")} disabled={!hydrated} data-testid="pkg-activate">
          {ADMIN.activate}
        </Button>
      )}
      {message !== null ? (
        <p role="alert" className="text-xs text-danger" data-testid="pkg-error">{message}</p>
      ) : null}
    </div>
  );
}
