import { expect, test } from "@playwright/test";
import { loginAs, testPhone } from "./auth-helpers";
import { expectNoHorizontalOverflow } from "./helpers";
import { insertListingFixture, insertTestFeature, setListingFeaturesByCode } from "./seller-helpers";

/**
 * O.11 Stage C — public Listing Detail grouped equipment (detail.md):
 * selected-only, approved group order, sort_order items, empty groups
 * hidden, Digər fallback last, ONE overall expand for >12 items.
 */

const SAFETY_8 = ["ABS", "ESC", "TRACTION_CONTROL", "FRONT_AIRBAGS", "SIDE_AIRBAGS", "CURTAIN_AIRBAGS", "ISOFIX", "TPMS"];
const DA_10 = [
  "CRUISE_CONTROL",
  "ADAPTIVE_CRUISE_CONTROL",
  "BLIND_SPOT_MONITOR",
  "LANE_DEPARTURE_WARNING",
  "LANE_KEEP_ASSIST",
  "AUTONOMOUS_EMERGENCY_BRAKING",
  "FORWARD_COLLISION_WARNING",
  "TRAFFIC_SIGN_RECOGNITION",
  "HILL_START_ASSIST",
  "AUTO_HOLD",
];
const PC_5 = ["REAR_CAMERA", "SURROUND_VIEW_CAMERA", "FRONT_PARKING_SENSORS", "REAR_PARKING_SENSORS", "AUTOMATIC_PARKING"];

test("grouping core: zero-state, single ABS, approved group/item order, no unselected leakage", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "single-source matrix; one project");
  test.setTimeout(240_000);
  const { userId } = await loginAs(context, testPhone("desktop", 70));
  const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });

  // zero equipment → no Təchizat rendering at all (no placeholder)
  await page.goto(`/elan/${fixture.publicId}`);
  await expect(page.getByTestId("detail-price")).toBeVisible();
  await expect(page.getByTestId("features")).toHaveCount(0);

  // exactly ABS → single Təhlükəsizlik group, one row, NO expand control
  await setListingFeaturesByCode(fixture.id, ["ABS"]);
  await page.reload();
  await expect(page.getByTestId("features")).toBeVisible();
  await expect(page.getByTestId("features-group-SAFETY")).toContainText("Təhlükəsizlik");
  await expect(page.getByTestId("features-group-SAFETY")).toContainText("ABS");
  await expect(page.getByTestId("features").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("features-toggle")).toHaveCount(0);
  await expect(page.getByText("ABS", { exact: true })).toHaveCount(1); // never duplicated

  // 8 items across all seven groups (≤12: all visible, no control),
  // approved group order + sort_order inside SAFETY
  await setListingFeaturesByCode(fixture.id, [
    "ESC",
    "ABS", // insertion order scrambled on purpose — display order is canonical
    "CRUISE_CONTROL",
    "REAR_CAMERA",
    "KEYLESS_ENTRY",
    "CLIMATE_CONTROL",
    "BLUETOOTH",
    "LED_HEADLIGHTS",
  ]);
  await page.reload();
  await expect(page.getByTestId("features").locator("li")).toHaveCount(8);
  await expect(page.getByTestId("features-toggle")).toHaveCount(0);
  const groupIds = await page
    .getByTestId("features")
    .locator("[data-testid^='features-group-']")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  expect(groupIds).toEqual([
    "features-group-SAFETY",
    "features-group-DRIVER_ASSISTANCE",
    "features-group-PARKING_CAMERA",
    "features-group-COMFORT",
    "features-group-CLIMATE_INTERIOR",
    "features-group-MULTIMEDIA",
    "features-group-LIGHTING_EXTERIOR",
  ]);
  // catalog sort_order inside the group: ABS (101) before ESC (102)
  const safetyRows = await page.getByTestId("features-group-SAFETY").locator("li").allTextContents();
  expect(safetyRows.map((t) => t.trim())).toEqual(["ABS", "Elektron stabillik sistemi (ESP/ESC)"]);
  // unselected catalog features never render
  await expect(page.getByText("Lyuk", { exact: true })).toHaveCount(0);
});

test("large selection: one overall expand, first-12 collapsed projection, Digər last, inactive historical kept", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "single-source matrix; one project");
  test.setTimeout(240_000);
  const { userId } = await loginAs(context, testPhone("desktop", 71));
  const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });

  // 23 items across three groups (8 + 10 + 5)
  await setListingFeaturesByCode(fixture.id, [...SAFETY_8, ...DA_10, ...PC_5]);
  await page.goto(`/elan/${fixture.publicId}`);
  // collapsed: exactly the first 12 of the canonical order, only the
  // groups represented within them (8 SAFETY + 4 DA; PARKING hidden)
  await expect(page.getByTestId("features").locator("li")).toHaveCount(12);
  await expect(page.getByTestId("features-group-SAFETY").locator("li")).toHaveCount(8);
  await expect(page.getByTestId("features-group-DRIVER_ASSISTANCE").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("features-group-PARKING_CAMERA")).toHaveCount(0);
  const toggle = page.getByTestId("features-toggle");
  await expect(toggle).toHaveText("Bütün təchizatı göstər (23) ▾"); // real total
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // expand → all 23 across all three groups; control becomes Gizlət
  await toggle.click();
  await expect(page.getByTestId("features").locator("li")).toHaveCount(23);
  await expect(page.getByTestId("features-group-PARKING_CAMERA").locator("li")).toHaveCount(5);
  await expect(toggle).toHaveText("Gizlət ▴");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // collapse again → compact 12
  await toggle.click();
  await expect(page.getByTestId("features").locator("li")).toHaveCount(12);

  // legacy NULL group + unknown group + deactivated catalog rows.
  // All three are INACTIVE — historically-selected equipment displays
  // regardless of is_active (the contract under test), and inactive
  // rows can never leak into the seller catalog of later tests.
  await insertTestFeature("O11T_LEGACY", "Legacy avadanlıq", { group: null, active: false });
  await insertTestFeature("O11T_ODD", "Naməlum qruplu avadanlıq", { group: "SOME_FUTURE_GROUP", active: false });
  await insertTestFeature("O11T_GONE", "Deaktiv edilmiş avadanlıq", { group: "COMFORT", active: false });
  await setListingFeaturesByCode(fixture.id, [...SAFETY_8, ...DA_10, ...PC_5, "O11T_LEGACY", "O11T_ODD", "O11T_GONE"]);
  await page.reload();
  await expect(page.getByTestId("features-toggle")).toHaveText("Bütün təchizatı göstər (26) ▾");
  await page.getByTestId("features-toggle").click();
  await expect(page.getByTestId("features").locator("li")).toHaveCount(26);
  // deactivated historical selection still displays (COMFORT group)
  await expect(page.getByTestId("features-group-COMFORT")).toContainText("Deaktiv edilmiş avadanlıq");
  // one Digər bucket, rendered LAST, holding null + unknown groups
  const groupIds = await page
    .getByTestId("features")
    .locator("[data-testid^='features-group-']")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  expect(groupIds[groupIds.length - 1]).toBe("features-group-OTHER_FALLBACK");
  expect(groupIds.filter((g) => g === "features-group-OTHER_FALLBACK")).toHaveLength(1);
  const digher = page.getByTestId("features-group-OTHER_FALLBACK");
  await expect(digher).toContainText("Digər");
  await expect(digher).toContainText("Legacy avadanlıq");
  await expect(digher).toContainText("Naməlum qruplu avadanlıq");
});

test("390: grouped equipment collapsed and expanded stay overflow-free with a comfortable control", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "explicit viewport; one project");
  test.setTimeout(240_000);
  const { userId } = await loginAs(context, testPhone("desktop", 72));
  const fixture = await insertListingFixture(userId, { status: "ACTIVE", complete: true, images: 3 });
  await setListingFeaturesByCode(fixture.id, [...SAFETY_8, ...DA_10, ...PC_5]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/elan/${fixture.publicId}`);
  await page.getByTestId("features").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("features").locator("li")).toHaveCount(12);
  await expectNoHorizontalOverflow(page);
  const box = (await page.getByTestId("features-toggle").boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(34);
  await page.getByTestId("features-toggle").click();
  await expect(page.getByTestId("features").locator("li")).toHaveCount(23);
  await expectNoHorizontalOverflow(page);

  // 360 narrow-mobile safety: expanded long-label state stays usable
  await page.setViewportSize({ width: 360, height: 780 });
  await page.getByTestId("features").scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  const toggle360 = (await page.getByTestId("features-toggle").boundingBox())!;
  expect(toggle360.x + toggle360.width).toBeLessThanOrEqual(360.5);
  await page.getByTestId("features-toggle").click(); // collapse
  await expect(page.getByTestId("features").locator("li")).toHaveCount(12);
  await expectNoHorizontalOverflow(page);
});
