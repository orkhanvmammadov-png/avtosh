import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { apiFailure, apiSuccess } from "@/lib/api/response";

describe("apiSuccess", () => {
  it("wraps payload in the standard data envelope", async () => {
    const response = apiSuccess({ status: "ok" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { status: "ok" },
    });
  });

  it("echoes the request ID header when provided", () => {
    const response = apiSuccess({ ok: true }, { requestId: "req-12345678" });
    expect(response.headers.get("X-Request-ID")).toBe("req-12345678");
  });
});

describe("apiFailure", () => {
  it("serializes ApiError into the standard error envelope", async () => {
    const response = apiFailure(
      new ApiError("VALIDATION_ERROR", "Invalid input"),
      "req-12345678",
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("X-Request-ID")).toBe("req-12345678");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details: null,
        request_id: "req-12345678",
      },
    });
  });

  it("never exposes internal error messages", async () => {
    const response = apiFailure(
      new Error("secret stack trace"),
      "req-12345678",
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("secret");
  });
});
