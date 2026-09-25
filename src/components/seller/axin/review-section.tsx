"use client";

import { useEffect, useState } from "react";
import { Check, Zap } from "lucide-react";
import { formatAzPhoneForDisplay } from "@/components/auth/phone-format";
import { formatMileage, formatPriceMinor, vehicleTitle } from "@/lib/format";
import { SELLER } from "@/lib/marketplace/labels";
import { publicFetch } from "@/lib/marketplace/public-api";
import { fetchQuota, type QuotaDto } from "@/lib/seller/owner-api";
import type { PromotionPackageDto } from "@/services/promotion-purchases";
import type { ListingEditor } from "@/components/seller/use-listing-editor";
import { OPTION_GROUPS, type WizardCatalog } from "@/components/seller/use-wizard-catalog";

/**
 * O.9 BAXIŞ VƏ DƏRC (layout.md): compact review rendered purely from
 * the loaded draft — preview row (84px thumb) → key facts → ƏLAQƏ
 * block → fee line → optional Premium/Boost intent cards. No preview
 * endpoint; the fee line is the ADVISORY quota read (the submit
 * transaction stays authoritative); promotion selection writes ONLY
 * the intent preference fields and can never create payment activity.
 */

type SectionKey = "quickstart" | "details" | "sale" | "photos" | "extras" | "contact";

function EditLink({ onClick, testid }: { onClick: () => void; testid: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="shrink-0 text-[12.5px] font-semibold text-primary transition-colors duration-150 hover:text-primary-hover"
    >
      {SELLER.sectionEdit}
    </button>
  );
}

export function ReviewSection({
  editor,
  catalog,
  isResubmission,
  editMode = false,
  onEdit,
}: {
  editor: ListingEditor;
  catalog: WizardCatalog;
  isResubmission: boolean;
  /** O.12 edit mode: edits are free — no fee/quota line and no
      promotion-intent module (intent is sealed out of edit scope). */
  editMode?: boolean;
  onEdit: (section: SectionKey) => void;
}) {
  const { dto } = editor;
  const [quota, setQuota] = useState<QuotaDto | null>(null);
  const [packages, setPackages] = useState<PromotionPackageDto[] | null>(null);

  useEffect(() => {
    if (editMode) return; // advisory quota is a NEW-flow concept only
    void fetchQuota()
      .then(setQuota)
      .catch(() => setQuota(null));
  }, [editMode]);
  useEffect(() => {
    if (editMode) return;
    void publicFetch<{ packages: PromotionPackageDto[] }>("/api/v1/me/promotion-packages")
      .then((r) => setPackages(r.data.packages))
      .catch(() => setPackages([]));
  }, [editMode]);

  const title = vehicleTitle({
    brand: catalog.nameOf(dto.brandId),
    model: catalog.nameOf(dto.modelId),
    year: dto.year,
  });
  const primary = dto.images.find((image) => image.isPrimary) ?? dto.images[0];
  const ready =
    dto.brandId !== null &&
    dto.modelId !== null &&
    (catalog.variants.length === 0 || dto.modelVariantId !== null) &&
    dto.year !== null &&
    dto.priceMinor !== null &&
    dto.mileage !== null &&
    dto.cityId !== null &&
    dto.sellerName !== null &&
    dto.contactPhone !== null &&
    dto.images.length >= 3;

  const specBits = [
    dto.engineCc === null ? null : `${dto.engineCc} sm³`,
    ...OPTION_GROUPS.map((g) => catalog.nameOf(dto[g.dtoKey])),
  ].filter((v): v is string => v !== null);

  const selectedChips: string[] = [
    dto.creditAvailable ? SELLER.credit : null,
    dto.barterAvailable ? SELLER.barter : null,
    dto.noAccident === true ? SELLER.noAccident : null,
    dto.notRepainted === true ? SELLER.notRepainted : null,
  ].filter((v): v is Exclude<typeof v, null> => v !== null);

  return (
    <div className="space-y-3.5">
      {/* readiness line (advisory; the server still decides) */}
      <p
        className={`rounded-control px-3.5 py-2.5 text-[12.5px] font-medium ${
          ready ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
        }`}
        data-testid="wizard-completeness"
      >
        {ready ? SELLER.completenessDone : SELLER.completenessTitle}
      </p>

      {/* preview row */}
      <div className="rounded-card border border-line bg-raised p-3" data-testid="wizard-preview">
        <div className="flex items-start gap-3">
          <div className="h-[63px] w-[84px] shrink-0 overflow-hidden rounded-[8px] bg-sunken">
            {primary?.url != null ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed owner URL
              <img src={primary.url} alt={title} className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="truncate text-[13.5px] font-bold text-ink">{title}</p>
              <EditLink onClick={() => onEdit("quickstart")} testid="review-edit-vehicle" />
            </div>
            <p className="mt-0.5 font-condensed text-[19px] font-bold leading-none text-ink">
              {formatPriceMinor(dto.priceMinor, dto.currency)}
            </p>
            <p className="mt-1 truncate text-xs text-muted">
              {[
                dto.mileage === null ? null : formatMileage(dto.mileage),
                catalog.nameOf(dto.cityId),
                `${dto.images.length} ${SELLER.photos.toLowerCase()}`,
              ]
                .filter((v): v is string => v !== null)
                .join(" · ")}
            </p>
          </div>
        </div>
        {specBits.length > 0 ? (
          <div className="mt-2.5 flex items-start justify-between gap-3 border-t border-line pt-2.5">
            <p className="text-xs leading-relaxed text-slate-strong">{specBits.join(" · ")}</p>
            <EditLink onClick={() => onEdit("details")} testid="review-edit-details" />
          </div>
        ) : null}
        {selectedChips.length > 0 ? (
          <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-line pt-2.5">
            <div className="flex flex-wrap gap-1.5">
              {selectedChips.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex h-6 items-center rounded-[5px] border border-[#147A4E]/40 bg-[#E7F2EC] px-2 text-[11px] font-medium text-[#147A4E]"
                >
                  {chip}
                </span>
              ))}
            </div>
            <EditLink onClick={() => onEdit("sale")} testid="review-edit-sale" />
          </div>
        ) : null}
      </div>

      {/* ƏLAQƏ block */}
      <div className="rounded-card border border-line bg-raised p-3.5" data-testid="review-contact">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
              {SELLER.reviewContactTitle}
            </p>
            <p className="mt-1 text-[12.5px] font-semibold text-ink" data-testid="review-contact-name">
              {dto.sellerName ?? "—"}
            </p>
            <p className="text-[12.5px] text-slate-strong" data-testid="review-contact-phone">
              {dto.contactPhone === null ? "—" : formatAzPhoneForDisplay(dto.contactPhone)}
            </p>
          </div>
          <EditLink onClick={() => onEdit("contact")} testid="review-edit-contact" />
        </div>
        {/* Əlavə məlumat lives in the SAME combined stage (O.10) —
            its Dəyiş routes to infoContact exactly like the contact
            fields above. */}
        <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-line pt-2.5" data-testid="review-extras">
          <p className="text-xs text-slate-strong">
            {[
              dto.featureIds.length > 0 ? `${dto.featureIds.length} ${SELLER.features.toLowerCase()}` : null,
              dto.description !== null && dto.description !== "" ? SELLER.description : null,
            ]
              .filter((v): v is string => v !== null)
              .join(" · ") || `${SELLER.sectionExtras} — ${SELLER.subgroupOptional}`}
          </p>
          <EditLink onClick={() => onEdit("extras")} testid="review-edit-extras" />
        </div>
      </div>

      {/* fee line — advisory quota; hidden entirely for resubmission
          (existing publication is reused, no new fee/slot) */}
      {!isResubmission && !editMode && quota !== null ? (
        <div
          className="flex items-center justify-between gap-3 rounded-card border border-line bg-raised px-3.5 py-3"
          data-testid="wizard-quota"
        >
          <div>
            <p className="text-[12.5px] font-semibold text-ink">{SELLER.reviewFeeTitle}</p>
            <p className="text-[11px] text-muted">
              {quota.nextPublicationIsPaid ? SELLER.quotaPaid : SELLER.quotaFree}
            </p>
          </div>
          <p className="shrink-0 font-condensed text-[17px] font-bold text-ink" data-testid="review-fee-value">
            {quota.nextPublicationIsPaid
              ? formatPriceMinor(quota.listingFeeMinor, quota.currency)
              : SELLER.reviewFeeFree}
          </p>
        </div>
      ) : null}

      {/* Promotion intent — optional, never preselected, intent only.
          Never rendered in edit mode (sealed out of edit scope). */}
      {!editMode ? <PromotionIntentModule editor={editor} packages={packages} /> : null}
    </div>
  );
}

/** Premium/Boost intent cards (promotions.md): backend-provided
    packages only, both selectable, separate products, no totals. */
function PromotionIntentModule({
  editor,
  packages,
}: {
  editor: ListingEditor;
  packages: PromotionPackageDto[] | null;
}) {
  const { dto } = editor;
  if (packages === null) return null; // loading — never fake content
  if (packages.length === 0) {
    return (
      <p className="rounded-card border border-line bg-sunken px-3.5 py-3 text-[12px] text-slate-strong" data-testid="promo-intent-unavailable">
        {SELLER.promotionPackagesUnavailable}
      </p>
    );
  }
  const anySelected = dto.premiumIntentPackageId !== null || dto.boostIntentPackageId !== null;
  return (
    <section aria-label={SELLER.promoModuleTitle} data-testid="promo-intent">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-bold text-ink">{SELLER.promoModuleTitle}</h3>
        <span className="text-[11px] text-muted">{SELLER.promoOptionalHint}</span>
      </div>
      <div className="grid gap-[9px] desk:grid-cols-2">
        <IntentCard
          type="PREMIUM"
          packages={packages.filter((p) => p.type === "PREMIUM")}
          selectedId={dto.premiumIntentPackageId}
          onSelect={(id) => editor.patch({ premium_intent_package_id: id }, { immediate: true })}
        />
        <IntentCard
          type="BOOST"
          packages={packages.filter((p) => p.type === "BOOST")}
          selectedId={dto.boostIntentPackageId}
          onSelect={(id) => editor.patch({ boost_intent_package_id: id }, { immediate: true })}
        />
      </div>
      {anySelected ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-slate-strong" data-testid="promo-pre-active-note">
          {SELLER.promoPreActive}
        </p>
      ) : null}
    </section>
  );
}

function IntentCard({
  type,
  packages,
  selectedId,
  onSelect,
}: {
  type: "PREMIUM" | "BOOST";
  packages: PromotionPackageDto[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (packages.length === 0) return null;
  const selected = selectedId !== null && packages.some((p) => p.id === selectedId);
  return (
    <div
      className={`rounded-[10px] border bg-raised p-3.5 ${selected ? "border-2 border-[#147A4E]" : "border-[#E3E0D8]"}`}
      data-testid={`promo-intent-${type}`}
      data-selected={selected ? "true" : "false"}
    >
      <div className="flex items-center justify-between gap-2">
        {type === "PREMIUM" ? (
          <span className="inline-flex items-center rounded-[5px] bg-navy px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-premium">
            Premium
          </span>
        ) : (
          <span className="inline-flex items-center gap-0.5 rounded-[5px] bg-boost-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-boost">
            <Zap size={11} strokeWidth={2.5} aria-hidden="true" />
            Boost
          </span>
        )}
        {selected ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#147A4E] text-white" aria-hidden="true">
            <Check size={12} strokeWidth={3} />
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-strong">
        {type === "PREMIUM" ? SELLER.premiumDescription : SELLER.boostDescription}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {packages.map((pkg) => {
          const isSelected = selectedId === pkg.id;
          return (
            <button
              key={pkg.id}
              type="button"
              aria-pressed={isSelected}
              data-testid={`promo-intent-${type}-${pkg.durationDays}`}
              onClick={() => onSelect(isSelected ? null : pkg.id)}
              className={`inline-flex h-9 items-center gap-1 rounded-control border px-2.5 text-[12px] font-medium transition-colors duration-150 ${
                isSelected
                  ? "border-[#147A4E] bg-[#E7F2EC] text-[#147A4E]"
                  : "border-line-strong bg-raised text-ink hover:border-muted"
              }`}
            >
              {pkg.durationDays} {SELLER.promotionDay}
              <span className="font-semibold">· {formatPriceMinor(pkg.priceMinor, pkg.currency)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
