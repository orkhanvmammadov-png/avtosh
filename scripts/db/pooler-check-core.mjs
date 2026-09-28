// Pure, clock-free core of the Supabase pooler smoke check:
// configuration parsing and progress classification. The runner
// (check-supabase-pooler.mjs) feeds real timestamps; tests feed
// synthetic ones, so classification is deterministic.

/** Validated configuration from environment variables. Reviewed safe
    defaults; ranges keep a typo from producing a meaningless run. */
export function parseCheckConfig(env) {
  const intVar = (name, fallback, min, max) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${name} must be an integer in [${min}, ${max}], got: ${raw}`);
    }
    return value;
  };
  const config = {
    concurrency: intVar("POOLER_CHECK_CONCURRENCY", 24, 1, 64),
    rounds: intVar("POOLER_CHECK_ROUNDS", 40, 1, 1000),
    // A stall means NO round completed inside this window — the
    // signature of the pipelining hang, unlike slow remote progress.
    stallTimeoutMs: intVar("POOLER_CHECK_STALL_TIMEOUT_MS", 30_000, 1_000, 300_000),
    // Absolute safety ceiling with a realistic remote default: high
    // latency legitimately stretches total duration while rounds
    // keep completing.
    totalBudgetMs: intVar("POOLER_CHECK_TOTAL_BUDGET_MS", 600_000, 10_000, 3_600_000),
    poolerKind: parsePoolerKind(env.POOLER_KIND),
  };
  if (config.totalBudgetMs < config.stallTimeoutMs) {
    throw new Error("POOLER_CHECK_TOTAL_BUDGET_MS must be >= POOLER_CHECK_STALL_TIMEOUT_MS");
  }
  return config;
}

export function parsePoolerKind(raw) {
  if (raw === undefined || raw === "") return "UNSPECIFIED";
  const kind = String(raw).toUpperCase();
  if (kind !== "SESSION" && kind !== "TRANSACTION") {
    throw new Error(`POOLER_KIND must be SESSION or TRANSACTION, got: ${raw}`);
  }
  return kind;
}

/**
 * Progress classifier. recordRound(now) after every completed round;
 * classify(now) returns one of:
 *  - RUNNING: rounds remain, progress within the stall window and budget
 *  - DONE: every round completed
 *  - STALL: no round completed for stallTimeoutMs (a hang signature)
 *  - TOTAL_BUDGET_EXCEEDED: still progressing, but past the absolute
 *    ceiling — slow, not proven hung
 * STALL is checked before the budget: an actual hang that also
 * exceeds the ceiling reports as the more specific STALL.
 */
export function createProgressClassifier({ stallTimeoutMs, totalBudgetMs, totalRounds, startedAt }) {
  let completedRounds = 0;
  let lastProgressAt = startedAt;
  return {
    recordRound(now) {
      completedRounds += 1;
      lastProgressAt = now;
    },
    get completedRounds() {
      return completedRounds;
    },
    classify(now) {
      const elapsedMs = now - startedAt;
      if (completedRounds >= totalRounds) {
        return { state: "DONE", completedRounds, totalRounds, elapsedMs };
      }
      if (now - lastProgressAt >= stallTimeoutMs) {
        return { state: "STALL", completedRounds, totalRounds, elapsedMs };
      }
      if (elapsedMs >= totalBudgetMs) {
        return { state: "TOTAL_BUDGET_EXCEEDED", completedRounds, totalRounds, elapsedMs };
      }
      return { state: "RUNNING", completedRounds, totalRounds, elapsedMs };
    },
  };
}

/** Failure advice that never recommends the pooler kind that was
    just tested. The URL is never part of any message. */
export function failureAdvice(poolerKind, state) {
  const slow =
    state === "TOTAL_BUDGET_EXCEEDED"
      ? "Progress continued but exceeded the absolute ceiling — this points at latency/throughput, not a proven hang. Re-run with a higher POOLER_CHECK_TOTAL_BUDGET_MS or fewer POOLER_CHECK_ROUNDS before drawing conclusions. "
      : "";
  if (poolerKind === "SESSION") {
    return (
      slow +
      "Do not treat the SESSION pooler as verified from this run. Investigate latency and the project's client-connection limits; consult Supabase guidance before considering the transaction pooler, which carries the documented pipelining risk."
    );
  }
  if (poolerKind === "TRANSACTION") {
    return (
      slow +
      "Do not use the TRANSACTION pooler based on this run. Test the SESSION pooler (port 5432) with the same command and compare."
    );
  }
  return (
    slow +
    "Do not treat this connection string as verified. Label the run with POOLER_KIND=SESSION or TRANSACTION and compare both pooler kinds."
  );
}
