import { describe, expect, it } from "vitest";
import { buildFeatureGroupsFromRows } from "@/services/moderation-content";

/** O.13 Stage A — moderation read-model grouping over the sealed O.11
    buckets: approved order, legacy null codes trail as Digər, empty
    selections stay empty. */

describe("buildFeatureGroupsFromRows", () => {
  it("groups selected features in the approved O.11 order with the Stage B item shape", () => {
    const groups = buildFeatureGroupsFromRows([
      { id: "f-comfort", name_az: "Oturacaqların ventilyasiyası", group_code: "COMFORT" },
      { id: "f-safety", name_az: "ESP", group_code: "SAFETY" },
    ]);
    expect(groups.map((g) => g.code)).toEqual(["SAFETY", "COMFORT"]);
    expect(groups.map((g) => g.label)).toEqual(["Təhlükəsizlik", "Komfort"]);
    expect(groups[0].features).toEqual([{ id: "f-safety", label: "ESP", selected: true }]);
  });

  it("legacy/unknown group codes land in a trailing Digər bucket", () => {
    const groups = buildFeatureGroupsFromRows([
      { id: "f-legacy", name_az: "Köhnə avadanlıq", group_code: null },
      { id: "f-unknown", name_az: "Naməlum qrup", group_code: "NOT_A_GROUP" },
      { id: "f-safety", name_az: "ABS", group_code: "SAFETY" },
    ]);
    expect(groups.map((g) => g.code)).toEqual(["SAFETY", "OTHER_FALLBACK"]);
    expect(groups[1].label).toBe("Digər");
    expect(groups[1].features.map((f) => f.label)).toEqual(["Köhnə avadanlıq", "Naməlum qrup"]);
  });

  it("an empty selection produces no groups", () => {
    expect(buildFeatureGroupsFromRows([])).toEqual([]);
  });
});
