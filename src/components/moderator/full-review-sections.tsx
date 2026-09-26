import { STAFF } from "@/lib/marketplace/labels";
import { formatMileage, formatPriceMinor } from "@/lib/format";
import type { ModerationFeatureGroupDto } from "@/services/moderation-content";

/**
 * O.13 Stage A — "Elanın bütün məlumatları": the complete structured
 * read-mode review of one content layer (01-full-review-ia.md). ONE
 * component renders the NEW submitted content, the LISTING_EDIT
 * proposed content, and the collapsed current-approved layer — no
 * per-mode forks. Read-only by design: no edit controls exist until
 * Stage B. Missing optional values hide their row (approved IA);
 * equipment meaning is carried by text (✓ + group headers), never
 * color alone.
 */

export interface FullReviewImage {
  id: string;
  isPrimary: boolean;
  url: string | null;
}

/** Structural view of one content layer — satisfied by the server
    ModerationContentDto and by the detail top-level mapping. */
export interface FullReviewContent {
  category: string;
  brandName: string | null;
  modelName: string | null;
  modelVariantName?: string | null;
  year: number | null;
  priceMinor: number | null;
  currency: string;
  mileage: number | null;
  engineCc: number | null;
  fuelType: string | null;
  transmission: string | null;
  bodyType: string | null;
  driveType: string | null;
  motorcycleType: string | null;
  color: string | null;
  cityName: string | null;
  creditAvailable: boolean;
  barterAvailable: boolean;
  noAccident: boolean | null;
  notRepainted: boolean | null;
  description: string | null;
  sellerName: string | null;
  contactPhone: string | null;
  featureGroups: ModerationFeatureGroupDto[];
  images: FullReviewImage[];
}

function Rows({ rows, testId }: { rows: [string, string | null][]; testId?: string }) {
  return (
    <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2" data-testid={testId}>
      {rows
        .filter(([, value]) => value !== null)
        .map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-line py-1.5 text-sm">
            <dt className="text-slate-strong">{label}</dt>
            <dd className="text-right font-medium text-ink">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function SubSection({
  title,
  testId,
  children,
}: {
  title: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-staff border border-line bg-raised p-4" data-testid={testId}>
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      {children}
    </section>
  );
}

export function FullReviewSections({
  content,
  testId,
  heading = STAFF.fullData,
  layerNote,
  contactExtras = [],
  galleryAlt,
}: {
  content: FullReviewContent;
  testId: string;
  /** Outer h2; null when a wrapping <details> summary already labels
      the block (heading hierarchy stays h3 sections either way). */
  heading?: string | null;
  /** Small layer line under the heading (e.g. Təklif olunan dəyişiklik). */
  layerNote?: string;
  /** Extra Satıcı / Əlaqə rows (account identity, submission time). */
  contactExtras?: [string, string | null][];
  galleryAlt: string;
}) {
  const moto = content.category === "MOTORCYCLE";
  const vehicleRows: [string, string | null][] = [
    ["Kateqoriya", moto ? "Motosiklet" : "Avtomobil"],
    ["Marka", content.brandName],
    ["Model", content.modelName],
    ["Alt model", content.modelVariantName ?? null],
    ["Buraxılış ili", content.year === null ? null : String(content.year)],
    ["Ban növü", content.bodyType],
    ["Moto növü", content.motorcycleType],
    ["Mühərrik", content.engineCc === null ? null : `${content.engineCc} sm³`],
    ["Yanacaq", content.fuelType],
    ["Sürətlər qutusu", content.transmission],
    ["Ötürücü", content.driveType],
    ["Rəng", content.color],
  ];
  const salesRows: [string, string | null][] = [
    ["Qiymət", formatPriceMinor(content.priceMinor, content.currency)],
    ["Yürüş", content.mileage === null ? null : formatMileage(content.mileage)],
    ["Şəhər", content.cityName],
    ["Kredit", content.creditAvailable ? "Var" : "Yoxdur"],
    ["Barter", content.barterAvailable ? "Var" : "Yoxdur"],
  ];
  const conditionRows: [string, string | null][] = [
    ["Vuruğu yoxdur", content.noAccident === true ? "Qeyd edilib" : "Qeyd edilməyib"],
    ["Rənglənməyib", content.notRepainted === true ? "Qeyd edilib" : "Qeyd edilməyib"],
  ];
  const contactRows: [string, string | null][] = [
    ["Satıcının adı (elanda)", content.sellerName],
    [STAFF.contactField, content.contactPhone],
    ...contactExtras,
  ];

  return (
    <div className="space-y-4" data-testid={testId}>
      {heading !== null ? (
        <div>
          <h2 className="text-base font-bold text-ink">{heading}</h2>
          {layerNote !== undefined ? (
            <p className="mt-0.5 text-xs text-muted" data-testid={`${testId}-layer`}>{layerNote}</p>
          ) : null}
        </div>
      ) : null}

      <SubSection title={moto ? STAFF.secVehicleMoto : STAFF.secVehicleCar}>
        <Rows rows={vehicleRows} />
      </SubSection>

      <SubSection title={STAFF.secSales}>
        <Rows rows={salesRows} />
      </SubSection>

      <SubSection title={STAFF.secCondition}>
        <Rows rows={conditionRows} />
      </SubSection>

      <SubSection title={STAFF.secEquipment} testId={`${testId}-equipment`}>
        {content.featureGroups.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{STAFF.equipmentEmpty}</p>
        ) : (
          <div className="mt-2 space-y-3">
            {content.featureGroups.map((group) => (
              <div key={group.code} data-testid={`${testId}-equipment-${group.code}`}>
                <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-strong">
                  {group.label}
                </h4>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {group.features.map((feature) => (
                    <li key={feature.id} className="text-sm text-ink">
                      <span aria-hidden="true" className="mr-1 text-success">✓</span>
                      {feature.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SubSection>

      {content.description !== null ? (
        <SubSection title={STAFF.descriptionTitle}>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink" data-testid={`${testId}-description`}>
            {content.description}
          </p>
        </SubSection>
      ) : null}

      <SubSection title={STAFF.secSellerContact} testId={`${testId}-contact`}>
        <Rows rows={contactRows} />
      </SubSection>

      <SubSection title={STAFF.images}>
        {content.images.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{STAFF.noImage}</p>
        ) : (
          <ul className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3" data-testid={`${testId}-gallery`}>
            {content.images.map((image, index) => (
              <li key={image.id} className="relative overflow-hidden rounded-staff bg-sunken">
                {image.url !== null ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                  <img
                    src={image.url}
                    alt={`${galleryAlt} — ${index + 1}`}
                    className="aspect-vehicle w-full object-cover text-transparent"
                    loading={index < 3 ? "eager" : "lazy"}
                  />
                ) : (
                  <div
                    className="flex aspect-vehicle w-full items-center justify-center text-xs text-slate-strong"
                    data-testid="gallery-image-fallback"
                  >
                    {STAFF.noImage}
                  </div>
                )}
                {image.isPrimary ? (
                  <span className="absolute left-1.5 top-1.5 rounded-[3px] bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-white">
                    {STAFF.primaryTag}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SubSection>
    </div>
  );
}
