import { formatPriceMinor, vehicleTitle } from "@/lib/format";
import { STAFF } from "@/lib/marketplace/labels";

export interface QueueCardItem {
  id: string;
  publicId: string;
  /** O.12: NEW_LISTING or LISTING_EDIT (rendered as an approved tag —
      internal enum names never reach the screen). */
  type: "NEW_LISTING" | "LISTING_EDIT";
  category: string;
  brandName: string | null;
  modelName: string | null;
  year: number | null;
  priceMinor: number | null;
  cityName: string | null;
  submittedAt: string;
  primaryImageUrl: string | null;
  claim: { moderatorId: string; expiresAt: string } | null;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("az-Latn-AZ", {
    timeZone: "Asia/Baku",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}.${get("month")} ${get("hour")}:${get("minute")}`;
}

/** Dense staff queue row: review context, no unnecessary seller PII. */
export function QueueCard({ item }: { item: QueueCardItem }) {
  const title = vehicleTitle({ brand: item.brandName, model: item.modelName, year: item.year });
  return (
    <article
      className="flex items-center gap-3 rounded-staff border border-line bg-raised p-2.5 transition-colors duration-150 hover:border-line-strong hover:bg-row-hover"
      data-testid="queue-item"
      data-listing-id={item.id}
    >
      <div className="h-14 w-20 shrink-0 overflow-hidden rounded-staff bg-sunken">
        {item.primaryImageUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          <img src={item.primaryImageUrl} alt="" className="h-full w-full object-cover text-transparent" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-[10px] font-medium text-slate-strong"
            data-testid="queue-image-fallback"
          >
            {STAFF.noImage}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {/* O.12 type tag (06-moderator-diff.md): 8.5/600 caps; wraps
            above the title at narrow widths by nature of the flow */}
        <span
          className={`mb-0.5 inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.06em] ${
            item.type === "LISTING_EDIT" ? "bg-navy text-[#2FAE74]" : "bg-sunken text-slate-strong"
          }`}
          data-testid="queue-type-tag"
          data-type={item.type}
        >
          {item.type === "LISTING_EDIT" ? STAFF.tagListingEdit : STAFF.tagNewListing}
        </span>
        <p className="truncate text-[13px] font-semibold text-ink">{title}</p>
        <p className="text-xs text-muted">
          {item.category === "MOTORCYCLE" ? "Motosiklet" : "Avtomobil"}
          {item.cityName !== null ? ` · ${item.cityName}` : ""} ·{" "}
          {formatPriceMinor(item.priceMinor, "AZN")}
        </p>
        <p className="text-xs text-muted">
          {STAFF.submittedAt}: {formatDateTime(item.submittedAt)}
        </p>
      </div>
      {item.claim !== null ? (
        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-warning-soft px-2.5 py-1 text-xs font-semibold text-warning"
          data-testid="queue-claimed"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
          Nəzarətdə
        </span>
      ) : null}
    </article>
  );
}
