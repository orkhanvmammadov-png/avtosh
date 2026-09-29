import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Proves the real catalog service is wired through the opt-in
// transient-read retry: the repository read is called twice when the
// first attempt fails with a transient connection error, and the
// public DTO result is unchanged.

vi.mock("@/repositories/catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/repositories/catalog")>()),
  listActiveCities: vi.fn(),
  listActiveCategories: vi.fn(),
}));

import { getCities, getCategories } from "@/services/catalog";
import { listActiveCities, listActiveCategories } from "@/repositories/catalog";

function connectionClosedError(): Error {
  return Object.assign(new Error("write CONNECTION_CLOSED db.secretref.pooler.supabase.com:5432"), {
    code: "CONNECTION_CLOSED",
  });
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(listActiveCities).mockReset();
  vi.mocked(listActiveCategories).mockReset();
});

describe("catalog reads are opted in to the bounded retry", () => {
  it("getCities recovers from one transient failure with an unchanged payload", async () => {
    vi.mocked(listActiveCities)
      .mockRejectedValueOnce(connectionClosedError())
      .mockResolvedValueOnce([{ id: "c1", name_az: "Bakı", slug: "baki" }] as never);
    const cities = await getCities();
    expect(cities).toEqual([{ id: "c1", name: "Bakı", slug: "baki" }]);
    expect(vi.mocked(listActiveCities)).toHaveBeenCalledTimes(2);
  });

  it("getCities gives up after exactly two attempts on persistent transient failure", async () => {
    vi.mocked(listActiveCities).mockRejectedValue(connectionClosedError());
    await expect(getCities()).rejects.toMatchObject({ code: "CONNECTION_CLOSED" });
    expect(vi.mocked(listActiveCities)).toHaveBeenCalledTimes(2);
  });

  it("getCategories does not retry a non-transient repository failure", async () => {
    vi.mocked(listActiveCategories).mockRejectedValue(new Error("boom"));
    await expect(getCategories()).rejects.toThrow("boom");
    expect(vi.mocked(listActiveCategories)).toHaveBeenCalledTimes(1);
  });
});
