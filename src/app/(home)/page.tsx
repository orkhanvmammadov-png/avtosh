import type { Metadata } from "next";
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

export default async function HomePage() {
  const { home } = await homeData();
  const defaultCategory = home.categories[0]?.code ?? "CAR";
  const initialBrands = await getBrands(defaultCategory).catch(() => []);
  return (
    <>
      <section aria-labelledby="hero-title" className="py-8 md:py-12">
        <h1 id="hero-title" className="text-3xl font-extrabold tracking-tight text-navy md:text-4xl">
          Avtomobil və motosiklet elanları
        </h1>
        <p className="mt-2 text-muted" data-testid="new-count">
          Son 24 saatda <strong className="text-navy">{home.newListingsLast24h}</strong> yeni elan yerləşdirilib
        </p>
        <div className="mt-6">
          <HomeSearch categories={home.categories} initialBrands={initialBrands} />
        </div>
      </section>
      {home.premium.items.length > 0 ? (
        <section aria-labelledby="premium-title" className="py-6" data-testid="premium-section">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 id="premium-title" className="text-2xl font-bold text-navy">{UI.premium}</h2>
          </div>
          <PremiumFeed
            initialItems={home.premium.items}
            initialCursor={home.premium.nextCursor}
            initialHasMore={home.premium.hasMore}
          />
        </section>
      ) : null}
    </>
  );
}
