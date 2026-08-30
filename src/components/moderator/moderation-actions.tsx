"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { STAFF } from "@/lib/marketplace/labels";
import { publicFetch, PublicApiError } from "@/lib/marketplace/public-api";
import { REASON_LABELS } from "@/lib/seller/status";

type ActionKind = "approve" | "reject" | "request-correction" | "suspend";

const ACTION_META: Record<ActionKind, { label: string; done: string; needsReason: boolean; tone: "primary" | "danger" }> = {
  approve: { label: STAFF.approve, done: STAFF.approvedDone, needsReason: false, tone: "primary" },
  reject: { label: STAFF.reject, done: STAFF.rejectedDone, needsReason: true, tone: "danger" },
  "request-correction": { label: STAFF.correction, done: STAFF.correctionDone, needsReason: true, tone: "danger" },
  suspend: { label: STAFF.suspend, done: STAFF.suspendedDone, needsReason: true, tone: "danger" },
};

/**
 * Decision workbench. The backend is the only authority: every
 * command re-checks staff RBAC, claim ownership (queue decisions),
 * and expected_revision; this component only sequences requests and
 * renders the safe conflict states. Two-step confirmation prevents
 * accidental one-click final decisions.
 */
const emptySubscribe = () => () => {};
/** False during SSR/pre-hydration, true the moment React is live. */
function useHydrated(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export function ModerationActions({
  listingId,
  status,
  revision,
  claimMine,
  claimOther,
  claimExpiresAt,
}: {
  listingId: string;
  status: string;
  revision: number;
  claimMine: boolean;
  claimOther: boolean;
  claimExpiresAt: string | null;
}) {
  // The portal recovers via FULL page reloads; a click on a freshly
  // loaded page must never land before React's handlers exist.
  // Buttons stay disabled until hydration — an honest state (a
  // pre-hydration click would silently do nothing otherwise).
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<"stale" | "decided" | "claim" | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionKind | null>(null);
  const [reasonCode, setReasonCode] = useState<string>("INVALID_PHOTOS");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const base = `/api/v1/moderator/listings/${listingId}`;
  const isPending = status === "PENDING_MODERATION";
  const isActive = status === "ACTIVE";

  function handleError(error: unknown) {
    if (error instanceof PublicApiError) {
      if (error.code === "LISTING_REVISION_CONFLICT") return setConflict("stale");
      if (error.code === "MODERATION_INVALID_STATE") return setConflict("decided");
      if (error.code === "MODERATION_CLAIMED_BY_OTHER") return setConflict("claim");
      if (error.code === "MODERATION_CLAIM_REQUIRED") return setMessage(STAFF.claimRequired);
    }
    setMessage(STAFF.actionFailed);
  }

  async function claim() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setConflict(null);
    try {
      await publicFetch(`${base}/claim`, { method: "POST" });
      // Full document reload: the portal deliberately uses no
      // router.refresh at all — an in-flight RSC refresh stream can
      // race the moderator's next interaction on slow runners
      // (swallowed clicks / stale-revision submissions). A document
      // load renders every state fresh and leaves nothing in flight.
      window.location.reload();
    } catch (error) {
      handleError(error);
      setBusy(false);
    }
  }

  async function execute(kind: ActionKind) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = { expected_revision: revision };
      if (ACTION_META[kind].needsReason) {
        body.reason_code = reasonCode;
        if (note.trim().length > 0) body.note = note.trim();
      }
      await publicFetch(`${base}/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      // Durable success state: NO automatic refresh/navigation — the
      // panel stays until the moderator explicitly moves on, so the
      // outcome is always user-observable (an immediate RSC refresh
      // here raced subsequent interactions and could strand the UI).
      setDone(ACTION_META[kind].done);
      setPendingAction(null);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <div className="rounded-card border border-primary/30 bg-primary/5 p-4" role="status" data-testid="decision-done">
        <p className="font-semibold text-navy">{done}</p>
        <div className="mt-4 flex flex-col gap-2">
          <Link
            href="/moderator/elanlar"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover"
            data-testid="done-back-to-queue"
          >
            {STAFF.backToQueue}
          </Link>
          <a
            href={`/moderator/elanlar/${listingId}`}
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-navy hover:bg-surface"
            data-testid="done-view-current"
          >
            {STAFF.viewCurrent}
          </a>
        </div>
      </div>
    );
  }

  if (conflict !== null) {
    return (
      <div className="rounded-card border border-danger/40 bg-danger/5 p-4" role="alert" data-testid="decision-conflict">
        <p className="font-semibold text-danger">
          {conflict === "stale" ? STAFF.staleConflict : conflict === "decided" ? STAFF.decisionAlready : STAFF.claimTaken}
        </p>
        {/* FULL document reload: guarantees the next decision carries the
            current server revision, with no in-flight RSC refresh for
            subsequent interactions to race (a router.refresh here left
            stale client state interactive on slow runners). */}
        <Button className="mt-3" onClick={() => window.location.reload()} disabled={!hydrated} data-testid="conflict-refresh">
          {STAFF.refresh}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="moderation-actions">
      {isPending ? (
        <div aria-live="polite" data-testid="claim-state" data-claim={claimMine ? "mine" : claimOther ? "other" : "free"}>
          {claimMine ? (
            <p className="rounded-lg bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800">
              {STAFF.claimMine}
              {claimExpiresAt !== null
                ? ` (${new Date(claimExpiresAt).toLocaleTimeString("az-Latn-AZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baku" })} ${STAFF.claimUntil})`
                : null}
            </p>
          ) : claimOther ? (
            <div className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-800">
              {STAFF.claimOther}
              <Button variant="secondary" className="ml-3" onClick={() => void claim()} disabled={busy || !hydrated} data-testid="claim-button">
                {STAFF.claim}
              </Button>
            </div>
          ) : (
            <Button onClick={() => void claim()} disabled={busy || !hydrated} data-testid="claim-button">
              {STAFF.claim}
            </Button>
          )}
        </div>
      ) : null}

      {(isPending && claimMine) || isActive ? (
        <div className="flex flex-wrap gap-2" data-testid="decision-buttons">
          {isPending ? (
            <>
              <Button onClick={() => setPendingAction("approve")} disabled={busy || !hydrated} data-testid="action-approve">
                {STAFF.approve}
              </Button>
              <Button variant="secondary" onClick={() => setPendingAction("request-correction")} disabled={busy || !hydrated} data-testid="action-correction">
                {STAFF.correction}
              </Button>
              <Button variant="secondary" onClick={() => setPendingAction("reject")} disabled={busy || !hydrated} data-testid="action-reject">
                {STAFF.reject}
              </Button>
            </>
          ) : null}
          {isActive ? (
            <Button variant="secondary" onClick={() => setPendingAction("suspend")} disabled={busy || !hydrated} data-testid="action-suspend">
              {STAFF.suspend}
            </Button>
          ) : null}
        </div>
      ) : null}

      {pendingAction !== null ? (
        <section
          aria-label={STAFF.confirmAction}
          className="rounded-card border border-line bg-white p-4"
          data-testid="decision-confirm"
        >
          <h3 className="text-sm font-semibold text-navy">
            {STAFF.confirmAction}: {ACTION_META[pendingAction].label}
          </h3>
          {ACTION_META[pendingAction].needsReason ? (
            <div className="mt-3 space-y-3">
              <label className="block text-sm font-medium text-navy" htmlFor="decision-reason">
                {STAFF.reason}
                <select
                  id="decision-reason"
                  data-testid="decision-reason"
                  className="mt-1 min-h-12 w-full rounded-lg border border-line bg-white px-3 text-base text-navy"
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                >
                  {Object.entries(REASON_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-navy" htmlFor="decision-note">
                {STAFF.sellerNote}
                <textarea
                  id="decision-note"
                  data-testid="decision-note"
                  className="mt-1 min-h-24 w-full rounded-lg border border-line bg-white px-3 py-2 text-base text-navy"
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p className="text-xs text-muted">{STAFF.sellerNoteHint}</p>
            </div>
          ) : null}
          {message !== null ? (
            <p role="alert" className="mt-3 text-sm text-danger" data-testid="decision-error">
              {message}
            </p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => void execute(pendingAction)} disabled={busy || !hydrated} data-testid="decision-submit">
              {STAFF.confirm}
            </Button>
            <Button variant="secondary" onClick={() => setPendingAction(null)} disabled={busy || !hydrated} data-testid="decision-cancel">
              {STAFF.cancel}
            </Button>
          </div>
        </section>
      ) : message !== null ? (
        <p role="alert" className="text-sm text-danger" data-testid="action-message">
          {message}
        </p>
      ) : null}
    </div>
  );
}
