import { expect, test } from "@playwright/test";

/**
 * O.11 Stage A — the seeded E2E environment exposes the authoritative
 * equipment catalog through the real public API (data/schema only; the
 * grouped seller/detail UX arrives in Stages B/C).
 */

test("CAR features API returns the full 58-item O.11 catalog in deterministic order", async ({ request }, { project }) => {
  test.skip(project.name !== "desktop", "pure API check; one project");
  const res = await request.get("/api/v1/catalog/features?category=CAR");
  expect(res.ok()).toBe(true);
  const items = (await res.json()).data as { id: string; code: string; name: string; group: string | null }[];
  expect(items).toHaveLength(58);
  // O.11 Stage B additive DTO field: stable group code on every item
  expect(items[0].group).toBe("SAFETY");
  expect(new Set(items.map((i) => i.group)).size).toBe(7);
  expect(new Set(items.map((i) => i.code)).size).toBe(58);
  // deterministic order: SAFETY first (ABS leads), LIGHTING_EXTERIOR last
  expect(items[0].code).toBe("ABS");
  expect(items[0].name).toBe("ABS");
  expect(items[items.length - 1].code).toBe("ALLOY_WHEELS");
  expect(items.map((i) => i.code)).toContain("APPLE_CARPLAY");
  // every id is a UUID — sellers keep persisting UUIDs, not codes
  for (const item of items) {
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
  }
});

test("MOTORCYCLE features API returns only the global ABS", async ({ request }, { project }) => {
  test.skip(project.name !== "desktop", "pure API check; one project");
  const res = await request.get("/api/v1/catalog/features?category=MOTORCYCLE");
  expect(res.ok()).toBe(true);
  const items = (await res.json()).data as { code: string }[];
  expect(items.map((i) => i.code)).toEqual(["ABS"]);
});
