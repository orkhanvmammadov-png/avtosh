// Supabase pooler compatibility check for postgres.js.
//
//   DATABASE_URL=postgres://... node scripts/db/check-supabase-pooler.mjs
//
// Supabase's Postgres.js guidance warns that postgres.js pipelines
// queries by default and, combined with the SHARED TRANSACTION
// pooler (Supavisor transaction mode), this can hang queries or
// return mismatched rows; `prepare: false` alone does not disable
// pipelining, and `max_pipeline: 0` breaks sql.begin() upstream.
// This script exercises exactly the risky shape — saturated pool,
// concurrent interleaved queries and transactions — against the URL
// you provide, and verifies every reply matches its query. Run it
// against the STAGING pooler URL (session and transaction ports)
// before choosing the runtime connection string. It only SELECTs;
// nothing is written. A hang is a failure: the script times out.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const TIMEOUT_MS = 60_000;
const CONCURRENCY = 24; // far above max:5 → forces pipelining onto busy connections
const ROUNDS = 40;

const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} });

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT (hang): ${label}`)), TIMEOUT_MS),
    ),
  ]);
}

async function worker(id) {
  for (let round = 0; round < ROUNDS; round += 1) {
    const tag = id * 100_000 + round;
    // interleave plain queries and a transaction, all echoing a
    // unique tag so a mismatched reply is detectable
    const [row] = await sql`select ${tag}::int as tag, pg_sleep(0)`;
    if (row.tag !== tag) throw new Error(`MISMATCH plain: sent ${tag}, got ${row.tag}`);
    const txTag = await sql.begin(async (tx) => {
      const [a] = await tx`select ${tag + 1}::int as tag`;
      const [b] = await tx`select ${tag + 2}::int as tag`;
      if (a.tag !== tag + 1 || b.tag !== tag + 2) {
        throw new Error(`MISMATCH in tx: ${a.tag}/${b.tag} for ${tag}`);
      }
      return a.tag;
    });
    if (txTag !== tag + 1) throw new Error(`MISMATCH tx return: ${txTag} for ${tag}`);
  }
}

const started = Date.now();
try {
  await withTimeout(
    Promise.all(Array.from({ length: CONCURRENCY }, (_, id) => worker(id))),
    `${CONCURRENCY} workers x ${ROUNDS} rounds`,
  );
  console.log(
    `PASS: ${CONCURRENCY * ROUNDS} interleaved query+transaction rounds, ` +
      `no hang, no mismatched rows (${Date.now() - started}ms).`,
  );
  process.exit(0);
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : error}`);
  console.error(
    "Do NOT use this connection string for the runtime. Prefer the session pooler " +
      "(port 5432) or a Supavisor version with native pipelining support.",
  );
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
