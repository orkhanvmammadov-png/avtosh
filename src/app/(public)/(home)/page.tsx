import type { Metadata } from "next";
import Link from "next/link";
import { HomeSearch } from "@/components/marketplace/home-search";
import { PremiumFeed } from "@/components/marketplace/premium-feed";
import { UI } from "@/lib/marketplace/labels";
import { getBrands } from "@/services/catalog";
import { homeData } from "@/services/marketplace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AVTOSH.AZ — avtomobil və motosiklet elanları",
  alternates: { canonical: "/" },
};

const CATEGORY_TILES = [
  {
    code: "CAR",
    label: UI.cars,
    hint: "Sedan, SUV, hetçbek və daha çox",
    icon: (
      <path d="M4 15l1.8-5a2.4 2.4 0 0 1 2.3-1.6h7.8a2.4 2.4 0 0 1 2.3 1.6L20 15v5h-1.8a2 2 0 0 1-4 0h-4.4a2 2 0 0 1-4 0H4v-5zM7 15h.01M17 15h.01" />
    ),
  },
  {
    code: "MOTORCYCLE",
    label: UI.motorcycles,
    hint: "Şəhər, sport və turing motosikletlər",
    icon: (
      <path d="M5.5 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm13 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM5.5 15h4l3-6h3l3 6M12 9l-1.5-3H8" />
    ),
  },
];

const TRUST_POINTS = [
  {
    title: "Yoxlanılmış elanlar",
    hint: "Hər elan dərc olunmazdan əvvəl moderasiyadan keçir.",
    icon: <path d="M12 3l7 3v5c0 4.5-3 8.6-7 10-4-1.4-7-5.5-7-10V6l7-3zM9 12l2 2 4-4" />,
  },
  {
    title: "Birbaşa əlaqə",
    hint: "Satıcının nömrəsini bir kliklə görün, vasitəçisiz danışın.",
    icon: <path d="M6 4h4l2 5-2.5 1.5a11 11 0 0 0 4 4L15 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 2-2z" />,
  },
  {
    title: "Təhlükəsiz ödəniş",
    hint: "Elan və təşviq ödənişləri Kapital Bank üzərindən onlayn aparılır.",
    icon: <path d="M3 8h18M3 8v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8M3 8l2-3h14l2 3M7 14h4" />,
  },
];

export default async function HomePage() {
  const { home } = await homeData();
  const defaultCategory = home.categories[0]?.code ?? "CAR";
  const initialBrands = await getBrands(defaultCategory).catch(() => []);
  return (
    <>
      <section aria-labelledby="hero-title" className="pt-6">
        <div className="rounded-card bg-navy px-5 py-8 text-white shadow-raised md:px-10 md:py-12">
          <div className="max-w-2xl">
            <h1 id="hero-title" className="text-3xl font-extrabold tracking-tight md:text-4xl">
              Avtomobil və motosiklet elanları
            </h1>
            <p className="mt-3 text-sm text-white/70 md:text-base" data-testid="new-count">
              Son 24 saatda <strong className="font-bold text-premium">{home.newListingsLast24h}</strong>{" "}
              yeni elan yerləşdirilib
            </p>
          </div>
          <div className="mt-6 md:mt-8">
            <HomeSearch categories={home.categories} initialBrands={initialBrands} />
          </div>
        </div>
      </section>

      <section aria-label="Kateqoriyalar" className="mt-6 grid gap-4 sm:grid-cols-2">
        {CATEGORY_TILES.map((tile) => (
          <Link
            key={tile.code}
            href={`/elanlar?category=${tile.code}`}
            className="group flex items-center gap-4 rounded-card border border-line bg-raised p-5 shadow-card transition-shadow hover:shadow-raised"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-info-soft text-primary">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {tile.icon}
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-navy group-hover:text-primary">{tile.label}</span>
              <span className="mt-0.5 block text-sm text-muted">{tile.hint}</span>
            </span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto shrink-0 text-faint transition-colors group-hover:text-primary" aria-hidden="true">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        ))}
      </section>

      {home.premium.items.length > 0 ? (
        <section aria-labelledby="premium-title" className="mt-10" data-testid="premium-section">
          <div className="mb-4 flex items-center gap-3">
            <span aria-hidden="true" className="h-6 w-1.5 rounded-full bg-premium" />
            <h2 id="premium-title" className="text-2xl font-bold tracking-tight text-navy">{UI.premium}</h2>
          </div>
          <PremiumFeed
            initialItems={home.premium.items}
            initialCursor={home.premium.nextCursor}
            initialHasMore={home.premium.hasMore}
            renderedAtMs={home.generatedAtMs}
          />
        </section>
      ) : null}

      <section aria-label="Niyə AVTOSH" className="mt-12 grid gap-4 md:grid-cols-3">
        {TRUST_POINTS.map((point) => (
          <div key={point.title} className="rounded-card border border-line bg-raised p-5 shadow-card">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sunken text-slate-strong">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {point.icon}
              </svg>
            </span>
            <h3 className="mt-3 text-base font-semibold text-navy">{point.title}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">{point.hint}</p>
          </div>
        ))}
      </section>
    </>
  );
}
