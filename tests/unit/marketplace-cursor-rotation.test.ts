import { describe, expect, it } from "vitest";
import {
  decodeSearchCursor,
  encodeSearchCursor,
  rotateBoosts,
} from "@/services/marketplace";

const ID = "3f0e8f7a-58f4-4f5c-9d0e-0a9b8c7d6e5f";

describe("search cursors", () => {
  it("round-trips every sort with its value shape", () => {
    const ts = "2026-08-21 13:21:59.218105+04";
    expect(decodeSearchCursor(encodeSearchCursor("NEWEST", ts, ID), "NEWEST")).toEqual({ sort: "NEWEST", value: ts, id: ID });
    expect(decodeSearchCursor(encodeSearchCursor("PRICE_ASC", "1500000", ID), "PRICE_ASC").value).toBe("1500000");
    expect(decodeSearchCursor(encodeSearchCursor("YEAR_DESC", "2019", ID), "YEAR_DESC").value).toBe("2019");
  });

  it("rejects tampered, mismatched, or malformed cursors", () => {
    const good = encodeSearchCursor("NEWEST", "2026-08-21 13:21:59.218105+04", ID);
    expect(() => decodeSearchCursor(good, "PRICE_ASC")).toThrow(/cursor/i); // sort binding
    expect(() => decodeSearchCursor("not-base64!!", "NEWEST")).toThrow();
    expect(() => decodeSearchCursor(Buffer.from("v0|NEWEST|x|y").toString("base64url"), "NEWEST")).toThrow();
    expect(() => decodeSearchCursor(Buffer.from(`v1|NEWEST|1 or 1=1|${ID}`).toString("base64url"), "NEWEST")).toThrow();
    expect(() => decodeSearchCursor(Buffer.from(`v1|PRICE_ASC|abc|${ID}`).toString("base64url"), "PRICE_ASC")).toThrow();
    expect(() => decodeSearchCursor(Buffer.from("v1|NEWEST|2026-08-21 13:21:59+04|not-a-uuid").toString("base64url"), "NEWEST")).toThrow();
  });
});

describe("rotateBoosts", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({ id: `id-${i}` }));

  it("is deterministic for the same signature within an hour", () => {
    const now = new Date("2026-08-21T10:15:00Z");
    const a = rotateBoosts(candidates, "CAR?brand=x", 4, now);
    const b = rotateBoosts(candidates, "CAR?brand=x", 4, new Date("2026-08-21T10:45:00Z"));
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.length).toBe(4);
  });

  it("rotates across hour buckets and signatures without favoring one listing forever", () => {
    const winners = new Set<string>();
    for (let h = 0; h < 48; h += 1) {
      const now = new Date(Date.UTC(2026, 7, 21, h % 24, 0, 0) + Math.floor(h / 24) * 86_400_000);
      rotateBoosts(candidates, "CAR?brand=x", 2, now).forEach((c) => winners.add(c.id));
    }
    expect(winners.size).toBeGreaterThan(5); // many different listings get exposure over time
    const s1 = rotateBoosts(candidates, "CAR?brand=x", 4, new Date("2026-08-21T10:00:00Z")).map((c) => c.id);
    const s2 = rotateBoosts(candidates, "MOTORCYCLE?", 4, new Date("2026-08-21T10:00:00Z")).map((c) => c.id);
    expect(s1).not.toEqual(s2);
  });

  it("returns all candidates when fewer than the slots", () => {
    expect(rotateBoosts(candidates.slice(0, 2), "x", 4).length).toBe(2);
  });
});
