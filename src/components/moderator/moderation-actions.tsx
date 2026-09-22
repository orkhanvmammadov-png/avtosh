"use client";

import Link from "next/link";
import { useState } from "react";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { Button } from "@/components/ui/button";
import { formatTimeAz } from "@/lib/format";
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
export function ModerationActions({
  listingId,
  status,
  revision,
  claimMine,
  claimOther,
  claimExpiresAt,
  editRevisionNo = null,
  lockedReason = null,
  adjustmentRevision = null,
  adjustmentSummary = [],
}: {
  listingId: string;
  status: string;
  revision: number;
  claimMine: boolean;
  claimOther: boolean;
  claimExpiresAt: string | null;
  /** O.12: non-null when a PENDING edit revision awaits review — the
      decisions then address the EDIT endpoints with the edit revision's
      own counter. Same claim, same verbs, same confirmation flow. */
  editRevisionNo?: number | null;
  /** O.13 Stage B: non-null renders the queue decisions disabled with
      a visible reason (EDIT adjustment / unsaved edit) — the server
      refuses these decisions independently. */
  lockedReason?: string | null;
  /** O.13 Stage C: the OPEN NEW adjustment's own revision — sent with
      every NEW decision so a newer save blocks a stale decision; null
      when no NEW adjustment exists. */
  adjustmentRevision?: number | null;
  /** Concise changed-area labels for the adjusted-approval confirmation. */
  adjustmentSummary?: string[];
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
  const editPending = editRevisionNo !== null;
  const reviewPending = isPending || editPending;
  const isActive = status === "ACTIVE";

  const EDIT_DONE: Record<string, string> = {
    approve: STAFF.editApprovedDone,
    reject: STAFF.editRejectedDone,
    "request-correction": STAFF.editCorrectionDone,
  };

  function handleError(error: unknown) {
    if (error instanceof PublicApiError) {
      if (error.code === "LISTING_REVISION_CONFLICT") return setConflict("stale");
      // O.13 Stage C: a newer adjustment save or a changed moderation
      // pass invalidates this decision view — same reload recovery
      if (error.code === "MODERATION_ADJUSTMENT_CONFLICT") return setConflict("stale");
      if (error.code === "MODERATION_SUBJECT_CHANGED") return setConflict("stale");
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
      // O.12: edit-revision decisions address the edit endpoints with
      // the EDIT revision's own counter (suspend stays listing-level)
      const isEditDecision = editPending && kind !== "suspend";
      const body: Record<string, unknown> = isEditDecision
        ? { expected_edit_revision: editRevisionNo }
        : { expected_revision: revision };
      // O.13 Stage C: a NEW decision over a saved adjustment must name
      // the exact adjustment version it reviewed
      if (adjustmentRevision !== null && !isEditDecision && kind !== "suspend") {
        body.expected_adjustment_revision = adjustmentRevision;
      }
      if (ACTION_META[kind].needsReason) {
        body.reason_code = reasonCode;
        if (note.trim().length > 0) body.note = note.trim();
      }
      await publicFetch(isEditDecision ? `${base}/edit/${kind}` : `${base}/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      // Durable success state: NO automatic refresh/navigation — the
      // panel stays until the moderator explicitly moves on, so the
      // outcome is always user-observable (an immediate RSC refresh
      // here raced subsequent interactions and could strand the UI).
      setDone(isEditDecision ? EDIT_DONE[kind] : ACTION_META[kind].done);
      setPendingAction(null);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <div className="rounded-staff bg-success-soft p-4" role="status" data-testid="decision-done">
        <p className="font-semibold text-success">{done}</p>
        <div className="mt-4 flex flex-col gap-2">
          <Link
            href="/moderator/elanlar"
            className="inline-flex min-h-12 items-center justify-center rounded-staff bg-primary px-4 text-sm font-semibold tracking-[0.01em] text-white transition-colors duration-150 hover:bg-primary-hover"
            data-testid="done-back-to-queue"
          >
            {STAFF.backToQueue}
          </Link>
          <a
            href={`/moderator/elanlar/${listingId}`}
            className="inline-flex min-h-12 items-center justify-center rounded-staff border border-line-strong bg-raised px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:border-muted hover:bg-row-hover"
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
      <div className="rounded-staff border-l-4 border-danger bg-danger-soft p-4" role="alert" data-testid="decision-conflict">
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
      {reviewPending ? (
        <div aria-live="polite" data-testid="claim-state" data-claim={claimMine ? "mine" : claimOther ? "other" : "free"}>
          {claimMine ? (
            <p className="rounded-staff bg-success-soft px-3 py-2 text-sm font-semibold text-success">
              {STAFF.claimMine}
              {claimExpiresAt !== null
                ? ` (${formatTimeAz(claimExpiresAt)} ${STAFF.claimUntil})`
                : null}
            </p>
          ) : claimOther ? (
            <div className="rounded-staff border-l-4 border-warning bg-warning-soft px-3 py-2 text-sm font-semibold text-warning">
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

      {reviewPending && claimMine && lockedReason !== null ? (
        <p
          className="rounded-staff bg-warning-soft px-3 py-2 text-xs font-medium leading-relaxed text-warning"
          data-testid="decisions-locked"
        >
          {lockedReason}
        </p>
      ) : null}

      {(reviewPending && claimMine) || isActive ? (
        <div className="flex flex-wrap gap-2" data-testid="decision-buttons">
          {reviewPending && claimMine ? (
            <>
              <Button
                onClick={() => setPendingAction("approve")}
                disabled={busy || !hydrated || lockedReason !== null}
                aria-disabled={lockedReason !== null}
                data-testid="action-approve"
              >
                {STAFF.approve}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPendingAction("request-correction")}
                disabled={busy || !hydrated || lockedReason !== null}
                aria-disabled={lockedReason !== null}
                data-testid="action-correction"
              >
                {STAFF.correction}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPendingAction("reject")}
                disabled={busy || !hydrated || lockedReason !== null}
                aria-disabled={lockedReason !== null}
                data-testid="action-reject"
              >
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
          className="rounded-staff border border-line bg-raised p-4"
          data-testid="decision-confirm"
        >
          <h3 className="text-sm font-bold text-ink">
            {STAFF.confirmAction}: {ACTION_META[pendingAction].label}
          </h3>
          {/* O.13 Stage C: sealed adjusted-decision copy (NEW only) */}
          {adjustmentRevision !== null && !editPending && pendingAction !== "suspend" ? (
            <p
              className={`mt-2 rounded-staff px-3 py-2 text-xs leading-relaxed ${
                pendingAction === "approve" ? "bg-info-soft text-info" : "bg-warning-soft text-warning"
              }`}
              data-testid="adjusted-decision-note"
            >
              {pendingAction === "approve" ? STAFF.approveWithAdj : null}
              {pendingAction === "approve" && adjustmentSummary.length > 0
                ? `: ${adjustmentSummary.join(" · ")}`
                : null}
              {pendingAction === "request-correction" ? STAFF.correctionWithAdj : null}
              {pendingAction === "reject" ? STAFF.rejectWithAdj : null}
            </p>
          ) : null}
          {ACTION_META[pendingAction].needsReason ? (
            <div className="mt-3 space-y-3">
              <label className="block text-xs font-medium text-slate-strong" htmlFor="decision-reason">
                {STAFF.reason}
                <select
                  id="decision-reason"
                  data-testid="decision-reason"
                  className="mt-1 min-h-12 w-full rounded-staff border border-line-strong bg-raised px-3 text-base text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none"
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
              <label className="block text-xs font-medium text-slate-strong" htmlFor="decision-note">
                {STAFF.sellerNote}
                <textarea
                  id="decision-note"
                  data-testid="decision-note"
                  className="mt-1 min-h-24 w-full rounded-staff border border-line-strong bg-raised px-3 py-2 text-base text-ink transition-colors duration-150 hover:border-muted focus:border-primary focus:outline-none"
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p className="text-xs text-slate-strong">{STAFF.sellerNoteHint}</p>
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
