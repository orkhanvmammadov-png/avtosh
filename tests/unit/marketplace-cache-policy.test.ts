import { describe, expect, it } from "vitest";
import { publicCacheControl } from "@/services/marketplace";

const now = new Date("2026-08-21T10:00:00Z");

describe("publicCacheControl", () => {
  it("uses the configured ceilings when no deadline is near", () => {
    expect(publicCacheControl(null, now)).toBe("public, max-age=30, s-maxage=60");
    expect(publicCacheControl(new Date(now.getTime() + 3_600_000), now)).toBe("public, max-age=30, s-maxage=60");
  });

  it("never exceeds the seconds until the earliest deadline", () => {
    expect(publicCacheControl(new Date(now.getTime() + 8_000), now)).toBe("public, max-age=8, s-maxage=8");
    expect(publicCacheControl(new Date(now.getTime() + 45_000), now)).toBe("public, max-age=30, s-maxage=45");
  });

  it("returns no-store for imminent or passed deadlines and never adds stale-while-revalidate", () => {
    expect(publicCacheControl(new Date(now.getTime() + 900), now)).toBe("no-store");
    expect(publicCacheControl(new Date(now.getTime() - 1), now)).toBe("no-store");
    expect(publicCacheControl(new Date(now.getTime() + 8_000), now)).not.toContain("stale");
  });
});
