import { expect, test } from "@playwright/test";
import { loginAs, testPhone } from "./auth-helpers";
import { clearListingContact, insertListingFixture } from "./seller-helpers";

/**
 * O.10 Stage C — deterministic entry orchestration through the real
 * editor route (no URL contract, no persistence): DRAFT restore
 * derives from persisted data; CORRECTION/REJECTED opens all-visited
 * at the honestly mapped reason stage (Review fallback otherwise).
 */

test("draft restore matrix derives the entry stage from persisted data alone", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "single-source matrix; one project");
  test.setTimeout(180_000);
  const { userId } = await loginAs(context, testPhone("desktop", 56));

  const open = async (id: string, stage: string, merhele: string) => {
    await page.goto(`/elan-yerlesdir/${id}`);
    await expect(page.getByTestId(`axin-section-${stage}`)).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("axin-progress")).toHaveText(merhele);
  };

  // CASE B — valid sale, no photos → Şəkillər
  const noPhotos = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 0 });
  await open(noPhotos.id, "photos", "Mərhələ 4 / 6");
  // reload derives the same result (no hidden session state)
  await page.reload();
  await expect(page.getByTestId("axin-section-photos")).toHaveAttribute("data-state", "open");

  // CASE C — 2 confirmed photos → still Şəkillər
  const twoPhotos = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 2 });
  await open(twoPhotos.id, "photos", "Mərhələ 4 / 6");

  // CASE D — 3 photos, contact missing → Əlavə məlumat və əlaqə
  const noContact = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await clearListingContact(noContact.id);
  await open(noContact.id, "info-contact", "Mərhələ 5 / 6");

  // CASE E — everything required present → Baxış və dərc
  const ready = await insertListingFixture(userId, { status: "DRAFT", complete: true, images: 3 });
  await open(ready.id, "review", "Mərhələ 6 / 6");
});

test("correction and resubmit open all-visited at the honestly mapped reason stage", async ({ page, context }, { project }) => {
  test.skip(project.name !== "desktop", "single-source matrix; one project");
  test.setTimeout(240_000);
  const { userId } = await loginAs(context, testPhone("desktop", 57));

  const cases: { reason: string | null; stage: string; status: "CORRECTION_REQUIRED" | "REJECTED" }[] = [
    { reason: "INVALID_PHOTOS", stage: "photos", status: "CORRECTION_REQUIRED" },
    { reason: "SUSPICIOUS_PRICE", stage: "sale", status: "CORRECTION_REQUIRED" },
    { reason: "CONTACT_ISSUE", stage: "info-contact", status: "CORRECTION_REQUIRED" },
    { reason: "WRONG_CATEGORY", stage: "quickstart", status: "REJECTED" },
    { reason: "MISLEADING_INFO", stage: "review", status: "CORRECTION_REQUIRED" }, // ambiguous → honest fallback
    { reason: "OTHER", stage: "review", status: "REJECTED" },
  ];

  for (const c of cases) {
    const fixture = await insertListingFixture(userId, {
      status: c.status,
      complete: true,
      images: 3,
      review:
        c.reason === null
          ? undefined
          : {
              decision: c.status === "REJECTED" ? "REJECTED" : "CORRECTION_REQUESTED",
              reasonCode: c.reason,
              note: "Stage C test",
            },
    });
    await page.goto(`/elan-yerlesdir/${fixture.id}`);
    await expect(page.getByTestId(`axin-section-${c.stage}`)).toHaveAttribute("data-state", "open");
    // all stages visited — Mərhələ stays 6/6, earlier stages editable
    await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 6 / 6");
    await expect(page.getByTestId("wizard-feedback")).toBeVisible();
    if (c.stage !== "quickstart") {
      await expect(page.getByTestId("axin-section-quickstart")).toHaveAttribute("data-state", "visited");
      await page.getByTestId("axin-section-quickstart").click(); // direct access is allowed here
      await expect(page.getByTestId("axin-section-quickstart")).toHaveAttribute("data-state", "open");
      await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 6 / 6"); // never reduced
    }
    // resubmit CTA (no new fee — fee line absent in resubmission mode)
    const review = page.getByTestId("axin-section-review");
    if ((await review.getAttribute("data-state")) !== "open") {
      await review.click();
    }
    await expect(page.getByTestId("wizard-submit")).toHaveText("Yenidən göndər");
    await expect(page.getByTestId("wizard-quota")).toHaveCount(0);
  }

  // null / missing review feedback → Review fallback, no throw
  const bare = await insertListingFixture(userId, { status: "REJECTED", complete: true, images: 3 });
  await page.goto(`/elan-yerlesdir/${bare.id}`);
  await expect(page.getByTestId("axin-section-review")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("axin-progress")).toHaveText("Mərhələ 6 / 6");
});
