import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Container } from "@/components/ui/container";
import { HomeSearch } from "@/components/marketplace/home-search";
import { ListingCard } from "@/components/shared/listing-card";
import { PremiumFeed } from "@/components/marketplace/premium-feed";
import { PromotionBadge } from "@/components/ui/promotion-badge";
import { UI } from "@/lib/marketplace/labels";
import { getBrands } from "@/services/catalog";
import { homeData, searchMarketplace } from "@/services/marketplace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AVTOSH.AZ — avtomobil və motosiklet elanları",
  alternates: { canonical: "/" },
};

/** Approved trust row (contracts.md canonical copy — real product facts). */
const TRUST = [
  { title: "Hər elan yoxlanılır", hint: "Dərc olunmazdan əvvəl moderasiyadan keçir." },
  { title: "WhatsApp ilə giriş", hint: "Şifrəsiz, birdəfəlik kod ilə daxil olun." },
  { title: "İlk 3 elan pulsuz", hint: "Sonrakı elanlar üçün sabit dərc haqqı." },
];

export default async function HomePage() {
  const { home } = await homeData();
  const defaultCategory = home.categories[0]?.code ?? "CAR";
  const [initialBrands, fresh] = await Promise.all([
    getBrands(defaultCategory).catch(() => []),
    // "Yeni elanlar" — the accepted public search read model, newest
    // first (server-side service reuse; no new API).
    searchMarketplace({ category: "CAR", sort: "NEWEST", limit: 8 }).catch(() => null),
  ]);
  return (
    <>
      {/* Full-bleed navy stage; the search panel overlaps it by ~56px. */}
      <section aria-labelledby="hero-title" className="bg-navy pb-14 pt-8 text-white md:pt-12">
        <Container>
          <div className="max-w-2xl">
            <h1 id="hero-title" className="text-3xl font-extrabold leading-[1.05] tracking-[-0.015em] md:text-[44px]">
              Avtomobil və motosiklet elanları
            </h1>
            <p className="mt-3 text-sm text-on-navy-muted md:text-base" data-testid="new-count">
              Son 24 saatda <strong className="font-bold text-green-dark">{home.newListingsLast24h}</strong>{" "}
              yeni elan yerləşdirilib
            </p>
          </div>
        </Container>
      </section>
      <Container className="-mt-14">
        <HomeSearch categories={home.categories} initialBrands={initialBrands} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/elanlar?category=CAR" className="inline-flex min-h-9 items-center gap-1 font-medium text-primary hover:text-primary-hover">
              {"Ətraflı axtarış"}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <Link href="/elanlar?category=CAR&sort=PRICE_ASC" className="inline-flex min-h-9 items-center rounded-pill bg-raised px-3 text-xs font-medium text-slate-strong hover:text-primary">
              Sərfəli avtomobillər
            </Link>
            <Link href="/elanlar?category=MOTORCYCLE" className="inline-flex min-h-9 items-center rounded-pill bg-raised px-3 text-xs font-medium text-slate-strong hover:text-primary">
              Motosikletlər
            </Link>
          </div>
          <p className="hidden items-center gap-1.5 text-xs text-slate-strong md:flex">
            <Check size={14} className="text-primary" aria-hidden="true" />
            Hər elan yoxlanılır
          </p>
        </div>

        {home.premium.items.length > 0 ? (
          <section aria-labelledby="premium-title" className="mt-8 md:mt-12" data-testid="premium-section">
            <div className="mb-4 flex items-center gap-2.5">
              <h2 id="premium-title" className="text-lg font-bold tracking-[-0.01em] text-ink md:text-2xl">
                Premium elanlar
              </h2>
              <PromotionBadge type="PREMIUM" />
            </div>
            <PremiumFeed
              initialItems={home.premium.items}
              initialCursor={home.premium.nextCursor}
              initialHasMore={home.premium.hasMore}
              renderedAtMs={home.generatedAtMs}
            />
          </section>
        ) : null}

        {fresh !== null && fresh.items.length > 0 ? (
          <section aria-labelledby="fresh-title" className="mt-8 md:mt-12">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 id="fresh-title" className="text-lg font-bold tracking-[-0.01em] text-ink md:text-2xl">
                Yeni elanlar
              </h2>
              <Link href="/elanlar?category=CAR" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover">
                Hamısına bax
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {fresh.items.slice(0, 8).map((item) => (
                <li key={item.publicId}>
                  <ListingCard listing={item} nowMs={fresh.generatedAtMs} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-label="Niyə AVTOSH" className="mt-10 grid gap-6 border-t border-line pt-8 md:mt-14 md:grid-cols-3">
          {TRUST.map((point) => (
            <div key={point.title} className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
                <Check size={16} strokeWidth={2.5} aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-bold text-ink">{point.title}</h3>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-strong">{point.hint}</p>
              </div>
            </div>
          ))}
        </section>
      </Container>
    </>
  );
}
