"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ResultPanel } from "@/components/ui/result-panel";
import { formatPriceMinor } from "@/lib/format";
import { aznInputToMinor, minorToAznInput } from "@/lib/format";
import { engineCcOptions } from "@/lib/marketplace/engine-options";
import { LISTING_YEAR_MIN, listingYearMax } from "@/lib/config/marketplace";
import { SELLER, UI } from "@/lib/marketplace/labels";
import { PublicApiError } from "@/lib/marketplace/public-api";
import {
  cancelEditRevision,
  draftEditorApi,
  editEditorApi,
  resubmitListing,
  submitEditRevision,
  submitListing,
  type OwnerListingDto,
  type SubmitResult,
} from "@/lib/seller/owner-api";
import type { EditContextDto } from "@/services/listing-edit";
import { MISSING_FIELD_LABELS, REASON_LABELS } from "@/lib/seller/status";
import { STAGES, STAGE_COUNT, correctionEntryStage, deriveResumeStage, type StageKey } from "@/lib/seller/journey";
import { PayButton } from "@/components/seller/pay-button";
import type { SellerModerationFeedbackDto } from "@/services/my-listings";
import { useListingEditor, type ListingEditor } from "@/components/seller/use-listing-editor";
import { useWizardCatalog, OPTION_GROUPS, type WizardCatalog } from "@/components/seller/use-wizard-catalog";
import { Loader2 } from "lucide-react";
import { SellerListboxField } from "@/components/seller/listbox-field";
import { ChipToggle, DeferredChipToggle, DeferredInput, SelectField } from "@/components/seller/wizard-fields";
import { PhotosStep } from "@/components/seller/photos-step";
import { ContactSection } from "@/components/seller/axin/contact-section";
import { EquipmentSelector } from "@/components/seller/axin/equipment-selector";
import { ReviewSection } from "@/components/seller/axin/review-section";
import { SectionCard, type StageState } from "@/components/seller/axin/section-card";
import { TypeaheadField } from "@/components/seller/axin/typeahead-field";

/**
 * O.9 AXIN seller flow (flow.md): ONE page of collapsing section
 * cards over the existing serialized revision-guarded editor — Quick
 * Start + 6 sections, deterministic n/7 progress, one card open at a
 * time, summaries with Dəyiş. Replaces the 5-step wizard on the same
 * routes and the same backend contracts (create/PATCH/submit/
 * resubmit are untouched).
 */

/**
 * O.10 journey (flow.md — SEALED, exactly 6 stages). This array is the
 * single ordering source; infoContact is ONE journey stage (Stage B
 * seals its combined visual composition — Stage A renders the two O.9
 * subcomponents inside its single card as a temporary adapter).
 */
const STAGE_TITLES: Record<StageKey, string> = {
  quickstart: SELLER.quickStartTitle,
  details: SELLER.sectionDetails,
  sale: SELLER.sectionSale,
  photos: SELLER.sectionPhotos,
  infoContact: SELLER.sectionInfoContact,
  review: SELLER.sectionReview,
};

/** Submission missing-codes → the journey stage that owns the field. */
const MISSING_CODE_SECTION: Record<string, StageKey> = {
  brand: "quickstart",
  model: "quickstart",
  model_variant: "quickstart",
  year: "quickstart",
  price: "sale",
  mileage: "sale",
  city: "sale",
  contact_phone: "infoContact",
  seller_name: "infoContact",
};

interface SubmitErrorView {
  title: string;
  items: string[];
  sections: StageKey[];
}

function submitErrorView(error: unknown): SubmitErrorView {
  if (error instanceof PublicApiError) {
    if (error.code === "LISTING_LIFECYCLE_CONFLICT") {
      // O.12: the edit is no longer available or its moderation state
      // changed in another session — same conflict language everywhere
      return { title: SELLER.lifecycleConflict, items: [], sections: [] };
    }
    if (error.code === "LISTING_INCOMPLETE") {
      const details = error.details as { missing?: string[] } | null;
      const codes = details?.missing ?? [];
      return {
        title: SELLER.incompleteTitle,
        items: codes.map((code) => MISSING_FIELD_LABELS[code] ?? code),
        sections: [...new Set(codes.map((code) => MISSING_CODE_SECTION[code]).filter((s): s is StageKey => s !== undefined))],
      };
    }
    if (error.code === "LISTING_INSUFFICIENT_IMAGES") {
      return { title: SELLER.insufficientImages, items: [], sections: ["photos"] };
    }
    if (error.code === "LISTING_INVALID_CATALOG_SELECTION") {
      return { title: SELLER.invalidCatalog, items: [], sections: [] };
    }
  }
  return { title: `${UI.errorTitle}. ${UI.errorHint}`, items: [], sections: [] };
}

export function AxinFlow({
  initial,
  feedback,
  authPhoneE164,
  authDisplayName,
  edit,
}: {
  initial: OwnerListingDto;
  feedback: SellerModerationFeedbackDto | null;
  /** Login phone — offered as a one-tap listing-contact suggestion
      only; NEVER written anywhere except listings.contact_phone_e164
      through the normal PATCH. */
  authPhoneE164: string;
  authDisplayName: string | null;
  /** O.12 EDIT mode — explicit, never inferred. Present = the editor
      persists into the open edit revision; absent = NEW-listing flow,
      byte-for-byte unchanged. */
  edit?: { context: EditContextDto; activateIntent: boolean };
}) {
  const isEdit = edit !== undefined;
  const editor = useListingEditor(initial, isEdit ? editEditorApi : draftEditorApi);
  const catalog = useWizardCatalog(editor.dto.category, editor.dto.brandId, editor.dto.modelId);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitErrorView | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [editResult, setEditResult] = useState<"SUBMITTED" | "CANCELLED" | null>(null);
  const isResubmission = !isEdit && initial.status !== "DRAFT";
  const dto = editor.dto;

  // O.12 edit context (03-axin-edit-mode.md): expired wins, then the
  // requested/deactivated variants, then the active strip. The
  // combined submit-and-activate CTA follows the same intent.
  const editExpired = isEdit && edit.context.effectiveExpired;
  const editActivate =
    isEdit &&
    !editExpired &&
    edit.context.sellerDeactivated &&
    (edit.context.reactivationRequested || edit.activateIntent);

  // STAGE VALIDITY — required data of each stage (validation.md).
  // This is NOT visited state and NOT completion display: it only
  // gates the current stage's own Davam et and feeds needs-attention.
  const stageValid: Record<StageKey, boolean> = {
    quickstart:
      dto.brandId !== null &&
      dto.modelId !== null &&
      dto.year !== null &&
      // Owner rule: a CAR family with active Alt models requires one.
      (dto.category !== "CAR" || catalog.variants.length === 0 || dto.modelVariantId !== null),
    details: true, // ALWAYS continuable — including fully empty
    sale: dto.priceMinor !== null && dto.mileage !== null && dto.cityId !== null,
    photos: dto.images.length >= 3,
    infoContact: dto.sellerName !== null && dto.contactPhone !== null,
    review: false,
  };

  // O.10 JOURNEY STATE — ephemeral frontend only (audit-dependent.md:
  // no DB field, no API). Under the strict sequential NEW journey,
  // visited ≡ index <= furthestIndex. Resume derivation is the pure
  // audited hierarchy; Stage C finalizes correction deep-linking.
  // Correction entry (NEW resubmission or O.12 edit correction) deep-
  // links by reason and unlocks the whole journey; otherwise the pure
  // data-derived resume applies (a complete edit snapshot → Review).
  const correctionEntry =
    isResubmission || (isEdit && edit.context.editStatus === "CORRECTION_REQUIRED");
  const [openStage, setOpenStage] = useState<StageKey>(() =>
    correctionEntry ? correctionEntryStage(feedback?.reasonCode ?? null) : deriveResumeStage(initial),
  );
  const [furthestIndex, setFurthestIndex] = useState<number>(() =>
    correctionEntry ? STAGES.indexOf("review") : STAGES.indexOf(deriveResumeStage(initial)),
  );
  const openIndex = STAGES.indexOf(openStage);

  const submitAttention = new Set(submitError?.sections ?? []);
  function stageStateOf(key: StageKey): StageState {
    const index = STAGES.indexOf(key);
    if (key === openStage) return "current";
    if (index > furthestIndex) return "upcoming";
    // visited: needs-attention only for required-bearing stages
    if (!stageValid[key] && key !== "review" && key !== "details") return "attention";
    if (submitAttention.has(key)) return "attention";
    return "visited";
  }

  // O.10 Stage D accessibility: on EVERY real stage change — forward
  // Davam et, explicit backward Dəyiş/visited-row navigation, and
  // initial resume/correction entry — keyboard focus moves to the
  // opened stage heading (the user requested the navigation, so the
  // jump is expected and orients screen readers). Autosave rerenders
  // never re-run this effect (keyed to openStage only).
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('section[data-state="open"] h2[tabindex="-1"]');
    heading?.focus();
  }, [openStage]);

  /** Reopen a VISITED stage (backward/Dəyiş — never a forward shortcut). */
  function openVisited(key: StageKey) {
    if (STAGES.indexOf(key) <= furthestIndex) setOpenStage(key);
  }

  /**
   * Sequential primary Continue (navigation.md): at the frontier the
   * next stage is ALWAYS index+1 — never "next incomplete"; from a
   * reopened earlier stage it returns forward to the furthest journey
   * position without re-traversing. Awaits the existing flush so
   * advancing never implies unsaved data was stored; on flush failure
   * or conflict the existing error/conflict UI holds and we stay.
   */
  async function advance() {
    const ok = await editor.flush();
    if (!ok || editor.conflict) return;
    const target = openIndex < furthestIndex ? furthestIndex : Math.min(openIndex + 1, STAGE_COUNT - 1);
    setFurthestIndex((f) => Math.max(f, target));
    setOpenStage(STAGES[target]);
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const flushed = await editor.flush();
      if (!flushed) return;
      if (isEdit) {
        // revision submit: PURE revision transition (no status change,
        // no fee/quota/publication); `activate` records the combined
        // submit-and-activate intent for approval-time finalization
        const submitted = await editor.runExclusive(
          () => submitEditRevision(editor.dto.id, editor.currentRevision(), editActivate),
          { refetch: false },
        );
        if (submitted !== null) {
          setEditResult("SUBMITTED");
        }
        return;
      }
      const submitFn = isResubmission ? resubmitListing : submitListing;
      // revision is read AT SEND TIME inside the serialized queue —
      // a just-queued immediate patch (skip-promo clearing) must not
      // leave this closure with a stale expected_revision
      const submitted = await editor.runExclusive(
        () => submitFn(editor.dto.id, editor.currentRevision()),
        { refetch: false },
      );
      if (submitted !== null) {
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

  /** Neutral no-promotion path: clears any intent, then submits. */
  async function skipPromoAndSubmit() {
    const clears: { premium_intent_package_id?: null; boost_intent_package_id?: null } = {};
    if (dto.premiumIntentPackageId !== null) clears.premium_intent_package_id = null;
    if (dto.boostIntentPackageId !== null) clears.boost_intent_package_id = null;
    if (Object.keys(clears).length > 0) {
      editor.patch(clears, { immediate: true });
    }
    await submit();
  }

  if (editResult !== null) {
    return <EditResultScreen outcome={editResult} expired={editExpired} activate={editActivate} />;
  }
  if (result !== null) {
    return <SubmitResultScreen result={result} />;
  }

  // Card-footer autosave chip (o9 components.md): server-confirmed
  // states only — "Saxlanıldı" carries the SERVER updated_at time.
  const autosaveChip = (
    <AutosaveChip state={editor.saveState} updatedAtIso={dto.updatedAt} onRetry={() => void editor.flush()} />
  );

  return (
    <div data-testid="axin-flow">
      {/* Navy flow header — title, autosave promise, Mərhələ X / 6
          (journey POSITION — never a completion count). */}
      <div className="bg-navy text-white">
        <div className="relative mx-auto flex h-12 max-w-full items-center justify-center gap-3 px-4 md:max-w-[540px] md:justify-between md:px-6 desk:max-w-[640px] desk:px-0 xl:max-w-[680px]">
          <p className="hidden min-w-0 truncate text-[13px] md:block">
            <span className="font-bold" data-testid="axin-header-title">
              {isEdit ? SELLER.editHeader : SELLER.newListing}
            </span>
            <span className="hidden text-white/60 md:inline"> · {SELLER.autosaveHint}</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <p
              aria-live="polite"
              data-testid="wizard-save-state"
              className={`sr-only text-[11px] font-medium md:not-sr-only ${
                editor.saveState === "saving"
                  ? "text-white/70"
                  : editor.saveState === "saved"
                    ? "text-[#7FC8A5]"
                    : editor.saveState === "error"
                      ? "text-[#F2B8B5]"
                      : "text-transparent"
              }`}
            >
              {editor.saveState === "saving" ? SELLER.saving : null}
              {editor.saveState === "saved" ? SELLER.saved : null}
              {editor.saveState === "error" ? SELLER.saveError : null}
            </p>
            <p
              className="text-[14px] font-bold text-white md:rounded-pill md:bg-[#1D2733] md:px-2.5 md:py-1 md:text-[11px] md:font-semibold md:text-white/85"
              data-testid="axin-progress"
            >
              {SELLER.stageWord} {furthestIndex + 1} / {STAGE_COUNT}
            </p>
          </div>
        </div>
      </div>

      {/* O.12 edit context strip — ONE strip under the header (never
          per-stage banners): expired amber, otherwise deactivated /
          requested / active variants. */}
      {isEdit ? (
        <div
          className={editExpired ? "bg-[#FBEED8]" : "bg-[#EDF4F0]"}
          data-testid="edit-context-strip"
          data-variant={
            editExpired
              ? "expired"
              : editActivate
                ? "deactivated-requested"
                : edit.context.sellerDeactivated
                  ? "deactivated"
                  : "active"
          }
        >
          <p className="mx-auto max-w-full px-4 py-2 text-[11.5px] leading-normal text-ink md:max-w-[540px] md:px-6 desk:max-w-[640px] desk:px-0 xl:max-w-[680px]">
            {editExpired
              ? SELLER.stripExpired
              : editActivate
                ? SELLER.stripDeactivatedRequested
                : edit.context.sellerDeactivated
                  ? SELLER.stripDeactivated
                  : SELLER.stripActive}
          </p>
        </div>
      ) : null}

      <div className="mx-auto max-w-full px-4 pb-24 pt-5 md:max-w-[540px] md:px-6 desk:max-w-[640px] desk:px-0 desk:pb-8 xl:max-w-[680px]">
        {isEdit && edit.activateIntent && edit.context.editStatus === "EDIT_DRAFT" && !edit.context.reactivationRequested ? (
          <p
            className="mb-4 rounded-control bg-primary-tint px-3.5 py-2.5 text-[12.5px] font-medium text-primary"
            data-testid="edit-activate-notice"
          >
            {SELLER.activateWithDraftNotice}
          </p>
        ) : null}
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
          <div className="mb-4 rounded-control border-l-4 border-warning bg-warning-soft p-4" data-testid="wizard-feedback">
            {/* edit mode scopes the reason to the REDAKTƏ — the
                approved public listing is conceptually separate */}
            <h2 className="text-sm font-semibold text-warning">
              {isEdit ? SELLER.chipEditCorrection : SELLER.moderationFeedback}
            </h2>
            <p className="mt-1 text-sm font-medium text-ink">
              {feedback.reasonCode !== null ? (REASON_LABELS[feedback.reasonCode] ?? feedback.reasonCode) : null}
            </p>
            {feedback.note !== null ? <p className="mt-1 text-sm text-slate-strong">{feedback.note}</p> : null}
          </div>
        ) : null}

        <p className="sr-only" role="status" data-testid="axin-stage-announcer">
          {SELLER.stageWord} {openIndex + 1} / {STAGE_COUNT} — {STAGE_TITLES[openStage]}
        </p>

        <div key={editor.resetKey} className="space-y-2.5">
          <SectionCard
            sectionKey="quickstart"
            index={1}
            title={STAGE_TITLES.quickstart}
            state={stageStateOf("quickstart")}
            summary={quickStartSummary(dto, catalog)}
            attentionMessage={SELLER.attentionRequired}
            onOpen={() => openVisited("quickstart")}
            onContinue={() => void advance()}
            continueDisabled={!stageValid.quickstart}
            footerStart={autosaveChip}
          >
            <QuickStartSection editor={editor} catalog={catalog} />
          </SectionCard>

          <SectionCard
            sectionKey="details"
            index={2}
            title={STAGE_TITLES.details}
            state={stageStateOf("details")}
            summary={detailsSummary(dto, catalog)}
            onOpen={() => openVisited("details")}
            onContinue={() => void advance()}
            footerStart={autosaveChip}
          >
            <p className="mb-3 text-xs text-muted">{SELLER.detailsOptionalHint}</p>
            <DetailsSection editor={editor} catalog={catalog} />
          </SectionCard>

          <SectionCard
            sectionKey="sale"
            index={3}
            title={STAGE_TITLES.sale}
            state={stageStateOf("sale")}
            summary={saleSummary(dto, catalog)}
            attentionMessage={SELLER.attentionRequired}
            onOpen={() => openVisited("sale")}
            onContinue={() => void advance()}
            continueDisabled={!stageValid.sale}
            footerStart={autosaveChip}
          >
            <SaleSection editor={editor} catalog={catalog} />
          </SectionCard>

          <SectionCard
            sectionKey="photos"
            index={4}
            title={STAGE_TITLES.photos}
            state={stageStateOf("photos")}
            summary={dto.images.length > 0 ? `${dto.images.length} şəkil` : null}
            attentionMessage={SELLER.attentionPhotos}
            onOpen={() => openVisited("photos")}
            onContinue={() => void advance()}
            continueDisabled={!stageValid.photos}
            footerStart={autosaveChip}
          >
            <PhotosStep editor={editor} />
          </SectionCard>

          {/* Stage 5 — ONE journey stage, TWO subgroups inside ONE
              card (combined-stage.md): caps sublabels + optional/
              required helpers separated by a hairline — no nested
              cards, no second CTA, no re-split into journey steps. */}
          <SectionCard
            sectionKey="info-contact"
            index={5}
            title={STAGE_TITLES.infoContact}
            state={stageStateOf("infoContact")}
            summary={infoContactSummary(dto)}
            attentionMessage={SELLER.attentionContact}
            onOpen={() => openVisited("infoContact")}
            onContinue={() => void advance()}
            continueDisabled={!stageValid.infoContact}
            footerStart={autosaveChip}
          >
            <div data-testid="subgroup-extras">
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                {SELLER.sectionExtras}
                <span className="ml-1.5 font-medium normal-case tracking-normal">· {SELLER.subgroupOptional}</span>
              </h3>
              <div className="mt-2.5">
                <ExtrasSection editor={editor} catalog={catalog} />
              </div>
            </div>
            <div className="my-4 border-t border-line" aria-hidden="true" />
            <div data-testid="subgroup-contact">
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                {SELLER.sectionContact}
                <span className="ml-1.5 font-medium normal-case tracking-normal">· {SELLER.subgroupRequired}</span>
              </h3>
              <div className="mt-2.5">
                <ContactSection editor={editor} authPhoneE164={authPhoneE164} authDisplayName={authDisplayName} />
              </div>
            </div>
          </SectionCard>

          <SectionCard
            sectionKey="review"
            index={6}
            title={STAGE_TITLES.review}
            state={stageStateOf("review")}
            summary={null}
            onOpen={() => openVisited("review")}
          >
            <ReviewSection
              editor={editor}
              catalog={catalog}
              isResubmission={isResubmission}
              editMode={isEdit}
              onEdit={(section) =>
                openVisited(section === "contact" || section === "extras" ? "infoContact" : (section as StageKey))
              }
            />
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
            {/* ONE instance serving every tier: fixed safe-area bar
                below desk (approved 390/768 sticky action), inline
                right-aligned row at desk+. */}
            <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col items-stretch gap-1.5 border-t border-line bg-raised px-3.5 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] desk:static desk:mt-4 desk:flex-row desk:flex-wrap desk:items-center desk:justify-end desk:gap-3 desk:border-x-0 desk:border-b-0 desk:bg-transparent desk:px-0 desk:pb-0 desk:pt-3">
              <Button
                className="order-1 h-12 w-full desk:order-2 desk:h-auto desk:w-auto"
                onClick={() => void submit()}
                disabled={submitting || editor.conflict}
                data-testid="wizard-submit"
              >
                {submitting
                  ? SELLER.submitting
                  : isEdit
                    ? editActivate
                      ? SELLER.reviewSubmitEditActivate
                      : SELLER.reviewSubmitEdit
                    : isResubmission
                      ? SELLER.resubmit
                      : SELLER.submit}
              </Button>
              {!isResubmission && !isEdit ? (
                <button
                  type="button"
                  onClick={() => void skipPromoAndSubmit()}
                  disabled={submitting || editor.conflict}
                  data-testid="wizard-submit-skip-promo"
                  className="order-2 inline-flex min-h-10 items-center justify-center rounded-control px-4 text-[13px] font-medium text-slate-strong transition-colors duration-150 hover:text-ink disabled:opacity-50 desk:order-1 desk:min-h-11 desk:justify-start"
                >
                  {SELLER.promoSkip}
                </button>
              ) : null}
            </div>
          </SectionCard>
        </div>

        {/* O.12 cancel edit (05-cancel-edit.md): low-priority ghost
            under the wizard, EDIT_DRAFT / CORRECTION_REQUIRED only —
            the pending read-only view never renders this component. */}
        {isEdit ? (
          <CancelEditAction
            listingId={dto.id}
            currentRevision={editor.currentRevision}
            onCancelled={() => setEditResult("CANCELLED")}
            disabled={submitting}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Ghost cancel action + confirm dialog (390: bottom sheet). Confirm
    is outlined danger — destructive to the DRAFT only. */
function CancelEditAction({
  listingId,
  currentRevision,
  onCancelled,
  disabled,
}: {
  listingId: string;
  currentRevision: () => number;
  onCancelled: () => void;
  disabled: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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

  async function cancelEdit() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await cancelEditRevision(listingId, currentRevision());
      onCancelled();
    } catch (err) {
      setError(
        err instanceof PublicApiError &&
          (err.code === "LISTING_REVISION_CONFLICT" || err.code === "LISTING_LIFECYCLE_CONFLICT")
          ? SELLER.lifecycleConflict
          : SELLER.saveError,
      );
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || pending}
        onClick={() => setConfirming(true)}
        data-testid="edit-cancel"
        className="inline-flex min-h-11 items-center justify-center rounded-control px-4 text-[13px] font-medium text-slate-strong transition-colors duration-150 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
      >
        {SELLER.actionCancelEdit}
      </button>
      <p aria-live="polite" className="m-0 min-h-0" data-testid="edit-cancel-feedback">
        {error !== null ? (
          <span className="block text-xs font-medium text-danger">{error}</span>
        ) : null}
      </p>

      {confirming ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
          onClick={() => setConfirming(false)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-edit-title"
            aria-describedby="cancel-edit-body"
            tabIndex={-1}
            data-testid="cancel-edit-dialog"
            onClick={(event) => event.stopPropagation()}
            className="w-full rounded-t-[14px] bg-raised p-5 outline-none md:w-[400px] md:rounded-card"
          >
            <h2 id="cancel-edit-title" className="text-[15px] font-bold text-ink">
              {SELLER.cancelEditDialogTitle}
            </h2>
            <p id="cancel-edit-body" className="mt-2 text-[13px] leading-relaxed text-slate-strong">
              {SELLER.cancelEditDialogBody}
            </p>
            <div className="mt-4 flex flex-col gap-2 md:flex-row md:justify-end">
              <button
                type="button"
                disabled={pending}
                onClick={() => void cancelEdit()}
                data-testid="cancel-edit-confirm"
                className="inline-flex min-h-11 items-center justify-center rounded-control border border-danger px-4 text-sm font-semibold text-danger transition-colors duration-150 hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50 md:order-2"
              >
                {SELLER.actionCancelEdit}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirming(false);
                  triggerRef.current?.focus();
                }}
                data-testid="cancel-edit-back"
                className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:border-muted md:order-1"
              >
                {SELLER.cancelEditDialogBack}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Post-submit / post-cancel outcome for EDIT mode — server state is
    already final; the seller returns to My Listings. */
function EditResultScreen({
  outcome,
  expired,
  activate,
}: {
  outcome: "SUBMITTED" | "CANCELLED";
  expired: boolean;
  activate: boolean;
}) {
  const submitted = outcome === "SUBMITTED";
  return (
    <ResultPanel
      tone={submitted ? "success" : "neutral"}
      title={submitted ? SELLER.toastEditSubmitted : SELLER.toastEditCancelled}
      hint={
        submitted
          ? expired
            ? SELLER.expiredRenewHint
            : activate
              ? SELLER.afterModeration
              : SELLER.stripActive
          : SELLER.cancelEditDialogBody
      }
      data-testid="edit-result"
      data-outcome={outcome}
      actions={
        <Link href="/profil/elanlar" className={buttonClasses("primary", "px-6")}>
          {UI.myListings}
        </Link>
      }
    />
  );
}

// --- section summaries (one line, collapsed cards) --------------------------

function quickStartSummary(dto: OwnerListingDto, catalog: WizardCatalog): string | null {
  const parts = [catalog.nameOf(dto.brandId), catalog.nameOf(dto.modelId), catalog.nameOf(dto.modelVariantId), dto.year === null ? null : String(dto.year)].filter(
    (p): p is string => p !== null,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function detailsSummary(dto: OwnerListingDto, catalog: WizardCatalog): string | null {
  const parts = [
    dto.engineCc === null ? null : `${dto.engineCc} sm³`,
    catalog.nameOf(dto.fuelTypeId),
    catalog.nameOf(dto.transmissionId),
    catalog.nameOf(dto.colorId),
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.slice(0, 3).join(" · ") : "istəyə bağlı";
}

function saleSummary(dto: OwnerListingDto, catalog: WizardCatalog): string | null {
  const parts = [
    dto.priceMinor === null ? null : formatPriceMinor(dto.priceMinor, dto.currency),
    dto.mileage === null ? null : `${dto.mileage} km`,
    catalog.nameOf(dto.cityId),
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function infoContactSummary(dto: OwnerListingDto): string | null {
  const parts = [
    dto.sellerName,
    dto.contactPhone,
    dto.featureIds.length > 0 ? `${dto.featureIds.length} təchizat` : null,
    dto.description !== null && dto.description !== "" ? "təsvir var" : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.slice(0, 3).join(" · ") : null;
}

// --- sections ---------------------------------------------------------------

/** Quick Start in-flow: same values editable per interactions.md. */
function QuickStartSection({ editor, catalog }: { editor: ListingEditor; catalog: WizardCatalog }) {
  const { dto } = editor;
  const yearOptions = useMemo(() => {
    const yearMax = listingYearMax();
    return Array.from({ length: yearMax - LISTING_YEAR_MIN + 1 }, (_, i) => {
      const year = yearMax - i;
      return { value: year, label: String(year) };
    });
  }, []);
  return (
    <div className="grid gap-x-3.5 gap-y-3 desk:grid-cols-2">
      <SelectField
        id="wizard-category"
        label={SELLER.category}
        value={dto.category}
        placeholder={SELLER.select}
        items={catalog.categories}
        valueField="code"
        onChange={(code) => {
          if (code === null || code === dto.category) return;
          // Approved interaction (interactions.md): confirm ONLY when
          // meaningful category-specific data would be lost — the
          // server then clears dependents authoritatively.
          const wouldLose =
            dto.brandId !== null ||
            dto.modelId !== null ||
            dto.modelVariantId !== null ||
            dto.bodyTypeId !== null ||
            dto.motorcycleTypeId !== null;
          if (wouldLose && !window.confirm(SELLER.categorySwitchConfirm)) return;
          editor.patch({ category: code }, { immediate: true });
        }}
      />
      <TypeaheadField
        id="wizard-brand"
        label={SELLER.brand}
        value={dto.brandId}
        items={catalog.brands}
        loading={catalog.brands.length === 0}
        onChange={(id) => editor.patch({ brand_id: id }, { immediate: true })}
      />
      <TypeaheadField
        id="wizard-model"
        label={SELLER.model}
        value={dto.modelId}
        items={catalog.models}
        disabled={dto.brandId === null}
        disabledHint={SELLER.brandFirstHint}
        loading={dto.brandId !== null && catalog.models.length === 0}
        onChange={(id) => editor.patch({ model_id: id }, { immediate: true })}
      />
      {dto.modelId !== null && catalog.variants.length > 0 ? (
        <TypeaheadField
          id="wizard-model-variant"
          label={SELLER.modelVariant}
          value={dto.modelVariantId}
          items={catalog.variants}
          onChange={(id) => editor.patch({ model_variant_id: id }, { immediate: true })}
        />
      ) : null}
      <SellerListboxField
        id="wizard-year"
        label={SELLER.year}
        value={dto.year}
        placeholder={SELLER.select}
        options={yearOptions}
        onChange={(value) => editor.patch({ year: value === null ? null : Number(value) }, { immediate: true })}
      />
    </div>
  );
}

/** Thousands-spaced display label; the persisted value stays numeric. */
function formatCc(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Detallar — category-specific specs (sealed O.3/O.4 controls). */
function DetailsSection({ editor, catalog }: { editor: ListingEditor; catalog: WizardCatalog }) {
  const { dto } = editor;
  const engineOptions = useMemo(() => {
    // Approved O.2 sequence (literal 0 is real). LEGACY: a persisted
    // out-of-sequence engine_cc is injected at its sorted position —
    // displayed literally, never normalized or erased.
    const values = engineCcOptions();
    if (dto.engineCc !== null && !values.includes(dto.engineCc)) {
      const at = values.findIndex((v) => v > dto.engineCc!);
      if (at === -1) values.push(dto.engineCc);
      else values.splice(at, 0, dto.engineCc);
    }
    return values.map((v) => ({ value: v, label: formatCc(v) }));
  }, [dto.engineCc]);
  const colorGroup = OPTION_GROUPS.find((g) => g.group === "COLOR");
  const colorOptions = useMemo(
    () =>
      (catalog.options.COLOR ?? []).map((o) => ({
        value: o.id,
        label: o.name,
        code: o.code,
        swatch: o.swatch ?? null,
      })),
    [catalog.options],
  );
  return (
    <div className="grid gap-x-3.5 gap-y-3 desk:grid-cols-2">
      <SellerListboxField
        id="wizard-engine"
        label={SELLER.engineCc}
        value={dto.engineCc}
        placeholder={SELLER.select}
        options={engineOptions}
        onChange={(value) => editor.patch({ engine_cc: value === null ? null : Number(value) }, { immediate: true })}
      />
      {OPTION_GROUPS.filter(
        (g) =>
          g.group !== "COLOR" &&
          // Category relevance (o9 layout): the catalog already scopes
          // BODY_TYPE/MOTORCYCLE_TYPE per category; Ötürücü is a
          // CAR-only concept on the public detail contract, so the
          // MOTORCYCLE form never renders it (not even disabled).
          !(dto.category === "MOTORCYCLE" && g.group === "DRIVE_TYPE") &&
          (catalog.options[g.group] ?? []).length > 0,
      ).map((g) => (
        <SelectField
          key={g.group}
          id={`wizard-${g.field}`}
          label={g.label}
          value={dto[g.dtoKey]}
          placeholder={SELLER.select}
          items={catalog.options[g.group] ?? []}
          onChange={(id) => editor.patch({ [g.field]: id }, { immediate: true })}
        />
      ))}
      {colorGroup !== undefined && colorOptions.length > 0 ? (
        <SellerListboxField
          id="wizard-color_id"
          label={colorGroup.label}
          value={dto.colorId}
          placeholder="Rəng seçin"
          options={colorOptions}
          swatches
          onChange={(id) => editor.patch({ color_id: id === null ? null : String(id) }, { immediate: true })}
        />
      ) : null}
    </div>
  );
}

/** Satış məlumatı — price, mileage, city, lightweight boolean chips,
    category-relevant condition claims (seller declarations only). */
function SaleSection({ editor, catalog }: { editor: ListingEditor; catalog: WizardCatalog }) {
  const { dto } = editor;
  return (
    <div className="space-y-5">
      <div className="grid gap-x-3.5 gap-y-3 desk:grid-cols-2">
        <DeferredInput
          id="wizard-price"
          label={SELLER.price}
          inputMode="numeric"
          placeholder="15000"
          inputClassName="font-condensed text-[15px] font-semibold"
          initialValue={dto.priceMinor === null ? "" : minorToAznInput(String(dto.priceMinor))}
          onValue={(value) => {
            if (value.trim() === "") {
              editor.patch({ price_minor: null });
              return;
            }
            const minor = aznInputToMinor(value);
            if (minor !== null) {
              editor.patch({ price_minor: Number(minor) });
            }
          }}
        />
        <DeferredInput
          id="wizard-mileage"
          label={SELLER.mileage}
          inputMode="numeric"
          placeholder="120000"
          inputClassName="font-condensed text-[15px] font-semibold"
          initialValue={dto.mileage === null ? "" : String(dto.mileage)}
          onValue={(value) => {
            const digits = value.trim().replace(/\s+/g, "");
            editor.patch({ mileage: /^\d{1,7}$/.test(digits) ? Number(digits) : null });
          }}
        />
        <SelectField
          id="wizard-city"
          label={SELLER.city}
          value={dto.cityId}
          placeholder={SELLER.select}
          items={catalog.cities}
          onChange={(id) => editor.patch({ city_id: id }, { immediate: true })}
        />
      </div>
      {/* Booleans stay visually light (o9 components.md): chips, not
          cards — they never compete with price/photos. */}
      <div className="flex flex-wrap gap-2">
        <ChipToggle
          id="wizard-credit"
          label={SELLER.credit}
          checked={dto.creditAvailable}
          onChange={(checked) => editor.patch({ credit_available: checked }, { immediate: true })}
        />
        <ChipToggle
          id="wizard-barter"
          label={SELLER.barter}
          checked={dto.barterAvailable}
          onChange={(checked) => editor.patch({ barter_available: checked }, { immediate: true })}
        />
      </div>
      {dto.category === "CAR" ? (
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-slate-strong">
            {SELLER.conditionTitle}
            <span className="ml-1.5 font-normal text-muted">· {SELLER.claimsDeclarationHint}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            <DeferredChipToggle
              id="wizard-no-accident"
              label={SELLER.noAccident}
              initialChecked={dto.noAccident === true}
              onValue={(checked) => editor.patch({ no_accident: checked ? true : null }, { immediate: true })}
            />
            <DeferredChipToggle
              id="wizard-not-repainted"
              label={SELLER.notRepainted}
              initialChecked={dto.notRepainted === true}
              onValue={(checked) => editor.patch({ not_repainted: checked ? true : null }, { immediate: true })}
            />
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

/** Əlavə məlumat — grouped feature expander + optional description
    (real 5000 max; no invented limits). */
function ExtrasSection({ editor, catalog }: { editor: ListingEditor; catalog: WizardCatalog }) {
  const { dto } = editor;
  const [description, setDescription] = useState(dto.description ?? "");
  return (
    <div className="space-y-5">
      <EquipmentSelector editor={editor} features={catalog.features} />
      <div>
        <label htmlFor="wizard-description" className="mb-1 block text-xs font-medium text-slate-strong">
          {SELLER.description}
        </label>
        <textarea
          id="wizard-description"
          data-testid="wizard-description"
          rows={4}
          className="min-h-24 w-full rounded-control border border-line-strong bg-raised px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition-colors duration-150 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
          maxLength={5000}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            editor.patch({ description: e.target.value.trim() === "" ? null : e.target.value });
          }}
        />
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="text-xs text-muted">{SELLER.descriptionHint}</p>
          <p className="shrink-0 text-[11px] tabular-nums text-muted" data-testid="wizard-description-count">
            {description.length}/5000
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * O.9 autosave chip (components.md): "Saxlanılır…" (spinner) /
 * "✓ Saxlanıldı hh:mm" / "Xəta baş verdi ↻". Never optimistic — the
 * saved time is the server-confirmed updated_at, and the error state
 * offers an explicit retry of the pending patch.
 */
function AutosaveChip({
  state,
  updatedAtIso,
  onRetry,
}: {
  state: string;
  updatedAtIso: string;
  onRetry: () => void;
}) {
  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        data-testid="axin-autosave"
        data-state="error"
        className="inline-flex h-8 items-center rounded-pill bg-danger-soft px-2.5 text-[11px] font-medium text-danger transition-colors duration-150 hover:bg-danger-soft/80"
      >
        {SELLER.saveError} ↻
      </button>
    );
  }
  if (state === "saving" || state === "dirty") {
    return (
      <span
        data-testid="axin-autosave"
        data-state="saving"
        className="inline-flex h-8 items-center gap-1.5 px-1 text-[11px] font-medium text-muted"
      >
        <Loader2 size={12} className="animate-spin" aria-hidden="true" />
        {SELLER.saving}
      </span>
    );
  }
  const time = new Date(updatedAtIso).toLocaleTimeString("az-AZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Baku",
  });
  return (
    <span
      data-testid="axin-autosave"
      data-state="saved"
      className="inline-flex h-8 items-center gap-1 px-1 text-[11px] font-medium text-muted"
    >
      <span className="text-primary" aria-hidden="true">✓</span>
      {SELLER.saved} {time}
    </span>
  );
}

/** Post-submit outcome — FREE → moderation, PAID → payment required. */
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
