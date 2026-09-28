import { describe, expect, it } from "vitest";
import {
  createProgressClassifier,
  failureAdvice,
  parseCheckConfig,
  parsePoolerKind,
} from "../../scripts/db/pooler-check-core.mjs";

// Deterministic behavior tests: synthetic clocks drive the
// classifier; nothing here mirrors the implementation's internals.

const base = { stallTimeoutMs: 10_000, totalBudgetMs: 60_000, totalRounds: 4, startedAt: 0 };

describe("pooler check progress classification", () => {
  it("slow but continuing progress stays RUNNING past the old fixed timeout", () => {
    const c = createProgressClassifier(base);
    // one round every 9s — slower than any single stall window trip
    c.recordRound(9_000);
    expect(c.classify(9_500).state).toBe("RUNNING");
    c.recordRound(18_000);
    c.recordRound(27_000);
    expect(c.classify(27_500).state).toBe("RUNNING");
  });

  it("no completed round within the stall window classifies as STALL", () => {
    const c = createProgressClassifier(base);
    c.recordRound(2_000);
    expect(c.classify(11_999).state).toBe("RUNNING");
    const verdict = c.classify(12_000); // 10s since the last round
    expect(verdict.state).toBe("STALL");
    expect(verdict.completedRounds).toBe(1);
    expect(verdict.elapsedMs).toBe(12_000);
  });

  it("continuing progress past the ceiling classifies as TOTAL_BUDGET_EXCEEDED, not STALL", () => {
    const c = createProgressClassifier({ ...base, totalRounds: 1000 });
    for (let t = 5_000; t <= 60_000; t += 5_000) c.recordRound(t);
    const verdict = c.classify(60_001);
    expect(verdict.state).toBe("TOTAL_BUDGET_EXCEEDED");
    expect(verdict.completedRounds).toBe(12);
  });

  it("a hang that also exceeds the ceiling reports the more specific STALL", () => {
    const c = createProgressClassifier(base);
    c.recordRound(1_000);
    expect(c.classify(70_000).state).toBe("STALL");
  });

  it("completing every round is DONE regardless of elapsed time", () => {
    const c = createProgressClassifier({ ...base, totalRounds: 2 });
    c.recordRound(50_000);
    c.recordRound(120_000); // way past the budget — but finished
    const verdict = c.classify(120_001);
    expect(verdict.state).toBe("DONE");
    expect(verdict.completedRounds).toBe(2);
  });
});

describe("pooler check configuration", () => {
  it("applies reviewed defaults and accepts overrides", () => {
    const defaults = parseCheckConfig({});
    expect(defaults).toMatchObject({
      concurrency: 24,
      rounds: 40,
      stallTimeoutMs: 30_000,
      totalBudgetMs: 600_000,
      poolerKind: "UNSPECIFIED",
    });
    const custom = parseCheckConfig({
      POOLER_CHECK_CONCURRENCY: "8",
      POOLER_CHECK_ROUNDS: "10",
      POOLER_CHECK_STALL_TIMEOUT_MS: "5000",
      POOLER_CHECK_TOTAL_BUDGET_MS: "20000",
      POOLER_KIND: "session",
    });
    expect(custom).toMatchObject({ concurrency: 8, rounds: 10, poolerKind: "SESSION" });
  });

  it("rejects out-of-range, non-integer and inconsistent values", () => {
    expect(() => parseCheckConfig({ POOLER_CHECK_CONCURRENCY: "0" })).toThrow(/CONCURRENCY/);
    expect(() => parseCheckConfig({ POOLER_CHECK_ROUNDS: "1.5" })).toThrow(/ROUNDS/);
    expect(() =>
      parseCheckConfig({ POOLER_CHECK_STALL_TIMEOUT_MS: "60000", POOLER_CHECK_TOTAL_BUDGET_MS: "10000" }),
    ).toThrow(/must be >=/);
    expect(() => parsePoolerKind("shared")).toThrow(/POOLER_KIND/);
  });
});

describe("failure advice never recommends the tested pooler", () => {
  it("session failure does not recommend the session pooler", () => {
    const advice = failureAdvice("SESSION", "STALL");
    expect(advice).not.toMatch(/use the session pooler/i);
    expect(advice).toMatch(/SESSION pooler as verified/);
  });

  it("transaction failure points at the session pooler", () => {
    const advice = failureAdvice("TRANSACTION", "STALL");
    expect(advice).toMatch(/Do not use the TRANSACTION pooler/);
    expect(advice).toMatch(/SESSION pooler \(port 5432\)/);
  });

  it("budget-exceeded advice explains slow-not-hung and how to re-run", () => {
    const advice = failureAdvice("SESSION", "TOTAL_BUDGET_EXCEEDED");
    expect(advice).toMatch(/not a proven hang/);
    expect(advice).toMatch(/POOLER_CHECK_TOTAL_BUDGET_MS/);
  });
});
