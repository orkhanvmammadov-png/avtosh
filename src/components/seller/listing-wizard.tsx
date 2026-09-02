"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ResultPanel } from "@/components/ui/result-panel";
import { formatPriceMinor } from "@/lib/format";
import { SELLER, UI } from "@/lib/marketplace/labels";
import { PublicApiError } from "@/lib/marketplace/public-api";
import {
  resubmitListing,
  submitListing,
  type OwnerListingDto,
  type SubmitResult,
} from "@/lib/seller/owner-api";
import { MISSING_FIELD_LABELS, REASON_LABELS } from "@/lib/seller/status";
import { PayButton } from "@/components/seller/pay-button";
import type { SellerModerationFeedbackDto } from "@/services/my-listings";
import { useListingEditor } from "@/components/seller/use-listing-editor";
import { useWizardCatalog } from "@/components/seller/use-wizard-catalog";
import { VehicleStep } from "@/components/seller/vehicle-step";
import { DetailsStep } from "@/components/seller/details-step";
import { PhotosStep } from "@/components/seller/photos-step";
import { DescriptionStep } from "@/components/seller/description-step";
import { PreviewStep } from "@/components/seller/preview-step";

interface SubmitErrorView {
  title: string;
  items: string[];
}

function submitErrorView(error: unknown): SubmitErrorView {
  if (error instanceof PublicApiError) {
    if (error.code === "LISTING_INCOMPLETE") {
      const details = error.details as { missing?: string[] } | null;
      const items = (details?.missing ?? []).map((code) => MISSING_FIELD_LABELS[code] ?? code);
      return { title: SELLER.incompleteTitle, items };
    }
    if (error.code === "LISTING_INSUFFICIENT_IMAGES") {
      return { title: SELLER.insufficientImages, items: [] };
    }
    if (error.code === "LISTING_INVALID_CATALOG_SELECTION") {
      return { title: SELLER.invalidCatalog, items: [] };
    }
  }
  return { title: `${UI.errorTitle}. ${UI.errorHint}`, items: [] };
}

/**
 * The 5-step seller wizard over one editable listing (DRAFT /
 * CORRECTION_REQUIRED / REJECTED — the server enforces which). All
 * writes flow through the serialized editor; step transitions flush
 * pending edits first so nothing is silently lost on navigation.
 */
export function ListingWizard({
  initial,
  feedback,
}: {
  initial: OwnerListingDto;
  feedback: SellerModerationFeedbackDto | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editor = useListingEditor(initial);
  const catalog = useWizardCatalog(editor.dto.category, editor.dto.brandId);
  const stepFromUrl = Number(searchParams.get("addim"));
  const [step, setStep] = useState(
    Number.isInteger(stepFromUrl) && stepFromUrl >= 1 && stepFromUrl <= 5 ? stepFromUrl : 1,
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitErrorView | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isResubmission = initial.status !== "DRAFT";

  const goToStep = useCallback(
    (next: number) => {
      setStep(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set("addim", String(next));
      router.replace(`?${params.toString()}`, { scroll: true });
      headingRef.current?.focus();
    },
    [router, searchParams],
  );

  /** Save-before-navigate: pending edits are flushed, failures block. */
  const navigate = useCallback(
    async (next: number) => {
      const ok = await editor.flush();
      if (ok) goToStep(next);
    },
    [editor, goToStep],
  );

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const flushed = await editor.flush();
      if (!flushed) return;
      const revision = editor.dto.revision;
      const submitFn = isResubmission ? resubmitListing : submitListing;
      const submitted = await editor.runExclusive(
        () => submitFn(editor.dto.id, revision),
        { refetch: false },
      );
      if (submitted !== null) {
        // No router.refresh() here: it would re-render the server page
        // (now a status screen) and unmount this result view. The exit
        // link targets a force-dynamic page, so state stays fresh.
        setResult(submitted);
      }
    } catch (error) {
      if (!(error instanceof PublicApiError && error.code === "LISTING_REVISION_CONFLICT")) {
        setSubmitError(submitErrorView(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  if (result !== null) {
    return <SubmitResultScreen result={result} />;
  }

  return (
    <div className="mx-auto max-w-3xl py-6 pb-24 md:pb-6" data-testid="listing-wizard">
      {editor.conflict ? (
        <div
          role="alert"
          className="mb-4 rounded-control border-l-4 border-danger bg-danger-soft p-4"
          data-testid="wizard-conflict"
        >
          <p className="font-semibold text-danger">{SELLER.conflictTitle}</p>
          <p className="mt-1 text-sm text-ink">{SELLER.conflictHint}</p>
          <Button className="mt-3" onClick={() => void editor.reloadFromServer()} data-testid="wizard-conflict-reload">
            {SELLER.conflictReload}
          </Button>
        </div>
      ) : null}

      {feedback !== null ? (
        <div
          className="mb-4 rounded-control border-l-4 border-warning bg-warning-soft p-4"
          data-testid="wizard-feedback"
        >
          <h2 className="text-sm font-semibold text-warning">{SELLER.moderationFeedback}</h2>
          <p className="mt-1 text-sm font-medium text-ink">
            {feedback.reasonCode !== null ? (REASON_LABELS[feedback.reasonCode] ?? feedback.reasonCode) : null}
          </p>
          {feedback.note !== null ? <p className="mt-1 text-sm text-slate-strong">{feedback.note}</p> : null}
        </div>
      ) : null}

      <nav aria-label={SELLER.stepLabel} className="mb-5">
        <ol className="flex gap-1.5">
          {SELLER.steps.map((label, index) => {
            const number = index + 1;
            const current = number === step;
            const completed = number < step;
            return (
              <li key={label} className="min-w-0 flex-1">
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  onClick={() => void navigate(number)}
                  data-testid={`wizard-step-${number}`}
                  className="group block min-h-12 w-full text-left"
                >
                  <span
                    aria-hidden="true"
                    className={`block h-1.5 w-full rounded-pill transition-colors duration-150 ${
                      current ? "bg-primary" : completed ? "bg-primary/45 group-hover:bg-primary/70" : "bg-line-strong/60 group-hover:bg-line-strong"
                    }`}
                  />
                  <span
                    className={`mt-1.5 block truncate text-[11.5px] tracking-[0.01em] transition-colors duration-150 ${
                      current ? "font-semibold text-ink" : completed ? "font-medium text-slate-strong group-hover:text-ink" : "text-muted group-hover:text-slate-strong"
                    }`}
                  >
                    <span className="sm:hidden">{number}</span>
                    <span className="hidden sm:inline">{number}. {label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold tracking-[-0.01em] text-ink outline-none">
          {SELLER.steps[step - 1]}
        </h1>
        <p
          className={`rounded-pill px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
            editor.saveState === "saving"
              ? "bg-sunken text-slate-strong"
              : editor.saveState === "saved"
                ? "bg-success-soft text-success"
                : editor.saveState === "error"
                  ? "bg-danger-soft text-danger"
                  : ""
          }`}
          aria-live="polite"
          data-testid="wizard-save-state"
        >
          {editor.saveState === "saving" ? SELLER.saving : null}
          {editor.saveState === "saved" ? SELLER.saved : null}
          {editor.saveState === "error" ? SELLER.saveError : null}
        </p>
      </div>

      <div key={`${editor.resetKey}-${step}`} className="rounded-card border border-line bg-raised p-4 md:p-6">
        {step === 1 ? <VehicleStep editor={editor} catalog={catalog} /> : null}
        {step === 2 ? <DetailsStep editor={editor} catalog={catalog} /> : null}
        {step === 3 ? <PhotosStep editor={editor} /> : null}
        {step === 4 ? <DescriptionStep editor={editor} /> : null}
        {step === 5 ? <PreviewStep editor={editor} catalog={catalog} onGoToStep={(s) => void navigate(s)} /> : null}
      </div>

      {submitError !== null ? (
        <div role="alert" className="mt-4 rounded-control border-l-4 border-danger bg-danger-soft p-4" data-testid="wizard-submit-error">
          <p className="font-semibold text-danger">{submitError.title}</p>
          {submitError.items.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-sm text-ink">
              {submitError.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 border-t border-line bg-raised p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:mt-4 md:border-0 md:bg-transparent md:p-0">
        {step > 1 ? (
          <Button variant="secondary" onClick={() => void navigate(step - 1)} data-testid="wizard-back">
            {SELLER.back}
          </Button>
        ) : (
          <span />
        )}
        {step < 5 ? (
          <Button onClick={() => void navigate(step + 1)} data-testid="wizard-next">
            {SELLER.next}
          </Button>
        ) : (
          <Button
            onClick={() => void submit()}
            disabled={submitting || editor.conflict}
            data-testid="wizard-submit"
          >
            {submitting ? SELLER.submitting : isResubmission ? SELLER.resubmit : SELLER.submit}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Post-submit outcome — FREE → moderation, PAID → payment required (no fake checkout). */
function SubmitResultScreen({ result }: { result: SubmitResult }) {
  const paid = result.nextAction === "PAYMENT";
  return (
    <ResultPanel
      tone={paid ? "pending" : "success"}
      title={paid ? SELLER.paymentRequired : SELLER.submittedFree}
      hint={paid ? SELLER.paymentRequiredHint : SELLER.submittedFreeHint}
      data-testid="wizard-result"
      data-outcome={result.nextAction}
      actions={
        <Link href="/profil/elanlar" className={buttonClasses(paid ? "secondary" : "primary", "px-6")}>
          {UI.myListings}
        </Link>
      }
    >
      {paid && result.payment !== null ? (
        <>
          <p className="mt-5 font-condensed text-[34px] font-bold leading-none text-ink" data-testid="wizard-payment-amount">
            {formatPriceMinor(result.payment.amountMinor, result.payment.currency)}
          </p>
          <p className="mt-2 text-sm text-muted">{SELLER.paymentAfterHint}</p>
          <div className="mt-6 flex justify-center">
            <PayButton listingId={result.listing.id} />
          </div>
        </>
      ) : null}
    </ResultPanel>
  );
}
