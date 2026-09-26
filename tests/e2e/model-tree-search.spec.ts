import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";
import { loginAs, testPhone } from "./auth-helpers";

// O.15 hierarchical Model control: multi-select OR semantics on
// search (family = whole family incl. legacy NULL-variant rows;
// variants = exactly those), URL round-trip with back/forward, and
// the single-choice family→variant flow in the seller quick-start.

async function openTree(page: Page): Promise<void> {
  await page.getByTestId("home-model-toggle").click();
  await expect(page.getByTestId("home-model-panel")).toBeVisible();
}

test("family selection matches every listing of the family, including legacy NULL variants", async ({ page }) => {
  const s = seed();
  await page.goto(`/elanlar?category=CAR&brand_id=${s.toyotaBrandId}`);
  await openTree(page);
  await page.getByTestId("home-model-family-tree-family").check();
  await page.keyboard.press("Escape");
  await page.getByTestId("home-search-submit").click();
  await page.waitForURL(/model_ids=/);
  const url = new URL(page.url());
  expect(url.searchParams.get("model_ids")).toBe(s.treeFamilyModelId);
  expect(url.searchParams.get("model_variant_ids")).toBeNull();
  const cards = page.getByTestId("organic-card");
  await expect(cards).toHaveCount(3); // tree-100 + tree-200 + legacy NULL
});

test("variant selections match exactly those variants; OR across selections; chips show paths", async ({ page }) => {
  const s = seed();
  await page.goto(`/elanlar?category=CAR&brand_id=${s.toyotaBrandId}`);
  await openTree(page);
  await page.getByTestId("home-model-expand-tree-family").click();
  await page.getByTestId("home-model-variant-tree-100").check();
  await page.getByTestId("home-model-variant-tree-200").check();
  await page.keyboard.press("Escape");
  await page.getByTestId("home-search-submit").click();
  await page.waitForURL(/model_variant_ids=/);
  const url = new URL(page.url());
  expect(url.searchParams.get("model_variant_ids")?.split(",").sort()).toEqual(
    [s.tree100VariantId, s.tree200VariantId].sort(),
  );
  await expect(page.getByTestId("organic-card")).toHaveCount(2); // NULL-variant row excluded
  // Path chips, no separate Alt model chip group.
  await expect(page.getByTestId("applied-filters")).toContainText("Tree Family › Tree 100");
  await expect(page.getByTestId("applied-filters")).toContainText("Tree Family › Tree 200");
  // Removing one variant chip keeps the other.
  await page.getByTestId("applied-filter").filter({ hasText: "Tree Family › Tree 100" }).click();
  await page.waitForURL((u) => !u.search.includes(s.tree100VariantId));
  await expect(page.getByTestId("organic-card")).toHaveCount(1);

  // Browser Back restores the two-variant state (URL-as-state).
  await page.goBack();
  await page.waitForURL((u) => u.search.includes(s.tree100VariantId));
  await expect(page.getByTestId("organic-card")).toHaveCount(2);
  await expect(page.getByTestId("home-model-toggle")).toContainText("Tree Family › Tree 100");
  await expectNoHorizontalOverflow(page);
});

test("checking the family absorbs its child selections (normalization) and brand change clears all", async ({ page }) => {
  const s = seed();
  await page.goto(`/elanlar?category=CAR&brand_id=${s.toyotaBrandId}`);
  await openTree(page);
  await page.getByTestId("home-model-expand-tree-family").click();
  await page.getByTestId("home-model-variant-tree-100").check();
  await page.getByTestId("home-model-family-tree-family").check();
  // children render checked+disabled under a checked family
  await expect(page.getByTestId("home-model-variant-tree-100")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByTestId("home-search-submit").click();
  await page.waitForURL(/model_ids=/);
  const url = new URL(page.url());
  expect(url.searchParams.get("model_ids")).toBe(s.treeFamilyModelId);
  expect(url.searchParams.get("model_variant_ids")).toBeNull();

  // brand change clears every model selection
  await page.getByTestId("home-brand").selectOption("");
  await expect(page.getByTestId("home-model-toggle")).not.toContainText("Tree Family");
});

test("legacy singular model_id / model_variant_id URLs keep working", async ({ page }) => {
  const s = seed();
  await page.goto(
    `/elanlar?category=CAR&brand_id=${s.toyotaBrandId}&model_id=${s.treeFamilyModelId}&model_variant_id=${s.tree100VariantId}`,
  );
  await expect(page.getByTestId("organic-card")).toHaveCount(1); // pair = that variant only
  await expect(page.getByTestId("home-model-toggle")).toContainText("Tree Family › Tree 100");
});

test("quick-start: family with variants requires choosing ONE child; path displays", async ({ page, context }, testInfo) => {
  await loginAs(context, testPhone(testInfo.project.name, 301));
  await page.goto("/elan-yerlesdir");
  await page.getByTestId("quick-start-brand").click();
  await page.keyboard.type("Toyota");
  await page.getByTestId("quick-start-brand-option").first().click();
  await page.getByTestId("quick-start-model").click();
  await page.keyboard.type("Tree");
  // family with variants: first click expands to level 2, no selection yet
  await page.getByTestId("quick-start-model-option").first().click();
  await expect(page.getByTestId("quick-start-model-back")).toBeVisible();
  await expect(page.getByTestId("quick-start-model-option")).toHaveCount(2);
  await page.getByTestId("quick-start-model-option").first().click();
  await expect(page.getByTestId("quick-start-model")).toHaveValue("Tree Family → Tree 100");
});

test("a failed child load never reads as a confirmed empty family (tree) and is retryable", async ({ page }) => {
  const s = seed();
  await page.route("**/api/v1/catalog/model-variants*", (route) => route.abort());
  await page.goto(`/elanlar?category=CAR&brand_id=${s.toyotaBrandId}`);
  await openTree(page);
  await page.getByTestId("home-model-expand-tree-family").click();
  // error state, NOT "Alt model yoxdur", and no children rendered
  await expect(page.getByTestId("home-model-retry-tree-family")).toBeVisible();
  await expect(page.getByTestId("home-model-panel")).not.toContainText("Alt model yoxdur");
  await expect(page.getByTestId("home-model-variant-tree-100")).toHaveCount(0);
  // retry after the network recovers loads the real children
  await page.unroute("**/api/v1/catalog/model-variants*");
  await page.getByTestId("home-model-retry-tree-family").click();
  await expect(page.getByTestId("home-model-variant-tree-100")).toBeVisible();
});

test("a failed load never commits a zero-variant selection (wizard) and is retryable", async ({ page, context }, testInfo) => {
  await loginAs(context, testPhone(testInfo.project.name, 302));
  await page.route("**/api/v1/catalog/model-variants*", (route) => route.abort());
  await page.goto("/elan-yerlesdir");
  await page.getByTestId("quick-start-brand").click();
  await page.keyboard.type("Toyota");
  await page.getByTestId("quick-start-brand-option").first().click();
  await page.getByTestId("quick-start-model").click();
  await page.keyboard.type("Tree");
  await page.getByTestId("quick-start-model-option").first().click();
  // failure: no selection committed, clear error, still on the family level
  await expect(page.getByTestId("quick-start-model-load-error")).toBeVisible();
  await expect(page.getByTestId("quick-start-model-back")).toHaveCount(0);
  await expect(page.getByTestId("quick-start-model")).toHaveValue("Tree");
  // retry after recovery expands the family for a real choice
  await page.unroute("**/api/v1/catalog/model-variants*");
  await page.getByTestId("quick-start-model-option").first().click();
  await expect(page.getByTestId("quick-start-model-back")).toBeVisible();
  await page.getByTestId("quick-start-model-option").first().click();
  await expect(page.getByTestId("quick-start-model")).toHaveValue("Tree Family → Tree 100");
});
