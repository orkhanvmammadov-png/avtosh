"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { REPORT } from "@/lib/marketplace/labels";
import { publicFetch, PublicApiError } from "@/lib/marketplace/public-api";

const REASONS = [
  "WRONG_INFORMATION",
  "DUPLICATE",
  "FRAUD_SUSPECTED",
  "SOLD_OR_UNAVAILABLE",
  "PROHIBITED_CONTENT",
  "OTHER",
] as const;

/**
 * Anonymous listing report intake. Reason codes are the stable server
 * set (Azerbaijani labels only in the UI); the response never carries
 * report ids or reporter data, and neither does this component.
 */
export function ReportListing({ publicId }: { publicId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("WRONG_INFORMATION");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "done" | "limited" | "failed">("idle");

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await publicFetch(`/api/v1/listings/${publicId}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason_code: reason,
          ...(note.trim().length > 0 ? { note: note.trim() } : {}),
        }),
      });
      setState("done");
    } catch (error) {
      if (error instanceof PublicApiError && error.code === "REPORT_RATE_LIMITED") {
        setState("limited");
      } else {
        setState("failed");
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setOpen(false);
  }

  if (state === "done") {
    return (
      <p className="text-sm font-medium text-navy" data-testid="report-success" role="status">
        {REPORT.success}
      </p>
    );
  }
  if (state === "limited") {
    return (
      <p className="text-sm text-muted" data-testid="report-rate-limited" role="status">
        {REPORT.rateLimited}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-12 items-center text-sm font-medium text-muted underline hover:text-navy"
        data-testid="report-open"
      >
        {REPORT.action}
      </button>
    );
  }

  return (
    <div className="rounded-card border border-line bg-white p-4" data-testid="report-form">
      <h2 className="text-sm font-semibold text-navy">{REPORT.title}</h2>
      <label className="mt-3 block text-xs font-medium text-muted">
        {REPORT.reason}
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
          className="mt-1 block min-h-12 w-full rounded-lg border border-line bg-white px-2 text-sm text-navy"
          data-testid="report-reason"
        >
          {REASONS.map((code) => (
            <option key={code} value={code}>
              {REPORT.reasons[code]}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-xs font-medium text-muted">
        {REPORT.note}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={3}
          className="mt-1 block w-full rounded-lg border border-line bg-white px-2 py-2 text-sm text-navy"
          data-testid="report-note"
        />
      </label>
      {state === "failed" ? (
        <p role="alert" className="mt-2 text-xs text-danger" data-testid="report-error">
          {REPORT.failed}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button onClick={submit} disabled={busy} data-testid="report-submit">
          {REPORT.submit}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
          {REPORT.cancel}
        </Button>
      </div>
    </div>
  );
}
