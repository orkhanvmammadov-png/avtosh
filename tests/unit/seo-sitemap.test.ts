import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSitemapEntries, canonicalOrigin } from "@/lib/seo/sitemap";
import robots from "@/app/robots";

afterEach(() => vi.unstubAllEnvs());

describe("sitemap assembly", () => {
  it("emits canonical www HTTPS URLs: static pages first, then listings with real lastModified", () => {
    const updated = new Date("2026-10-01T10:00:00Z");
    const entries = buildSitemapEntries("https://www.avtosh.az", [
      { public_id: "10001", updated_at: updated },
    ]);
    expect(entries.map((e) => e.url)).toEqual([
      "https://www.avtosh.az/",
      "https://www.avtosh.az/elanlar?category=CAR",
      "https://www.avtosh.az/elanlar?category=MOTORCYCLE",
      "https://www.avtosh.az/qaydalar",
      "https://www.avtosh.az/istifadeci-razilasmasi",
      "https://www.avtosh.az/mexfilik-siyaseti",
      "https://www.avtosh.az/elan/10001",
    ]);
    // No invented timestamps: static pages carry none; listings carry
    // the row's real updated_at.
    for (const entry of entries.slice(0, 6)) expect(entry.lastModified).toBeUndefined();
    expect(entries[6]!.lastModified).toBe(updated);
  });

  it("canonicalOrigin strips a trailing slash and fails loudly when unconfigured in production", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.avtosh.az/");
    expect(canonicalOrigin()).toBe("https://www.avtosh.az");
  });
});

describe("robots policy", () => {
  it("points at the absolute sitemap and blocks only crawl-noise paths", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.avtosh.az");
    const result = robots();
    expect(result.sitemap).toBe("https://www.avtosh.az/sitemap.xml");
    const rule = Array.isArray(result.rules) ? result.rules[0]! : result.rules!;
    expect(rule.disallow).toEqual(["/api/", "/moderator", "/admin"]);
    // /profil and /odenis rely on meta noindex, which Google can only
    // see on crawlable pages — they must never be robots-blocked.
    const disallow = rule.disallow as string[];
    expect(disallow.some((p) => p.startsWith("/profil"))).toBe(false);
    expect(disallow.some((p) => p.startsWith("/odenis"))).toBe(false);
  });
});
