import { formatPriceMinor, vehicleTitle } from "@/lib/format";
import { STAFF } from "@/lib/marketplace/labels";

export interface QueueCardItem {
  id: string;
  publicId: string;
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
            className="flex h-full w-full items-center justify-center text-[10px] font-medium text-muted"
            data-testid="queue-image-fallback"
          >
            {STAFF.noImage}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
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
