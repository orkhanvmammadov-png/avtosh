import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactCard } from "@/components/marketplace/contact-card";
import { Gallery } from "@/components/marketplace/gallery";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api/errors";
import { formatMileage, formatPriceMinor, formatYear, vehicleTitle } from "@/lib/format";
import { CATEGORY_LABELS, SPEC_LABELS, STATUS_LABELS, UI } from "@/lib/marketplace/labels";
import { publicDetail, type PublicDetailDto } from "@/services/marketplace";
import { publicIdParamSchema } from "@/validators/marketplace";

export const dynamic = "force-dynamic";

async function loadDetail(publicIdParam: string): Promise<PublicDetailDto | null> {
  const parsed = publicIdParamSchema.safeParse(publicIdParam);
  if (!parsed.success) return null;
  try {
    return (await publicDetail(parsed.data)).listing;
  } catch (error) {
    if (error instanceof ApiError && error.code === "LISTING_NOT_FOUND") return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ publicId: string }> }): Promise<Metadata> {
  const { publicId } = await params;
  const listing = await loadDetail(publicId);
  // Metadata resolves before the response streams, so a true 404 status is emitted.
  if (listing === null) notFound();
  const title = vehicleTitle(listing);
  const parts = [CATEGORY_LABELS[listing.category], formatPriceMinor(listing.priceMinor, listing.currency), listing.city].filter(Boolean);
  return {
    title,
    description: `${title} — ${parts.join(", ")}. AVTOSH.AZ elanı.`,
    alternates: { canonical: `/elan/${listing.publicId}` },
    // Non-current listings are kept reachable by direct link but not indexed.
    robots: listing.status === "ACTIVE" ? undefined : { index: false, follow: true },
    openGraph: { title, images: listing.images[0]?.url ? [listing.images[0].url] : [] },
  };
}

export default async function ListingDetailPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const listing = await loadDetail(publicId);
  if (listing === null) notFound();
  const title = vehicleTitle(listing);
  const limited = !listing.contactable;
  const specs: [string, string | null][] = [
    [SPEC_LABELS.year, formatYear(listing.year)],
    [SPEC_LABELS.mileage, formatMileage(listing.mileage)],
    [SPEC_LABELS.city, listing.city],
    [SPEC_LABELS.fuelType, listing.fuelType],
    [SPEC_LABELS.transmission, listing.transmission],
    [SPEC_LABELS.bodyType, listing.bodyType],
    [SPEC_LABELS.driveType, listing.driveType],
    [SPEC_LABELS.motorcycleType, listing.motorcycleType],
    [SPEC_LABELS.color, listing.color],
    [SPEC_LABELS.engineCc, listing.engineCc === null ? null : `${listing.engineCc} sm³`],
    [SPEC_LABELS.credit, listing.creditAvailable === null ? null : listing.creditAvailable ? "Var" : "Yoxdur"],
    [SPEC_LABELS.barter, listing.barterAvailable === null ? null : listing.barterAvailable ? "Var" : "Yoxdur"],
  ];

  return (
    <article className="py-6" data-testid="listing-detail" data-status={listing.status}>
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          {listing.status === "SOLD" ? <Badge tone="sold">{STATUS_LABELS.SOLD}</Badge> : null}
          {listing.status === "EXPIRED" ? <Badge tone="expired">{STATUS_LABELS.EXPIRED}</Badge> : null}
          {listing.badges.premium ? <Badge tone="premium">{UI.premiumBadge}</Badge> : null}
          {listing.badges.boosted ? <Badge tone="boosted">{UI.boostedBadge}</Badge> : null}
        </div>
        <h1 className="mt-2 text-2xl font-bold text-navy md:text-3xl">{title}</h1>
        <p className="mt-1 text-2xl font-extrabold text-primary" data-testid="detail-price">{formatPriceMinor(listing.priceMinor, listing.currency)}</p>
        {limited ? (
          <p role="status" className="mt-3 rounded-lg bg-line/60 px-4 py-3 text-sm text-navy" data-testid="limited-notice">
            Bu elan artıq aktiv deyil. Satıcı ilə əlaqə mümkün deyil.
          </p>
        ) : null}
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Gallery images={listing.images} title={title} />
          <section aria-labelledby="specs-title" className="rounded-card border border-line bg-white p-4 md:p-6">
            <h2 id="specs-title" className="text-lg font-semibold text-navy">{UI.specs}</h2>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2" data-testid="specs">
              {specs.filter(([, v]) => v !== null && v !== "—").map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-line py-2 text-sm">
                  <dt className="text-muted">{k}</dt><dd className="font-medium text-navy">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          {!limited && listing.description ? (
            <section aria-labelledby="desc-title" className="rounded-card border border-line bg-white p-4 md:p-6">
              <h2 id="desc-title" className="text-lg font-semibold text-navy">{UI.description}</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-6 text-navy" data-testid="description">{listing.description}</p>
            </section>
          ) : null}
          {!limited && listing.features.length > 0 ? (
            <section aria-labelledby="feat-title" className="rounded-card border border-line bg-white p-4 md:p-6">
              <h2 id="feat-title" className="text-lg font-semibold text-navy">{UI.features}</h2>
              <ul className="mt-3 flex flex-wrap gap-2" data-testid="features">
                {listing.features.map((f) => <li key={f.code} className="rounded-md bg-surface px-3 py-1.5 text-sm text-navy">{f.name}</li>)}
              </ul>
            </section>
          ) : null}
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          {!limited && listing.seller ? (
            <ContactCard publicId={listing.publicId} displayName={listing.seller.displayName} maskedPhone={listing.seller.contactPhoneMasked} />
          ) : null}
        </div>
      </div>
    </article>
  );
}
