import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export interface Seed {
  databaseUrl: string;
  activeCar: string;
  activeCarId: string;
  sellerId: string;
  boosted: string[];
  premium: string[];
  motos: string[];
  sold: string;
  expired: string;
  suspended: string;
  noImage: string;
  noContact: string;
  toyotaBrandId: string;
  corollaModelId: string;
  yamahaBrandId: string;
  bakuCityId: string;
  treeFamilyModelId: string;
  tree100VariantId: string;
  tree200VariantId: string;
  treeListings: string[];
}

export function seed(): Seed {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), ".e2e-seed.json"), "utf8")) as Seed;
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page must not scroll horizontally").toBeLessThanOrEqual(1);
}

/** Selects a brand in the search card's seller-style typeahead. */
export async function pickBrand(page: Page, name: string): Promise<void> {
  await page.getByTestId("home-brand").click();
  await page.getByTestId("home-brand").fill(name);
  await page
    .getByTestId("home-brand-listbox")
    .getByRole("option", { name, exact: true })
    .click();
  await expect(page.getByTestId("home-brand")).toHaveValue(name);
}

export function isMobile(projectName: string): boolean {
  return projectName === "mobile";
}
