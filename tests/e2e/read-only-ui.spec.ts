import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

/**
 * Read-only launch UI — runs only on the read-only-* projects, which
 * target the second dev server (port 3001, LAUNCH_MODE=READ_ONLY).
 * Covers the staging-review findings: exact single-suffix page
 * titles, the corrected Azerbaijani search H1s, and honest deferred
 * copy that never claims login/posting/payment work today.
 */

const DOUBLE_SUFFIX = /— AVTOSH\.AZ — AVTOSH\.AZ/;

const TITLES = [
  ["/", "AVTOSH.AZ — avtomobil və motosiklet elanları"],
  ["/giris", "Daxil ol və ya qeydiyyatdan keç — AVTOSH.AZ"],
  ["/elanlar?category=CAR", "Avtomobil elanları — AVTOSH.AZ"],
  ["/elanlar?category=MOTORCYCLE", "Motosiklet elanları — AVTOSH.AZ"],
  ["/istifadeci-razilasmasi", "İstifadəçi razılaşması — AVTOSH.AZ"],
  ["/qaydalar", "Qaydalar — AVTOSH.AZ"],
  ["/mexfilik-siyaseti", "Məxfilik siyasəti — AVTOSH.AZ"],
] as const;

test.describe("page titles carry exactly one brand suffix", () => {
  for (const [path, title] of TITLES) {
    test(`${path} title is exact`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      await expect(page).not.toHaveTitle(DOUBLE_SUFFIX);
    });
  }
});

test.describe("search page headings", () => {
  test("CAR and MOTORCYCLE H1 values are exact", async ({ page }) => {
    await page.goto("/elanlar?category=CAR");
    await expect(page.locator("h1")).toHaveText("Avtomobil elanları");
    await page.goto("/elanlar?category=MOTORCYCLE");
    await expect(page.locator("h1")).toHaveText("Motosiklet elanları");
  });
});

test.describe("read-only honest copy", () => {
  test("home trust row states deferred features in future tense", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("WhatsApp ilə giriş — tezliklə")).toBeVisible();
    await expect(
      page.getByText("Tam versiyada birdəfəlik WhatsApp kodu ilə daxil ola biləcəksiniz."),
    ).toBeVisible();
    await expect(page.getByText("İlk 3 elan pulsuz — tezliklə")).toBeVisible();
    await expect(page.getByText("Elan yerləşdirmə açıldıqda ilk 3 elan pulsuz olacaq.")).toBeVisible();
    // Present-tense claims of deferred functionality must be absent.
    await expect(page.getByText("Şifrəsiz, birdəfəlik kod ilə daxil olun.")).toHaveCount(0);
    await expect(page.getByText("Sonrakı elanlar üçün sabit dərc haqqı.")).toHaveCount(0);
    // Unchanged, still-true trust point stays (heading role — the
    // header trust strip carries the same text).
    await expect(page.getByRole("heading", { name: "Hər elan yoxlanılır" })).toBeVisible();
  });

  test("footer describes a browse/search platform, not payments", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText("Azərbaycanda avtomobil və motosiklet elanlarına baxış və axtarış platforması."),
    ).toBeVisible();
    await expect(page.getByText("təhlükəsiz onlayn ödəniş")).toHaveCount(0);
    await expect(page.getByText("birbaşa əlaqə")).toHaveCount(0);
  });

  test("read-only badge remains", async ({ page }, testInfo) => {
    await page.goto("/");
    const badge = page.getByText("Baxış rejimi — giriş və elan yerləşdirmə tezliklə");
    // The header badge is intentionally max-sm:hidden; on mobile it
    // must still be in the DOM (the mobile menu carries the note).
    if (testInfo.project.name === "read-only-mobile") await expect(badge).toBeAttached();
    else await expect(badge).toBeVisible();
  });
});

test.describe("layout", () => {
  test("no horizontal overflow on key read-only pages", async ({ page }) => {
    for (const path of ["/", "/elanlar?category=CAR", "/giris"]) {
      await page.goto(path);
      await expectNoHorizontalOverflow(page);
    }
  });
});
