import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { Container } from "@/components/ui/container";
import { ContactCard } from "@/components/marketplace/contact-card";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { Gallery } from "@/components/marketplace/gallery";
import { ReportListing } from "@/components/marketplace/report-listing";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { PromotionBadge } from "@/components/ui/promotion-badge";
import { SectionCard } from "@/components/ui/section-card";
import { buttonClasses } from "@/components/ui/button";
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

/**
 * Approved listing detail (screens.md): full-bleed navy stage with
 * gallery + sticky conversion panel; specs/features/description on
 * paper below. The single responsive ContactCard keeps the accepted
 * reveal endpoint/rate-limit behavior; SOLD/EXPIRED render the
 * approved limited state (desaturated gallery, notice instead of the
 * panel, no favorite on SOLD).
 */
export default async function ListingDetailPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const listing = await loadDetail(publicId);
  if (listing === null) notFound();
  const title = vehicleTitle(listing);
  const limited = !listing.contactable;
  const contactable = !limited && listing.seller !== null;
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
    <article data-testid="listing-detail" data-status={listing.status}>
      {/* Navy stage — full-bleed. */}
      <section className="bg-navy pb-8 pt-4 text-white md:pb-10">
        <Container>
          <nav aria-label="Naviqasiya yolu" className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-on-navy-muted">
            <Link href="/" className="hover:text-white">Əsas səhifə</Link>
            <span aria-hidden="true">/</span>
            <Link href={`/elanlar?category=${listing.category}`} className="hover:text-white">
              {CATEGORY_LABELS[listing.category]}
            </Link>
            <span aria-hidden="true">/</span>
            <span className="truncate text-white/80">{title}</span>
          </nav>
          <div className="grid gap-6 desk:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {listing.status === "SOLD" ? <Badge tone="sold">{STATUS_LABELS.SOLD}</Badge> : null}
                    {listing.status === "EXPIRED" ? <Badge tone="expired">{STATUS_LABELS.EXPIRED}</Badge> : null}
                    {listing.badges.premium ? <PromotionBadge type="PREMIUM" /> : null}
                    {listing.badges.boosted ? <PromotionBadge type="BOOST" label={UI.boostedBadge} /> : null}
                  </div>
                  <h1 className="mt-1.5 text-xl font-bold tracking-[-0.01em] md:text-2xl">{title}</h1>
                  <p className="mt-1 font-condensed text-[26px] font-bold leading-none text-green-dark desk:text-[28px]" data-testid="detail-price">
                    {formatPriceMinor(listing.priceMinor, listing.currency)}
                  </p>
                </div>
                {listing.status !== "SOLD" ? <FavoriteButton publicId={listing.publicId} size="lg" autoIntent /> : null}
              </div>
              <div className={limited ? "saturate-[0.6]" : ""}>
                <Gallery images={listing.images} title={title} />
              </div>
            </div>
            <div className="desk:sticky desk:top-20 desk:self-start">
              {contactable && listing.seller ? (
                <ContactCard
                  publicId={listing.publicId}
                  displayName={listing.seller.displayName}
                  maskedPhone={listing.seller.contactPhoneMasked}
                  priceLabel={formatPriceMinor(listing.priceMinor, listing.currency)}
                  premium={listing.badges.premium}
                />
              ) : (
                <div className="rounded-[12px] border border-navy-border bg-navy-raised p-5">
                  <p role="status" className="text-sm leading-relaxed text-on-navy-muted" data-testid="limited-notice">
                    Bu elan artıq aktiv deyil. Satıcı ilə əlaqə mümkün deyil.
                  </p>
                  <Link
                    href={`/elanlar?category=${listing.category}`}
                    className={buttonClasses("primary", "mt-4 w-full")}
                  >
                    Oxşar elanlara bax
                  </Link>
                </div>
              )}
            </div>
          </div>
        </Container>
      </section>

      {/* Paper content. */}
      <Container className={`space-y-5 py-6 md:py-8 ${contactable ? "pb-[120px] desk:pb-8" : ""}`}>
        <SectionCard title={UI.specs} titleId="specs-title">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-0.5 sm:grid-cols-2" data-testid="specs">
            {specs.filter(([, v]) => v !== null && v !== "—").map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
                <dt className="text-slate-strong">{k}</dt>
                <dd className="text-right font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
        {!limited && listing.features.length > 0 ? (
          <SectionCard title={UI.features} titleId="feat-title">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="features">
              {listing.features.map((f) => (
                <li key={f.code} className="flex items-center gap-2 text-sm text-ink">
                  <Check size={15} strokeWidth={2.5} className="shrink-0 text-primary" aria-hidden="true" />
                  {f.name}
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}
        {!limited && listing.description ? (
          <SectionCard title={UI.description} titleId="desc-title">
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink" data-testid="description">
              {listing.description}
            </p>
          </SectionCard>
        ) : null}
        {!limited ? (
          <Notice tone="info">
            Təhlükəsizlik üçün: avtomobili şəxsən yoxlamadan ödəniş etməyin və rəsmi sənədləşmədən
            əvvəl beh göndərməyin.
          </Notice>
        ) : null}
        <div className="pt-1">
          <ReportListing publicId={listing.publicId} />
        </div>
      </Container>
    </article>
  );
}
