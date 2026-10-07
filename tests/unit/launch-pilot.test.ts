import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pilotGate } from "@/lib/config/launch-pilot";

// Fail-closed parsing of the Owner-only pilot allowlist.

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("pilotGate", () => {
  it("is inactive when unset or blank", () => {
    vi.stubEnv("LAUNCH_PILOT_PHONES", "");
    expect(pilotGate()).toEqual({ active: false });
    vi.unstubAllEnvs();
    delete process.env.LAUNCH_PILOT_PHONES;
    expect(pilotGate()).toEqual({ active: false });
  });

  it("allows exactly the listed phones, tolerating whitespace", () => {
    vi.stubEnv("LAUNCH_PILOT_PHONES", " +994501234567 , +994559876543 ");
    const gate = pilotGate();
    expect(gate.active).toBe(true);
    if (gate.active) {
      expect(gate.isAllowed("+994501234567")).toBe(true);
      expect(gate.isAllowed("+994559876543")).toBe(true);
      expect(gate.isAllowed("+994500000000")).toBe(false);
    }
  });

  it("FAILS CLOSED when enabled but malformed: active and NOBODY allowed", () => {
    for (const raw of [
      "+994501234567,0501234567", // one local-format entry
      "501234567",
      "+99450123456", // too short
      "+994501234567;+994559876543", // wrong separator
      ",,,",
    ]) {
      vi.stubEnv("LAUNCH_PILOT_PHONES", raw);
      const gate = pilotGate();
      expect(gate.active, raw).toBe(true);
      if (gate.active) {
        expect(gate.isAllowed("+994501234567"), raw).toBe(false);
      }
    }
  });

  it("the misconfiguration log never contains a phone number", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("LAUNCH_PILOT_PHONES", "+994501234567,oops-994559876543");
    pilotGate();
    const logged = (spy.mock.calls as unknown[][]).map((c) => String(c[0])).join("\n");
    expect(logged).toContain("launch_pilot_misconfigured");
    expect(logged).not.toContain("994501234567");
    expect(logged).not.toContain("994559876543");
  });
});
