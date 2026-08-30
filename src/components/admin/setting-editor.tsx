"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { ADMIN } from "@/lib/marketplace/labels";
import { publicFetch, PublicApiError } from "@/lib/marketplace/public-api";

/**
 * Single typed-setting editor: integer value with server-enforced
 * bounds, two-step confirmation, version token for optimistic
 * concurrency, explicit conflict recovery.
 */
export function SettingEditor({
  settingKey,
  value,
  version,
}: {
  settingKey: string;
  value: number;
  version: string;
}) {
  const hydrated = useHydrated();
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  async function save() {
    if (busy) return;
    const next = Number(draft);
    if (!Number.isSafeInteger(next)) {
      setMessage("Dəyər tam ədəd olmalıdır.");
      setConfirming(false);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await publicFetch("/api/v1/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: settingKey, value: next, version }),
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
      setConfirming(false);
    }
  }

  if (conflict) {
    return (
      <div role="alert" className="text-sm" data-testid={`setting-conflict-${settingKey}`}>
        <p className="font-semibold text-danger">{ADMIN.editConflict}</p>
        <Button className="mt-1" variant="secondary" onClick={() => window.location.reload()} disabled={!hydrated}>
          {ADMIN.refresh}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`setting-editor-${settingKey}`}>
      <input
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="min-h-12 w-28 rounded-lg border border-line bg-white px-2 text-sm text-navy"
        aria-label={ADMIN.settingValue}
        data-testid="setting-input"
      />
      {confirming ? (
        <span className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1 text-xs" data-testid="setting-confirm">
          {ADMIN.settingConfirm}
          <Button onClick={() => void save()} disabled={busy || !hydrated} data-testid="setting-confirm-submit">
            Bəli
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
            İmtina
          </Button>
        </span>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)} disabled={!hydrated} data-testid="setting-save">
          {ADMIN.save}
        </Button>
      )}
      {message !== null ? (
        <p role="alert" className="text-xs text-danger" data-testid="setting-error">{message}</p>
      ) : null}
    </div>
  );
}
