import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/health/route";
import { APP_VERSION } from "@/lib/version";

describe("GET /api/v1/health", () => {
  it("returns the health envelope with a version", async () => {
    const response = GET(new Request("http://localhost/api/v1/health"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { status: "ok", version: APP_VERSION },
    });
  });

  it("echoes a valid incoming X-Request-ID", () => {
    const response = GET(
      new Request("http://localhost/api/v1/health", {
        headers: { "X-Request-ID": "trace-12345678" },
      }),
    );
    expect(response.headers.get("X-Request-ID")).toBe("trace-12345678");
  });
});
