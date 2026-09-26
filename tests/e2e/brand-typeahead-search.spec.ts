import { expect, test } from "@playwright/test";
import { pickBrand, seed } from "./helpers";

// Owner UAT: the search Brand control is the SAME searchable
// typeahead interaction as listing creation — category-scoped
// /api/v1/catalog/brands data, filter-as-you-type, keyboard
// selection, an accessible clear ("any brand"), dependent model
// clearing, URL restoration and no stale options on rapid changes.

test("searchable category-scoped brand list on both categories", async ({ page }) => {
  await page.goto("/elanlar?category=CAR");
  // focusing the empty field shows the full CAR list
  await page.getByTestId("home-brand").click();
  const listbox = page.getByTestId("home-brand-listbox");
  await expect(listbox.getByRole("option", { name: "Toyota", exact: true })).toBeVisible();
  await expect(listbox.getByRole("option", { name: "BMW", exact: true })).toBeVisible();
  await expect(listbox.getByRole("option", { name: "Yamaha", exact: true })).toHaveCount(0);
  // typing filters it
  await page.getByTestId("home-brand").fill("toy");
  await expect(listbox.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // MOTORCYCLE reloads the correct brands and clears selections
  await page.getByTestId("category-MOTORCYCLE").click();
  await page.getByTestId("home-brand").click();
  await expect(listbox.getByRole("option", { name: "Yamaha", exact: true })).toBeVisible();
  await expect(listbox.getByRole("option", { name: "BMW", exact: true })).toBeVisible();
  await expect(listbox.getByRole("option", { name: "Toyota", exact: true })).toHaveCount(0);
});

test("keyboard-only selection loads that brand's models", async ({ page }) => {
  await page.goto("/elanlar?category=CAR");
  await page.getByTestId("home-brand").click();
  await page.getByTestId("home-brand").fill("Toyo");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("home-brand")).toHaveValue("Toyota");
  await page.getByTestId("home-model-toggle").click();
  await expect(page.getByTestId("home-model-family-corolla")).toBeVisible();
});

test("clearing the brand supports 'any brand' and clears every model selection", async ({ page }) => {
  const s = seed();
  await page.goto("/elanlar?category=CAR");
  await pickBrand(page, "Toyota");
  await page.getByTestId("home-model-toggle").click();
  await page.getByTestId("home-model-family-tree-family").check();
  await page.keyboard.press("Escape");
  await page.getByTestId("home-brand-clear").click();
  await expect(page.getByTestId("home-brand")).toHaveValue("");
  await expect(page.getByTestId("home-model-toggle")).toBeDisabled();
  await page.getByTestId("home-search-submit").click();
  await page.waitForURL(/\/elanlar\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get("brand_id")).toBeNull();
  expect(url.searchParams.get("model_ids")).toBeNull();
  expect(s.treeFamilyModelId.length).toBeGreaterThan(0);
});

test("a typed-but-unselected brand is never submitted silently", async ({ page }) => {
  await page.goto("/elanlar?category=CAR");
  await pickBrand(page, "Toyota");
  await page.getByTestId("home-model-toggle").click();
  await page.getByTestId("home-model-family-corolla").check();
  await page.keyboard.press("Escape");
  // start typing a different brand without selecting it
  await page.getByTestId("home-brand").click();
  await page.getByTestId("home-brand").fill("BMW");
  await page.getByTestId("home-search-submit").click();
  await page.waitForURL(/\/elanlar\?/);
  const url = new URL(page.url());
  // the stale Toyota selection was NOT submitted, nor its models
  expect(url.searchParams.get("brand_id")).toBeNull();
  expect(url.searchParams.get("model_ids")).toBeNull();
});

test("URL restoration and Back/Forward keep the selected brand", async ({ page }) => {
  const s = seed();
  await page.goto(`/elanlar?category=CAR&brand_id=${s.toyotaBrandId}`);
  await expect(page.getByTestId("home-brand")).toHaveValue("Toyota");
  await pickBrand(page, "BMW");
  await page.getByTestId("home-search-submit").click();
  await page.waitForURL((u) => !u.search.includes(s.toyotaBrandId));
  await expect(page.getByTestId("home-brand")).toHaveValue("BMW");
  await page.goBack();
  await page.waitForURL((u) => u.search.includes(s.toyotaBrandId));
  await expect(page.getByTestId("home-brand")).toHaveValue("Toyota");
});

test("rapid category and brand changes never show stale options", async ({ page }) => {
  await page.goto("/elanlar?category=CAR");
  // immediate category flip: the brand list must be the moto list
  await page.getByTestId("category-MOTORCYCLE").click();
  await page.getByTestId("category-CAR").click();
  await page.getByTestId("category-MOTORCYCLE").click();
  await page.getByTestId("home-brand").click();
  const listbox = page.getByTestId("home-brand-listbox");
  await expect(listbox.getByRole("option", { name: "Yamaha", exact: true })).toBeVisible();
  await expect(listbox.getByRole("option", { name: "Toyota", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // quick brand switch: the model tree must hold the LAST brand's families
  await page.getByTestId("category-CAR").click();
  await pickBrand(page, "Toyota");
  await pickBrand(page, "BMW");
  await page.getByTestId("home-model-toggle").click();
  await expect(page.getByTestId("home-model-family-x5")).toBeVisible();
  await expect(page.getByTestId("home-model-family-corolla")).toHaveCount(0);
});
