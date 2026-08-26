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
      className="flex items-center gap-3 rounded-card border border-line bg-white p-2.5 transition-shadow hover:shadow-md"
      data-testid="queue-item"
      data-listing-id={item.id}
    >
      <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md bg-line/50">
        {item.primaryImageUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          <img src={item.primaryImageUrl} alt="" className="h-full w-full object-cover" />
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
        <p className="truncate text-sm font-semibold text-navy">{title}</p>
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
          className="shrink-0 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800"
          data-testid="queue-claimed"
        >
          Nəzarətdə
        </span>
      ) : null}
    </article>
  );
}
