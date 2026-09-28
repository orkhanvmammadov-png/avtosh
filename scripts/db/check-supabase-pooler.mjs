// Supabase pooler compatibility check for postgres.js.
//
//   DATABASE_URL=postgres://... POOLER_KIND=SESSION node scripts/db/check-supabase-pooler.mjs
//
// Supabase's Postgres.js guidance warns that postgres.js pipelines
// queries by default and, combined with the SHARED TRANSACTION
// pooler (Supavisor transaction mode), this can hang queries or
// return mismatched rows; `prepare: false` alone does not disable
// pipelining, and `max_pipeline: 0` breaks sql.begin() upstream.
//
// This script is a BOUNDED SMOKE/STRESS TEST, not proof of complete
// compatibility. It saturates a small pool with concurrent
// interleaved queries and transactions, verifying every reply
// against its unique tag. Diagnostics distinguish:
//  - STALL: no round completed within the inactivity window — the
//    signature of the pipelining hang;
//  - TOTAL_BUDGET_EXCEEDED: rounds kept completing but the absolute
//    safety ceiling passed — slow (e.g. remote latency), NOT a
//    proven hang;
//  - MISMATCH: a reply carried the wrong tag.
// Tunables (validated): POOLER_CHECK_CONCURRENCY (default 24),
// POOLER_CHECK_ROUNDS (40), POOLER_CHECK_STALL_TIMEOUT_MS (30000),
// POOLER_CHECK_TOTAL_BUDGET_MS (600000). POOLER_KIND=SESSION or
// TRANSACTION labels the run so advice never recommends the pooler
// just tested. Only SELECTs run; nothing is written; the connection
// string is never printed. A PASS remains a bounded result until
// real application queries and transactions run in staging.
import postgres from "postgres";
import {
  createProgressClassifier,
  failureAdvice,
  parseCheckConfig,
} from "./pooler-check-core.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

let config;
try {
  config = parseCheckConfig(process.env);
} catch (error) {
  console.error(`Invalid configuration: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
const { concurrency, rounds, stallTimeoutMs, totalBudgetMs, poolerKind } = config;
const totalRounds = concurrency * rounds;

const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });
const startedAt = Date.now();
const progress = createProgressClassifier({
  stallTimeoutMs,
  totalBudgetMs,
  totalRounds,
  startedAt,
});

function report(prefix, verdict) {
  console.log(
    `${prefix} [${poolerKind}] completed ${verdict.completedRounds}/${verdict.totalRounds} rounds in ${verdict.elapsedMs}ms ` +
      `(concurrency=${concurrency}, rounds/worker=${rounds}, stall=${stallTimeoutMs}ms, budget=${totalBudgetMs}ms)`,
  );
}

class MismatchError extends Error {}

async function worker(id) {
  for (let round = 0; round < rounds; round += 1) {
    const tag = id * 1_000_000 + round;
    const [row] = await sql`select ${tag}::int as tag, pg_sleep(0)`;
    if (row.tag !== tag) throw new MismatchError(`plain reply: sent ${tag}, got ${row.tag}`);
    const txTag = await sql.begin(async (tx) => {
      const [a] = await tx`select ${tag + 1}::int as tag`;
      const [b] = await tx`select ${tag + 2}::int as tag`;
      if (a.tag !== tag + 1 || b.tag !== tag + 2) {
        throw new MismatchError(`in tx: ${a.tag}/${b.tag} for ${tag}`);
      }
      return a.tag;
    });
    if (txTag !== tag + 1) throw new MismatchError(`tx return: ${txTag} for ${tag}`);
    progress.recordRound(Date.now());
  }
}

async function fail(kind, verdict, detail) {
  report(`FAIL (${kind})`, verdict);
  if (detail) console.error(detail);
  console.error(failureAdvice(poolerKind, kind));
  await sql.end({ timeout: 5 }).catch(() => undefined);
  process.exit(1);
}

// Watchdog: classifies once per second; a terminal state abandons
// in-flight work and force-closes the pool.
const watchdog = setInterval(() => {
  const verdict = progress.classify(Date.now());
  if (verdict.state === "STALL" || verdict.state === "TOTAL_BUDGET_EXCEEDED") {
    clearInterval(watchdog);
    void fail(verdict.state, verdict);
  }
}, 1_000);

try {
  await Promise.all(Array.from({ length: concurrency }, (_, id) => worker(id)));
  clearInterval(watchdog);
  const verdict = progress.classify(Date.now());
  report("PASS (bounded smoke test)", verdict);
  console.log(
    "PASS here is necessary, not sufficient: exercise the real application " +
      "against staging before treating this connection mode as verified.",
  );
  await sql.end({ timeout: 5 });
  process.exit(0);
} catch (error) {
  clearInterval(watchdog);
  const verdict = progress.classify(Date.now());
  const kind = error instanceof MismatchError ? "MISMATCH" : "QUERY_ERROR";
  await fail(kind, verdict, `${error instanceof Error ? error.message : error}`);
}
