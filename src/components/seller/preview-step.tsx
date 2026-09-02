"use client";

import { useEffect, useState } from "react";
import { formatMileage, formatPriceMinor, vehicleTitle } from "@/lib/format";
import { SELLER } from "@/lib/marketplace/labels";
import { fetchQuota, type QuotaDto } from "@/lib/seller/owner-api";
import type { ListingEditor } from "@/components/seller/use-listing-editor";
import { OPTION_GROUPS, type WizardCatalog } from "@/components/seller/use-wizard-catalog";

export interface CompletenessItem {
  key: string;
  label: string;
  done: boolean;
  step: number;
}

/**
 * Client-side completeness guide mirroring the ACCEPTED submission
 * requirements (brand/model/year/price/mileage/city/contact + ≥3
 * confirmed images with a primary). Advisory only — the submit
 * endpoint remains the authority and its errors are surfaced as-is.
 */
export function completenessChecklist(editor: ListingEditor): CompletenessItem[] {
  const { dto } = editor;
  return [
    { key: "brand", label: SELLER.brand, done: dto.brandId !== null, step: 1 },
    { key: "model", label: SELLER.model, done: dto.modelId !== null, step: 1 },
    { key: "year", label: SELLER.year, done: dto.year !== null, step: 1 },
    { key: "price", label: SELLER.price, done: dto.priceMinor !== null, step: 2 },
    { key: "mileage", label: SELLER.mileage, done: dto.mileage !== null, step: 2 },
    { key: "city", label: SELLER.city, done: dto.cityId !== null, step: 2 },
    {
      key: "images",
      label: SELLER.minPhotos,
      done: dto.images.length >= 3 && dto.images.some((image) => image.isPrimary),
      step: 3,
    },
    { key: "contact_phone", label: SELLER.contactPhone, done: dto.contactPhone !== null, step: 4 },
  ];
}

/** Step 5 — owner-data preview, advisory quota, completeness. */
export function PreviewStep({
  editor,
  catalog,
  onGoToStep,
}: {
  editor: ListingEditor;
  catalog: WizardCatalog;
  onGoToStep: (step: number) => void;
}) {
  const { dto } = editor;
  const [quota, setQuota] = useState<QuotaDto | null>(null);
  const checklist = completenessChecklist(editor);
  const missing = checklist.filter((item) => !item.done);
  const title = vehicleTitle({
    brand: catalog.nameOf(dto.brandId),
    model: catalog.nameOf(dto.modelId),
    year: dto.year,
  });

  useEffect(() => {
    void fetchQuota()
      .then(setQuota)
      .catch(() => setQuota(null));
  }, []);

  const specs: [string, string | null][] = [
    [SELLER.city, catalog.nameOf(dto.cityId)],
    [SELLER.mileage, dto.mileage === null ? null : formatMileage(dto.mileage)],
    [SELLER.engineCc, dto.engineCc === null ? null : `${dto.engineCc} sm³`],
    ...OPTION_GROUPS.map(
      (g) => [g.label, catalog.nameOf(dto[g.dtoKey])] as [string, string | null],
    ),
  ];

  return (
    <div className="space-y-5">
      <section
        aria-label={SELLER.completenessTitle}
        className={`rounded-control px-4 py-3 ${missing.length === 0 ? "bg-success-soft" : "border-l-4 border-warning bg-warning-soft"}`}
        data-testid="wizard-completeness"
      >
        <h3 className={`text-sm font-semibold ${missing.length === 0 ? "text-success" : "text-warning"}`}>
          {missing.length === 0 ? SELLER.completenessDone : SELLER.completenessTitle}
        </h3>
        {missing.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {missing.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  className="inline-flex min-h-12 items-center rounded-control border border-line-strong bg-raised px-3 text-sm font-medium text-ink transition-colors duration-150 hover:border-primary hover:text-primary"
                  onClick={() => onGoToStep(item.step)}
                  data-testid={`missing-${item.key}`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {quota !== null ? (
        <p
          className="rounded-control bg-primary-tint px-4 py-3 text-sm font-medium text-primary-pressed"
          data-testid="wizard-quota"
        >
          {quota.nextPublicationIsPaid
            ? `${SELLER.quotaPaid} ${formatPriceMinor(quota.listingFeeMinor, quota.currency)}`
            : `${SELLER.quotaFree} ${SELLER.quotaFreeRemaining} ${quota.freeRemaining}`}
        </p>
      ) : null}

      <article className="overflow-hidden rounded-card border border-line bg-raised" data-testid="wizard-preview">
        {dto.images.length > 0 ? (
          <div className="grid grid-cols-3 gap-1 bg-sunken p-1">
            {dto.images.slice(0, 6).map((image, index) =>
              image.url !== null ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed owner URLs
                <img
                  key={image.id}
                  src={image.url}
                  alt={`${SELLER.photos} ${index + 1}`}
                  className={`aspect-vehicle w-full object-cover ${index === 0 ? "col-span-3" : ""}`}
                />
              ) : null,
            )}
          </div>
        ) : null}
        <div className="space-y-2 p-4">
          <h3 className="text-lg font-bold tracking-[-0.01em] text-ink">{title}</h3>
          <p className="font-condensed text-[26px] font-bold leading-none text-ink">
            {formatPriceMinor(dto.priceMinor, dto.currency)}
          </p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {specs
              .filter(([, value]) => value !== null)
              .map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-line py-1.5 text-sm">
                  <dt className="text-slate-strong">{label}</dt>
                  <dd className="font-medium text-ink">{value}</dd>
                </div>
              ))}
          </dl>
          {dto.description !== null ? (
            <p className="whitespace-pre-line pt-2 text-sm leading-relaxed text-ink">{dto.description}</p>
          ) : null}
        </div>
      </article>
    </div>
  );
}
