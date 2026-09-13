"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { ResultPanel } from "@/components/ui/result-panel";
import { formatPriceMinor } from "@/lib/format";
import { aznInputToMinor, minorToAznInput } from "@/lib/format";
import { engineCcOptions } from "@/lib/marketplace/engine-options";
import { LISTING_YEAR_MIN, listingYearMax } from "@/lib/config/marketplace";
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
import { useListingEditor, type ListingEditor } from "@/components/seller/use-listing-editor";
import { useWizardCatalog, OPTION_GROUPS, type WizardCatalog } from "@/components/seller/use-wizard-catalog";
import { Loader2 } from "lucide-react";
import { SellerListboxField } from "@/components/seller/listbox-field";
import { ChipToggle, DeferredChipToggle, DeferredInput, SelectField } from "@/components/seller/wizard-fields";
import { PhotosStep } from "@/components/seller/photos-step";
import { ContactSection } from "@/components/seller/axin/contact-section";
import { ReviewSection } from "@/components/seller/axin/review-section";
import { SectionCard } from "@/components/seller/axin/section-card";
import { TypeaheadField } from "@/components/seller/axin/typeahead-field";

/**
 * O.9 AXIN seller flow (flow.md): ONE page of collapsing section
 * cards over the existing serialized revision-guarded editor — Quick
 * Start + 6 sections, deterministic n/7 progress, one card open at a
 * time, summaries with Dəyiş. Replaces the 5-step wizard on the same
 * routes and the same backend contracts (create/PATCH/submit/
 * resubmit are untouched).
 */

const SECTION_KEYS = ["quickstart", "details", "sale", "photos", "extras", "contact", "review"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

const SECTION_TITLES: Record<SectionKey, string> = {
  quickstart: SELLER.quickStartTitle,
  details: SELLER.sectionDetails,
  sale: SELLER.sectionSale,
  photos: SELLER.sectionPhotos,
  extras: SELLER.sectionExtras,
  contact: SELLER.sectionContact,
  review: SELLER.sectionReview,
};

/** Submission missing-codes → the AXIN section that owns the field. */
const MISSING_CODE_SECTION: Record<string, SectionKey> = {
  brand: "quickstart",
  model: "quickstart",
  year: "quickstart",
  price: "sale",
  mileage: "sale",
  city: "sale",
  contact_phone: "contact",
  seller_name: "contact",
};

interface SubmitErrorView {
  title: string;
  items: string[];
  sections: SectionKey[];
}

function submitErrorView(error: unknown): SubmitErrorView {
  if (error instanceof PublicApiError) {
    if (error.code === "LISTING_INCOMPLETE") {
      const details = error.details as { missing?: string[] } | null;
      const codes = details?.missing ?? [];
      return {
        title: SELLER.incompleteTitle,
        items: codes.map((code) => MISSING_FIELD_LABELS[code] ?? code),
        sections: [...new Set(codes.map((code) => MISSING_CODE_SECTION[code]).filter((s): s is SectionKey => s !== undefined))],
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
}: {
  initial: OwnerListingDto;
  feedback: SellerModerationFeedbackDto | null;
  /** Login phone — offered as a one-tap listing-contact suggestion
      only; NEVER written anywhere except listings.contact_phone_e164
      through the normal PATCH. */
  authPhoneE164: string;
  authDisplayName: string | null;
}) {
  const editor = useListingEditor(initial);
  const catalog = useWizardCatalog(editor.dto.category, editor.dto.brandId);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitErrorView | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const isResubmission = initial.status !== "DRAFT";
  const dto = editor.dto;

  // Deterministic completeness — derived from persisted data only, so
  // it survives reload. Sections without required fields count as
  // complete (they are genuinely optional per the server contract).
  const complete: Record<SectionKey, boolean> = {
    quickstart: dto.brandId !== null && dto.modelId !== null && dto.year !== null,
    details: true,
    sale: dto.priceMinor !== null && dto.mileage !== null && dto.cityId !== null,
    photos: dto.images.length >= 3,
    extras: true,
    contact: dto.sellerName !== null && dto.contactPhone !== null,
    review: false,
  };
  const doneCount = SECTION_KEYS.filter((k) => complete[k]).length;

  const firstIncomplete = SECTION_KEYS.find((k) => !complete[k]) ?? "review";
  const [openSection, setOpenSection] = useState<SectionKey>(firstIncomplete);

  const attention = new Set(submitError?.sections ?? []);

  function completeSection(key: SectionKey) {
    void editor.flush();
    const after = SECTION_KEYS.slice(SECTION_KEYS.indexOf(key) + 1);
    const next = after.find((k) => !complete[k]) ?? "review";
    setOpenSection(next);
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const flushed = await editor.flush();
      if (!flushed) return;
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
      {/* Navy flow header — title, autosave promise, deterministic n/7. */}
      <div className="bg-navy text-white">
        <div className="mx-auto flex h-12 max-w-[680px] items-center justify-between gap-3 px-4 xl:px-0">
          <p className="min-w-0 truncate text-[13px]">
            <span className="font-bold">{SELLER.newListing}</span>
            <span className="text-white/60"> · {SELLER.autosaveHint}</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <p
              aria-live="polite"
              data-testid="wizard-save-state"
              className={`text-[11px] font-medium ${
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
              className="rounded-pill bg-[#1D2733] px-2.5 py-1 text-[11px] font-semibold text-white/85"
              data-testid="axin-progress"
            >
              {doneCount}/7 {SELLER.progressDone}
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[680px] px-4 pb-24 pt-5 md:pb-8 xl:px-0">
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
            <h2 className="text-sm font-semibold text-warning">{SELLER.moderationFeedback}</h2>
            <p className="mt-1 text-sm font-medium text-ink">
              {feedback.reasonCode !== null ? (REASON_LABELS[feedback.reasonCode] ?? feedback.reasonCode) : null}
            </p>
            {feedback.note !== null ? <p className="mt-1 text-sm text-slate-strong">{feedback.note}</p> : null}
          </div>
        ) : null}

        <div key={editor.resetKey} className="space-y-2.5">
          <SectionCard
            sectionKey="quickstart"
            index={1}
            title={SECTION_TITLES.quickstart}
            open={openSection === "quickstart"}
            complete={complete.quickstart}
            needsAttention={attention.has("quickstart")}
            summary={quickStartSummary(dto, catalog)}
            onOpen={() => setOpenSection("quickstart")}
            onComplete={() => completeSection("quickstart")}
            completeDisabled={!complete.quickstart}
            footerStart={autosaveChip}
          >
            <QuickStartSection editor={editor} catalog={catalog} />
          </SectionCard>

          <SectionCard
            sectionKey="details"
            index={2}
            title={SECTION_TITLES.details}
            open={openSection === "details"}
            complete={complete.details}
            needsAttention={attention.has("details")}
            summary={detailsSummary(dto, catalog)}
            onOpen={() => setOpenSection("details")}
            onComplete={() => completeSection("details")}
            footerStart={autosaveChip}
          >
            <DetailsSection editor={editor} catalog={catalog} />
          </SectionCard>

          <SectionCard
            sectionKey="sale"
            index={3}
            title={SECTION_TITLES.sale}
            open={openSection === "sale"}
            complete={complete.sale}
            needsAttention={attention.has("sale")}
            summary={saleSummary(dto, catalog)}
            onOpen={() => setOpenSection("sale")}
            onComplete={() => completeSection("sale")}
            completeDisabled={!complete.sale}
            footerStart={autosaveChip}
          >
            <SaleSection editor={editor} catalog={catalog} />
          </SectionCard>

          <SectionCard
            sectionKey="photos"
            index={4}
            title={SECTION_TITLES.photos}
            open={openSection === "photos"}
            complete={complete.photos}
            needsAttention={attention.has("photos")}
            summary={dto.images.length > 0 ? `${dto.images.length} şəkil` : null}
            onOpen={() => setOpenSection("photos")}
            onComplete={() => completeSection("photos")}
            completeDisabled={!complete.photos}
            footerStart={autosaveChip}
          >
            <PhotosStep editor={editor} />
          </SectionCard>

          <SectionCard
            sectionKey="extras"
            index={5}
            title={SECTION_TITLES.extras}
            open={openSection === "extras"}
            complete={complete.extras}
            needsAttention={attention.has("extras")}
            summary={extrasSummary(dto)}
            onOpen={() => setOpenSection("extras")}
            onComplete={() => completeSection("extras")}
            footerStart={autosaveChip}
          >
            <ExtrasSection editor={editor} catalog={catalog} />
          </SectionCard>

          <SectionCard
            sectionKey="contact"
            index={6}
            title={SECTION_TITLES.contact}
            open={openSection === "contact"}
            complete={complete.contact}
            needsAttention={attention.has("contact")}
            summary={contactSummary(dto)}
            onOpen={() => setOpenSection("contact")}
            onComplete={() => completeSection("contact")}
            completeDisabled={!complete.contact}
            footerStart={autosaveChip}
          >
            <ContactSection editor={editor} authPhoneE164={authPhoneE164} authDisplayName={authDisplayName} />
          </SectionCard>

          <SectionCard
            sectionKey="review"
            index={7}
            title={SECTION_TITLES.review}
            open={openSection === "review"}
            complete={false}
            needsAttention={false}
            summary={null}
            onOpen={() => setOpenSection("review")}
          >
            <ReviewSection
              editor={editor}
              catalog={catalog}
              isResubmission={isResubmission}
              onEdit={(section) => setOpenSection(section)}
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
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-3">
              {!isResubmission ? (
                <button
                  type="button"
                  onClick={() => void skipPromoAndSubmit()}
                  disabled={submitting || editor.conflict}
                  data-testid="wizard-submit-skip-promo"
                  className="inline-flex min-h-11 items-center rounded-control px-4 text-[13px] font-medium text-slate-strong transition-colors duration-150 hover:text-ink disabled:opacity-50"
                >
                  {SELLER.promoSkip}
                </button>
              ) : null}
              <Button onClick={() => void submit()} disabled={submitting || editor.conflict} data-testid="wizard-submit">
                {submitting ? SELLER.submitting : isResubmission ? SELLER.resubmit : SELLER.submit}
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// --- section summaries (one line, collapsed cards) --------------------------

function quickStartSummary(dto: OwnerListingDto, catalog: WizardCatalog): string | null {
  const parts = [catalog.nameOf(dto.brandId), catalog.nameOf(dto.modelId), dto.year === null ? null : String(dto.year)].filter(
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

function extrasSummary(dto: OwnerListingDto): string | null {
  const parts = [
    dto.featureIds.length > 0 ? `${dto.featureIds.length} təchizat` : null,
    dto.description !== null && dto.description !== "" ? "təsvir var" : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : "istəyə bağlı";
}

function contactSummary(dto: OwnerListingDto): string | null {
  const parts = [dto.sellerName, dto.contactPhone].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
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
    <div className="grid gap-4 sm:grid-cols-2">
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
    <div className="grid gap-4 sm:grid-cols-2">
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
      <div className="grid gap-x-3.5 gap-y-3 sm:grid-cols-2">
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
  const [featuresOpen, setFeaturesOpen] = useState(false);
  return (
    <div className="space-y-5">
      {catalog.features.length > 0 ? (
        <fieldset>
          <button
            type="button"
            aria-expanded={featuresOpen}
            onClick={() => setFeaturesOpen((v) => !v)}
            data-testid="wizard-features-toggle"
            className="flex h-10 w-full items-center justify-between rounded-control border border-line-strong bg-raised px-3.5 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-muted"
          >
            <span>
              {SELLER.featuresSelect}
              {dto.featureIds.length > 0 ? (
                <span className="ml-1.5 font-semibold text-primary">({dto.featureIds.length})</span>
              ) : null}
            </span>
            <span aria-hidden="true" className="text-muted">
              {featuresOpen ? "▴" : "▾"}
            </span>
          </button>
          {featuresOpen ? (
            <div
              className="mt-2 grid max-h-72 grid-cols-1 gap-1 overflow-y-auto rounded-control border border-line p-2 sm:grid-cols-2"
              data-testid="wizard-features"
            >
              {catalog.features.map((feature) => {
                const checked = dto.featureIds.includes(feature.id);
                return (
                  <label
                    key={feature.id}
                    htmlFor={`wizard-feature-${feature.id}`}
                    className="flex h-9 cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-[12.5px] text-ink transition-colors duration-150 hover:bg-row-hover"
                  >
                    <input
                      id={`wizard-feature-${feature.id}`}
                      data-testid={`wizard-feature-${feature.id}`}
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={checked}
                      onChange={(e) => {
                        const ids = e.target.checked
                          ? [...dto.featureIds, feature.id]
                          : dto.featureIds.filter((id) => id !== feature.id);
                        editor.patch({ feature_ids: ids }, { immediate: true });
                      }}
                    />
                    {feature.name}
                  </label>
                );
              })}
            </div>
          ) : null}
        </fieldset>
      ) : null}
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
