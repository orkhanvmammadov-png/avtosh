import { expect, test } from "@playwright/test";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Avtomobil və motosiklet");
});

test("health endpoint returns the standard envelope", async ({ request }) => {
  const response = await request.get("/api/v1/health", {
    headers: { "X-Request-ID": "e2e-smoke-12345678" },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["x-request-id"]).toBe("e2e-smoke-12345678");
  const body = (await response.json()) as {
    data: { status: string; version: string };
  };
  expect(body.data.status).toBe("ok");
  expect(typeof body.data.version).toBe("string");
});
