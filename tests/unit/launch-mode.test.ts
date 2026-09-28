import { afterEach, describe, expect, it, vi } from "vitest";
import { isReadOnlyLaunch, launchMode } from "@/lib/config/launch";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("launch mode", () => {
  it("fails closed: production without an explicit mode is READ_ONLY", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAUNCH_MODE", "");
    expect(launchMode()).toBe("READ_ONLY");
    expect(isReadOnlyLaunch()).toBe(true);
    // even a typo fails closed in production
    vi.stubEnv("LAUNCH_MODE", "full");
    expect(launchMode()).toBe("READ_ONLY");
  });

  it("production runs FULL only when explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LAUNCH_MODE", "FULL");
    expect(launchMode()).toBe("FULL");
  });

  it("development and test default to FULL (local UAT unchanged)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LAUNCH_MODE", "");
    expect(launchMode()).toBe("FULL");
    vi.stubEnv("NODE_ENV", "test");
    expect(launchMode()).toBe("FULL");
  });

  it("READ_ONLY can be forced explicitly in any environment", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LAUNCH_MODE", "READ_ONLY");
    expect(isReadOnlyLaunch()).toBe(true);
  });
});
