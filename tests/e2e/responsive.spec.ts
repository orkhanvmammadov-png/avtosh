import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, seed } from "./helpers";

const WIDTHS = [360, 390, 768, 1024, 1200, 1440];

test.describe("Responsive layout invariants", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "runs once with explicit viewports");
  });

  for (const width of WIDTHS) {
    test(`no overflow and key controls available at ${width}px`, async ({ page }) => {
      const s = seed();
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expectNoHorizontalOverflow(page);
      await expect(page.getByTestId("home-search-submit")).toBeVisible();
      if (width < 768) await expect(page.getByTestId("mobile-menu-button")).toBeVisible();
      else await expect(page.getByRole("navigation", { name: "Əsas naviqasiya" })).toBeVisible();

      await page.goto("/elanlar?category=CAR");
      await expectNoHorizontalOverflow(page);
      // Phase 4.17O.6: unified search card at every width — no sidebar.
      await expect(page.getByTestId("home-advanced-toggle")).toBeVisible();
      await expect(page.getByTestId("filters-desktop")).toHaveCount(0);
      await expect(page.getByTestId("sort-select")).toBeVisible();
      const card = page.getByTestId("listing-card").first();
      // approved design card imagery: 16:10 mobile, 16:11 at md+
      const box = await card.locator(".aspect-gallery").first().boundingBox();
      expect(box).not.toBeNull();
      const expectedRatio = width < 768 ? 16 / 10 : 16 / 11;
      expect(Math.abs((box!.width / box!.height) - expectedRatio)).toBeLessThan(0.05);

      await page.goto(`/elan/${s.activeCar}`);
      await expectNoHorizontalOverflow(page);
      await expect(page.getByTestId("contact-reveal")).toBeVisible();
      await expect(page.getByTestId("detail-price")).toBeVisible();
    });
  }
});

// Homepage Premium feed: two cards per row on phones (down to 320px),
// three at md, four at lg — the ordinary search-result grid keeps its
// single phone column.
test.describe("Premium feed phone grid", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "runs once with explicit viewports");
  });

  const COLUMNS: [width: number, columns: number][] = [
    [320, 2],
    [360, 2],
    [390, 2],
    [768, 3],
    [1440, 4],
  ];

  for (const [width, columns] of COLUMNS) {
    test(`${columns} Premium columns at ${width}px with readable cards`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expectNoHorizontalOverflow(page);

      const cards = page.getByTestId("premium-grid").getByTestId("listing-card");
      // The premium section streams in (Suspense): wait until the
      // cards are visible before measuring — boundingBox() does not.
      await expect(cards.nth(1)).toBeVisible();
      expect(await cards.count()).toBeGreaterThanOrEqual(2);
      const boxes = [];
      for (let i = 0; i < Math.min(await cards.count(), columns + 1); i++) {
        const box = await cards.nth(i).boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box!);
      }
      // The first `columns` cards share one row, side by side without
      // overlap, entirely inside the viewport; the next card (when
      // seeded) wraps to the following row.
      for (let i = 1; i < Math.min(boxes.length, columns); i++) {
        expect(Math.abs(boxes[i]!.y - boxes[0]!.y)).toBeLessThanOrEqual(1);
        expect(boxes[i]!.x).toBeGreaterThanOrEqual(boxes[i - 1]!.x + boxes[i - 1]!.width);
      }
      for (const box of boxes.slice(0, columns)) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      }
      if (boxes.length > columns) {
        expect(boxes[columns]!.y).toBeGreaterThan(boxes[0]!.y + 10);
      }

      // Both side-by-side cards stay readable and usable: price,
      // title, Premium badge and the favorite control are visible,
      // and the favorite button never overlaps the badge row.
      for (const i of [0, 1]) {
        const card = cards.nth(i);
        await expect(card.getByTestId("card-price")).toBeVisible();
        await expect(card.locator("h3")).toBeVisible();
        await expect(card.getByText("Premium", { exact: true })).toBeVisible();
        const favorite = card.getByTestId("favorite-button");
        await expect(favorite).toBeVisible();
        await expect(favorite).toBeEnabled();
        const badgeBox = await card.getByText("Premium", { exact: true }).boundingBox();
        const favoriteBox = await favorite.boundingBox();
        expect(badgeBox).not.toBeNull();
        expect(favoriteBox).not.toBeNull();
        expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(favoriteBox!.x);
      }
    });
  }

  test("ordinary search results keep one phone column", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/elanlar?category=CAR");
    await expectNoHorizontalOverflow(page);
    const cards = page.getByTestId("listing-card");
    await expect(cards.nth(1)).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    // stacked, not side by side
    expect(Math.abs(second!.x - first!.x)).toBeLessThanOrEqual(1);
    expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
  });
});
