import { describe, expect, it } from "vitest";
import { serverEnv } from "@/lib/env/server";

describe("serverEnv", () => {
  it("parses successfully without any optional variables set", () => {
    const env = serverEnv();
    expect(["development", "test", "production"]).toContain(env.NODE_ENV);
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it("returns the cached instance on repeat calls", () => {
    expect(serverEnv()).toBe(serverEnv());
  });
});
