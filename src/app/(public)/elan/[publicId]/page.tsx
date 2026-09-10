import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { Container } from "@/components/ui/container";
import { ContactCard } from "@/components/marketplace/contact-card";
import { DescriptionClamp, FeaturesList } from "@/components/marketplace/detail/expanders";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { Gallery } from "@/components/marketplace/gallery";
import { ReportListing } from "@/components/marketplace/report-listing";
import { Notice } from "@/components/ui/notice";
import { PromotionBadge } from "@/components/ui/promotion-badge";
import { ApiError } from "@/lib/api/errors";
import { formatDateAz, formatFreshness, formatMileage, formatPriceMinor, formatYear, vehicleTitle } from "@/lib/format";
import { CATEGORY_LABELS, SPEC_LABELS, STATUS_LABELS, UI } from "@/lib/marketplace/labels";
import { publicDetail, type PublicDetailDto } from "@/services/marketplace";
import { publicIdParamSchema } from "@/validators/marketplace";

export const dynamic = "force-dynamic";

async function loadDetail(
  publicIdParam: string,
): Promise<{ listing: PublicDetailDto; nowMs: number } | null> {
  const parsed = publicIdParamSchema.safeParse(publicIdParam);
  if (!parsed.success) return null;
  try {
    // The render-time reference for freshness text is produced here in
    // data-loading code (components must stay pure per lint contract).
    return { listing: (await publicDetail(parsed.data)).listing, nowMs: Date.now() };
  } catch (error) {
    if (error instanceof ApiError && error.code === "LISTING_NOT_FOUND") return null;
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ publicId: string }> }): Promise<Metadata> {
  const { publicId } = await params;
  const listing = (await loadDetail(publicId))?.listing ?? null;
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

/** Detail identity title per the O.7 panel: "Brand Model, Year". */
function detailTitle(listing: PublicDetailDto): string {
  const name = [listing.brand, listing.model].filter((p): p is string => p !== null && p.length > 0).join(" ");
  if (name.length === 0) return vehicleTitle(listing);
  return listing.year === null ? name : `${name}, ${listing.year}`;
}

/** Key-spec tiles (components.md): category-aware, missing tiles omitted. */
function keySpecTiles(listing: PublicDetailDto): [string, string][] {
  const engine = listing.engineCc === null ? null : `${listing.engineCc} sm³`;
  const candidates: [string, string | null][] =
    listing.category === "MOTORCYCLE"
      ? [
          // No power field exists in the product — the mock's "Güc" tile
          // is deliberately absent; the grid reflows to the real five.
          [SPEC_LABELS.year, listing.year === null ? null : formatYear(listing.year)],
          [SPEC_LABELS.mileage, listing.mileage === null ? null : formatMileage(listing.mileage)],
          [SPEC_LABELS.engineCc, engine],
          [SPEC_LABELS.fuelType, listing.fuelType],
          [SPEC_LABELS.color, listing.color],
        ]
      : [
          [SPEC_LABELS.year, listing.year === null ? null : formatYear(listing.year)],
          [SPEC_LABELS.mileage, listing.mileage === null ? null : formatMileage(listing.mileage)],
          [SPEC_LABELS.engineCc, engine],
          [SPEC_LABELS.fuelType, listing.fuelType],
          [SPEC_LABELS.transmission, listing.transmission],
          [SPEC_LABELS.driveType, listing.driveType],
        ];
  return candidates.filter((pair): pair is [string, string] => pair[1] !== null);
}

/** Grouped lower specifications — real fields only, missing rows hidden. */
function specGroups(listing: PublicDetailDto): { title: string; rows: [string, string][] }[] {
  const engine = listing.engineCc === null ? null : `${listing.engineCc} sm³`;
  const vehicle: [string, string | null][] = [
    [SPEC_LABELS.bodyType, listing.bodyType],
    [SPEC_LABELS.motorcycleType, listing.motorcycleType],
    [SPEC_LABELS.color, listing.color],
    [SPEC_LABELS.city, listing.city],
    [SPEC_LABELS.credit, listing.creditAvailable === null ? null : listing.creditAvailable ? "Var" : "Yoxdur"],
    [SPEC_LABELS.barter, listing.barterAvailable === null ? null : listing.barterAvailable ? "Var" : "Yoxdur"],
  ];
  const tech: [string, string | null][] = [
    [SPEC_LABELS.year, listing.year === null ? null : formatYear(listing.year)],
    [SPEC_LABELS.mileage, listing.mileage === null ? null : formatMileage(listing.mileage)],
    [SPEC_LABELS.engineCc, engine],
    [SPEC_LABELS.fuelType, listing.fuelType],
    [SPEC_LABELS.transmission, listing.transmission],
    [SPEC_LABELS.driveType, listing.driveType],
  ];
  const clean = (rows: [string, string | null][]) =>
    rows.filter((pair): pair is [string, string] => pair[1] !== null);
  return [
    { title: listing.category === "MOTORCYCLE" ? "MOTOSİKLET" : "AVTOMOBİL", rows: clean(vehicle) },
    { title: "TEXNİKİ", rows: clean(tech) },
  ].filter((g) => g.rows.length > 0);
}

/**
 * O.7 Direction 1A (SƏHNƏ), Stage A (1440-first): gallery-dominant
 * navy stage with the dark identity panel (badges, price, chips,
 * title, meta, contact, seller, footer), then paper panels — key-spec
 * tiles + grouped specs | condition claims + features + description.
 * Server component; interaction lives in small client islands
 * (Gallery, ContactCard, Favorite, Report, expanders). Public DTO,
 * visibility rules, reveal/report/favorite contracts unchanged.
 */
export default async function ListingDetailPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const loaded = await loadDetail(publicId);
  if (loaded === null) notFound();
  const { listing, nowMs } = loaded;
  const title = detailTitle(listing);
  const limited = !listing.contactable;
  const contactable = !limited && listing.seller !== null;
  const freshness = listing.publishedAt === null ? null : formatFreshness(listing.publishedAt, nowMs);
  const meta = [
    listing.mileage === null ? null : formatMileage(listing.mileage),
    listing.fuelType,
    listing.city,
    freshness,
  ].filter((p): p is string => p !== null);
  const tiles = keySpecTiles(listing);
  const groups = specGroups(listing);
  const hasConditions = listing.category !== "MOTORCYCLE" && (listing.noAccident === true || listing.notRepainted === true);
  const sellerInitial = (listing.seller?.displayName ?? UI.seller).trim().charAt(0).toUpperCase() || "S";

  return (
    <article data-testid="listing-detail" data-status={listing.status}>
      {/* Navy stage — full-bleed. */}
      <section className="bg-navy pb-6 pt-1.5 text-white xl:pb-7">
        <Container>
          <div className="flex items-center justify-between py-2 md:hidden">
            <Link
              href={`/elanlar?category=${listing.category}`}
              className="inline-flex min-h-11 items-center gap-1 text-[12px] font-medium text-on-navy-muted hover:text-white"
              data-testid="detail-back"
            >
              ← Geri
            </Link>
            {listing.status !== "SOLD" ? <FavoriteButton publicId={listing.publicId} skin="panel" /> : null}
          </div>
          <nav aria-label="Naviqasiya yolu" className="mb-3 hidden flex-wrap items-center gap-1.5 py-2 text-xs text-on-navy-muted md:flex">
            <Link href="/" className="hover:text-white">Əsas səhifə</Link>
            <span aria-hidden="true">/</span>
            <Link href={`/elanlar?category=${listing.category}`} className="hover:text-white">
              {CATEGORY_LABELS[listing.category]}
            </Link>
            <span aria-hidden="true">/</span>
            <span className="truncate text-white/80">{title}</span>
          </nav>
          <div className="grid gap-0 md:gap-3 desk:grid-cols-[minmax(0,1fr)_340px] desk:gap-5 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-7">
            {/* Gallery column — the dominant element. */}
            <div className="-mx-4 min-w-0 md:mx-0">
              <div className={`relative ${limited ? "saturate-[0.6]" : ""}`}>
                {limited ? (
                  <span
                    className={`absolute left-3 top-3 z-10 rounded-[5px] px-[9px] py-1 text-[10px] font-bold uppercase tracking-[0.06em] ${
                      listing.status === "SOLD" ? "bg-[#EDEBE4] text-[#565B63]" : "bg-[#FBEED8] text-[#9A5B06]"
                    }`}
                    data-testid="status-chip"
                  >
                    {listing.status === "SOLD" ? STATUS_LABELS.SOLD : STATUS_LABELS.EXPIRED}
                  </span>
                ) : null}
                <Gallery images={listing.images} title={title} />
              </div>
            </div>
            {/* Identity panel. */}
            <div
              className="relative self-start rounded-none border-0 border-navy-border bg-transparent p-0 pt-3 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-4 md:rounded-[12px] md:border md:bg-navy-raised md:p-4 desk:sticky desk:top-20 desk:block desk:p-4 xl:p-5"
              data-testid="identity-panel"
            >
              <div className="min-w-0">
              <div className="mb-2.5 flex flex-wrap items-center gap-[5px] pr-10 md:mb-[7px] md:pr-0 desk:mb-2.5 desk:pr-10">
                {listing.badges.premium ? <PromotionBadge type="PREMIUM" onNavy /> : null}
                {listing.badges.boosted ? <PromotionBadge type="BOOST" /> : null}
              </div>
              <p
                className={`whitespace-nowrap font-condensed text-[26px] font-bold leading-none md:text-[27px] desk:text-[28px] xl:text-[34px] ${limited ? "text-on-navy-muted" : "text-white"}`}
                data-testid="detail-price"
              >
                {formatPriceMinor(listing.priceMinor, listing.currency)}
              </p>
              {listing.creditAvailable === true || listing.barterAvailable === true ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {listing.creditAvailable === true ? (
                    <span className="rounded-pill border border-navy-border px-2.5 py-1 text-[11px] font-medium text-on-navy-muted" data-testid="chip-credit">
                      Kredit mümkündür
                    </span>
                  ) : null}
                  {listing.barterAvailable === true ? (
                    <span className="rounded-pill border border-navy-border px-2.5 py-1 text-[11px] font-medium text-on-navy-muted" data-testid="chip-barter">
                      {UI.barter}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <h1 className="mt-2.5 break-words text-[15px] font-semibold leading-snug md:mt-1.5 md:text-[14.5px] desk:mt-2 desk:text-[15px] xl:mt-3 xl:text-[17px]">
                {title}
                {meta.length > 0 ? (
                  <span className="hidden font-normal text-[11.5px] text-on-navy-muted md:inline desk:hidden"> · {meta.join(" · ")}</span>
                ) : null}
              </h1>
              {meta.length > 0 ? (
                <p className="mt-0.5 text-[12px] text-on-navy-muted md:hidden desk:mt-0.5 desk:block desk:text-[11.5px] xl:mt-1 xl:text-[12.5px]" data-testid="detail-meta">
                  {meta.join(" · ")}
                </p>
              ) : null}
              </div>
              <div className="mt-4 md:mt-0 md:flex md:shrink-0 md:items-center md:gap-2 desk:mt-3 desk:block xl:mt-4">
                {contactable && listing.seller ? (
                  <ContactCard
                    publicId={listing.publicId}
                    displayName={listing.seller.displayName}
                    maskedPhone={listing.seller.contactPhoneMasked}
                    stickyAccessory={<FavoriteButton publicId={listing.publicId} skin="sticky" />}
                  />
                ) : (
                  <div
                    role="status"
                    className={`rounded-lg px-4 py-3.5 ${listing.status === "SOLD" ? "bg-[#EDEBE4]" : "bg-[#FBEED8]"}`}
                    data-testid="limited-notice"
                  >
                    <p className={`text-[13.5px] font-bold ${listing.status === "SOLD" ? "text-ink" : "text-[#9A5B06]"}`}>
                      {listing.status === "SOLD"
                        ? listing.category === "CAR" ? "Bu avtomobil satılıb" : "Bu elan satılıb"
                        : "Elanın müddəti bitib"}
                    </p>
                    <p className={`mt-1 text-[12px] leading-relaxed ${listing.status === "SOLD" ? "text-slate-strong" : "text-[#9A5B06]"}`}>
                      {listing.status === "SOLD"
                        ? "Elan arxivdədir — satıcı ilə əlaqə mümkün deyil. Oxşar elanlara baxın."
                        : "Elanın müddəti bitib — satıcı ilə əlaqə bağlıdır. Oxşar aktiv elanlara baxın."}
                    </p>
                    <Link
                      href={`/elanlar?category=${listing.category}`}
                      className="mt-2.5 inline-flex min-h-10 items-center rounded-[6px] border border-primary px-3.5 text-[12.5px] font-semibold text-primary hover:bg-primary-tint"
                    >
                      Oxşar elanlara bax →
                    </Link>
                  </div>
                )}
                {listing.status !== "SOLD" ? (
                  <span className="hidden md:static md:block desk:absolute desk:right-4 desk:top-4 xl:right-5 xl:top-5">
                    <FavoriteButton publicId={listing.publicId} skin="panel" autoIntent />
                  </span>
                ) : null}
              </div>
              {contactable && listing.seller ? (
                <div className="mt-3.5 hidden items-center gap-2.5 border-t border-navy-border pt-3 md:hidden desk:mt-3 desk:flex desk:pt-2.5 xl:mt-3.5 xl:pt-3" data-testid="seller-module">
                  <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-border text-sm font-semibold text-green-dark">
                    {sellerInitial}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{listing.seller.displayName ?? UI.seller}</p>
                    {listing.city ? <p className="text-[11.5px] text-on-navy-muted">{listing.city}</p> : null}
                  </div>
                </div>
              ) : null}
              <div className="mt-3 hidden items-center justify-between gap-3 text-[11px] text-on-navy-muted md:hidden desk:flex">
                <span data-testid="listing-ref">
                  Elan № {listing.publicId}
                  {listing.publishedAt !== null ? ` · ${formatDateAz(listing.publishedAt)}` : ""}
                </span>
                <a href="#report" className="text-[#D08A82] transition-colors duration-150 hover:underline" data-testid="panel-report-link">
                  Şikayət et
                </a>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Paper content. */}
      <Container className={`py-4 md:py-8 ${contactable ? "pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-[120px] desk:pb-8" : ""}`}>
        <div className="grid items-start gap-3 md:gap-4 desk:grid-cols-2">
          {/* Left: key specs + grouped specifications. */}
          <section aria-labelledby="specs-title" className="rounded-none border-0 bg-transparent p-0 md:rounded-[10px] md:border md:border-line md:bg-raised md:px-[18px] md:py-4">
            <h2 id="specs-title" className="sr-only text-[14.5px] font-bold text-ink md:not-sr-only">Əsas göstəricilər</h2>
            {tiles.length > 0 ? (
              <div className="grid grid-cols-2 gap-[7px] sm:grid-cols-3 sm:gap-2 md:mt-2.5" data-testid="key-specs">
                {tiles.map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-line bg-raised px-2.5 py-2 md:border-0 md:bg-surface md:px-[11px] md:py-[9px]">
                    <p className="text-[10.5px] text-muted">{label}</p>
                    <p className="mt-0.5 text-[12.5px] font-semibold text-ink">{value}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-3 border-t border-sunken pt-2.5">
              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2" data-testid="specs">
                {groups.map((group) => (
                  <div key={group.title}>
                    <h3 className="mb-1 text-[11px] font-semibold tracking-[0.05em] text-muted">{group.title}</h3>
                    {group.rows.map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4 border-b border-sunken py-[7px] text-[12.5px] last:border-b-0">
                        <span className="text-slate-strong">{label}</span>
                        <span className="text-right font-semibold text-ink">{value}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </section>
          {/* Right: condition + features, then description. */}
          <div className="min-w-0">
            {!limited && (hasConditions || listing.features.length > 0) ? (
              <section aria-labelledby="cond-title" className="rounded-none border-0 bg-transparent p-0 md:rounded-[10px] md:border md:border-line md:bg-raised md:px-[18px] md:py-4">
                <h2 id="cond-title" className="sr-only text-[14.5px] font-bold text-ink md:not-sr-only">Vəziyyət · Təchizat</h2>
                {hasConditions ? (
                  <div className="flex flex-wrap items-center gap-2 md:mt-2.5" data-testid="condition-claims">
                    {listing.noAccident === true ? (
                      <span className="inline-flex items-center gap-1 rounded-pill border border-primary px-[11px] py-[5px] text-[12px] font-semibold text-boost">
                        <Check size={12} strokeWidth={3} aria-hidden="true" /> {UI.noAccident}
                      </span>
                    ) : null}
                    {listing.notRepainted === true ? (
                      <span className="inline-flex items-center gap-1 rounded-pill border border-primary px-[11px] py-[5px] text-[12px] font-semibold text-boost">
                        <Check size={12} strokeWidth={3} aria-hidden="true" /> {UI.notRepainted}
                      </span>
                    ) : null}
                    <span className="self-center text-[10.5px] text-muted" data-testid="condition-disclaimer">satıcının bəyanı</span>
                  </div>
                ) : null}
                {listing.features.length > 0 ? (
                  <div className={hasConditions ? "mt-3" : "mt-2.5"}>
                    <FeaturesList features={listing.features} />
                  </div>
                ) : null}
              </section>
            ) : null}
            {!limited && listing.description ? (
              <section aria-labelledby="desc-title" className="mt-3 rounded-none border-0 bg-transparent p-0 md:mt-4 md:rounded-[10px] md:border md:border-line md:bg-raised md:px-[18px] md:py-4">
                <h2 id="desc-title" className="sr-only text-[14.5px] font-bold text-ink md:not-sr-only">{UI.description}</h2>
                <div className="md:mt-2.5">
                  <DescriptionClamp text={listing.description} />
                </div>
              </section>
            ) : null}
          </div>
        </div>
        {contactable && listing.seller ? (
          <section
            aria-label={UI.seller}
            className="mt-1 flex items-center justify-between gap-3 rounded-none border-0 bg-transparent px-0 py-3 md:mt-4 md:rounded-[10px] md:border md:border-line md:bg-raised md:px-[18px] md:py-3.5 desk:hidden"
            data-testid="seller-row"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-sunken text-sm font-semibold text-primary">
                {sellerInitial}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-ink">{listing.seller.displayName ?? UI.seller}</p>
                <p className="text-[11px] text-muted">
                  Elan № {listing.publicId}
                  {listing.city ? ` · ${listing.city}` : ""}
                </p>
              </div>
            </div>
            <a href="#report" className="shrink-0 text-[11.5px] font-medium text-[#B3261E] hover:underline">
              Şikayət et
            </a>
          </section>
        ) : null}
        {!limited ? (
          <Notice tone="info" className="mt-5">
            Təhlükəsizlik üçün: avtomobili şəxsən yoxlamadan ödəniş etməyin və rəsmi sənədləşmədən
            əvvəl beh göndərməyin.
          </Notice>
        ) : null}
        <div className="mt-5 pt-1" id="report">
          <ReportListing publicId={listing.publicId} />
        </div>
      </Container>
    </article>
  );
}
