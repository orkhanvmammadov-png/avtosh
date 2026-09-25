import { STAFF } from "@/lib/marketplace/labels";
import type { EditReviewDto } from "@/services/moderation-edit";

/**
 * O.12 changed-first edit comparison (06-moderator-diff.md): scalar
 * old→new rows, textual boolean transitions, equipment +/− lists with
 * O.11 names, badged photo row, description before/after blocks, and
 * the unchanged context collapsed behind "Digər məlumatlar". Meaning is
 * never color-only: struck old values, the "→" separator and textual
 * badges carry it in DOM order.
 */

/** Approved field labels — internal keys never reach the screen. */
const FIELD_LABELS: Record<string, string> = {
  category: "Kateqoriya",
  brand: "Marka",
  model: "Model",
  model_variant: "Alt model",
  year: "Buraxılış ili",
  price: "Qiymət",
  mileage: "Yürüş",
  engine_cc: "Mühərrik",
  fuel_type: "Yanacaq",
  transmission: "Sürətlər qutusu",
  body_type: "Ban növü",
  drive_type: "Ötürücü",
  motorcycle_type: "Moto növü",
  color: "Rəng",
  city: "Şəhər",
  credit: "Kredit",
  barter: "Barter",
  no_accident: "Vuruğu yoxdur",
  not_repainted: "Rənglənməyib",
  seller_name: "Satıcının adı (elanda)",
  contact_phone: "Əlaqə nömrəsi",
};

const BADGE_LABELS: Record<string, string> = {
  ADDED: STAFF.diffAdded,
  REMOVED: STAFF.diffRemoved,
  NEW_PRIMARY: STAFF.diffNewPrimary,
};

export function EditReviewDiff({ review }: { review: EditReviewDto }) {
  const hasChanges =
    review.scalarChanges.length > 0 ||
    review.descriptionChange !== null ||
    review.equipmentAdded.length > 0 ||
    review.equipmentRemoved.length > 0 ||
    review.photoDiff.some((item) => item.badge !== null) ||
    review.photosReordered;

  return (
    <section
      aria-label={STAFF.editReviewTitle}
      className="rounded-staff border border-line bg-raised p-4"
      data-testid="edit-review-diff"
    >
      <h2 className="text-sm font-bold text-ink">{STAFF.editReviewTitle}</h2>
      <p className="mt-0.5 text-xs text-muted">{STAFF.editReviewLegend}</p>

      {/* optional lifecycle context — approved copy, no field names */}
      {review.sellerDeactivated || review.listingExpired ? (
        <p
          className="mt-3 rounded-staff bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning"
          data-testid="edit-review-context"
        >
          {review.listingExpired ? STAFF.editCtxExpired : STAFF.editCtxDeactivated}
        </p>
      ) : null}

      {!hasChanges ? (
        <p className="mt-3 text-sm text-muted" data-testid="edit-diff-empty">
          {STAFF.diffUnchanged}
        </p>
      ) : null}

      {review.scalarChanges.length > 0 ? (
        <dl className="mt-3 space-y-1.5" data-testid="edit-diff-scalars">
          {review.scalarChanges.map((change) => (
            <div
              key={change.field}
              className="grid grid-cols-1 gap-1 border-b border-line py-1.5 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
              data-testid={`edit-diff-${change.field}`}
            >
              <dt className="text-slate-strong">{FIELD_LABELS[change.field] ?? change.field}</dt>
              <dd className="flex flex-wrap items-baseline gap-2 sm:justify-end sm:text-right">
                <span className="text-muted line-through">{change.oldValue ?? "—"}</span>
                <span aria-hidden="true" className="text-muted">→</span>
                <span className="rounded-[4px] bg-success-soft px-1.5 py-0.5 font-semibold text-success">
                  {change.newValue ?? "—"}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {review.equipmentAdded.length > 0 || review.equipmentRemoved.length > 0 ? (
        <div className="mt-4" data-testid="edit-diff-equipment">
          <h3 className="text-xs font-bold uppercase tracking-[0.05em] text-slate-strong">Təchizat</h3>
          {review.equipmentAdded.length > 0 ? (
            <p className="mt-1.5 text-sm text-success" data-testid="equipment-added">
              <span className="font-semibold">{STAFF.diffAdded}:</span>{" "}
              {review.equipmentAdded.map((name) => `+ ${name}`).join(" · ")}
            </p>
          ) : null}
          {review.equipmentRemoved.length > 0 ? (
            <p className="mt-1.5 text-sm text-danger" data-testid="equipment-removed">
              <span className="font-semibold">{STAFF.diffRemoved}:</span>{" "}
              {review.equipmentRemoved.map((name) => `− ${name}`).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {review.photoDiff.some((item) => item.badge !== null) || review.photosReordered ? (
        <div className="mt-4" data-testid="edit-diff-photos">
          <h3 className="text-xs font-bold uppercase tracking-[0.05em] text-slate-strong">
            {STAFF.images}
          </h3>
          {review.photosReordered ? (
            <p className="mt-1 text-xs text-slate-strong" data-testid="photos-reordered">
              {STAFF.diffReordered}
            </p>
          ) : null}
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {review.photoDiff.map((item, index) => (
              <li
                key={index}
                className={`relative overflow-hidden rounded-staff bg-sunken ${
                  item.badge === "REMOVED" ? "opacity-55" : ""
                }`}
                data-testid="photo-diff-item"
                data-badge={item.badge ?? "UNCHANGED"}
              >
                {item.url !== null ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                  <img src={item.url} alt="" className="aspect-vehicle w-full object-cover text-transparent" />
                ) : (
                  <div className="flex aspect-vehicle w-full items-center justify-center text-xs text-slate-strong">
                    {STAFF.noImage}
                  </div>
                )}
                {item.badge !== null ? (
                  <span
                    className={`absolute left-1 top-1 rounded-[3px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.03em] text-white ${
                      item.badge === "REMOVED" ? "bg-danger" : "bg-primary"
                    }`}
                  >
                    {BADGE_LABELS[item.badge]}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.descriptionChange !== null ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2" data-testid="edit-diff-description">
          <div className="rounded-staff bg-sunken p-3">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-strong">
              {STAFF.diffBefore}
            </h3>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink" data-testid="description-before">
              {review.descriptionChange.before ?? "—"}
            </p>
          </div>
          <div className="rounded-staff bg-success-soft p-3">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.06em] text-success">
              {STAFF.diffAfter}
            </h3>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink" data-testid="description-after">
              {review.descriptionChange.after ?? "—"}
            </p>
          </div>
        </div>
      ) : null}

      {review.unchanged.length > 0 ? (
        <details className="mt-4" data-testid="edit-diff-unchanged">
          <summary className="cursor-pointer text-sm font-medium text-slate-strong">
            {STAFF.diffUnchanged}
          </summary>
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {review.unchanged.map((entry) => (
              <div key={entry.field} className="flex justify-between gap-4 border-b border-line py-1.5 text-sm">
                <dt className="text-slate-strong">{FIELD_LABELS[entry.field] ?? entry.field}</dt>
                <dd className="text-right font-medium text-ink">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
