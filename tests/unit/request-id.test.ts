import { describe, expect, it } from "vitest";
import {
  isValidRequestId,
  resolveRequestId,
} from "@/lib/api/request-id";

function requestWithHeader(value?: string): Request {
  const headers = new Headers();
  if (value !== undefined) {
    headers.set("X-Request-ID", value);
  }
  return new Request("http://localhost/api/v1/health", { headers });
}

describe("resolveRequestId", () => {
  it("uses an acceptable incoming X-Request-ID", () => {
    const id = "abc-123_DEF.456";
    expect(resolveRequestId(requestWithHeader(id))).toBe(id);
  });

  it("generates a UUID when the header is missing", () => {
    const id = resolveRequestId(requestWithHeader());
    expect(isValidRequestId(id)).toBe(true);
  });

  it("rejects a too-short header", () => {
    const resolved = resolveRequestId(requestWithHeader("short"));
    expect(resolved).not.toBe("short");
    expect(isValidRequestId(resolved)).toBe(true);
  });

  it("rejects an oversized header", () => {
    const oversized = "a".repeat(200);
    expect(resolveRequestId(requestWithHeader(oversized))).not.toBe(oversized);
  });

  it("rejects headers with unsafe characters", () => {
    const injection = "abc\r\nSet-Cookie: hacked";
    expect(resolveRequestId(requestWithHeader("abcd<script>efgh"))).not.toBe(
      "abcd<script>efgh",
    );
    expect(isValidRequestId(injection)).toBe(false);
  });
});
