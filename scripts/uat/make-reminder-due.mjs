// UAT-only time control for the reminder DELIVERY demo (Phase
// 4.17.5). Production semantics pin reminder sends to 10:00
// Asia/Baku; instead of altering any scheduling code, this local
// script moves the KNOWN UAT reminder fixture's already-scheduled
// notification rows to "due now" so the real secured worker can be
// observed delivering them. It is not an HTTP route, refuses
// production, and only ever targets the ephemeral UAT database and
// the seeded fixture identity from .uat-seed.json.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const fail = (why) => {
  console.error(`[uat-reminder] REFUSED: ${why}`);
  process.exit(1);
};

if (process.env.AVTOSH_UAT !== "1") fail("AVTOSH_UAT=1 is required.");
if (process.env.NODE_ENV === "production") fail("NODE_ENV=production.");
if (process.env.VERCEL_ENV === "production") fail("VERCEL_ENV=production.");

let seed;
try {
  seed = JSON.parse(readFileSync(".uat-seed.json", "utf8"));
} catch {
  fail(".uat-seed.json not found — start `pnpm uat:dev` first (its seed writes it).");
}

// Same strict ephemeral-URL contract as the seed: loopback host, the
// wrapper's port range, its user/database, no password.
let url;
try {
  url = new URL(seed.databaseUrl);
} catch {
  fail("stored databaseUrl is not a valid URL.");
}
if (url.protocol !== "postgres:") fail("not a postgres: URL");
if (url.hostname !== "127.0.0.1") fail(`host ${url.hostname} is not 127.0.0.1`);
const port = Number(url.port);
if (!(port >= 54329 && port <= 54399)) fail(`port ${url.port} outside the ephemeral range`);
if (url.username !== "avtosh" || url.password !== "") fail("not the ephemeral avtosh user");
if (url.pathname !== "/avtosh_temp") fail("not the avtosh_temp ephemeral database");
if (typeof seed.reminderPeriodId !== "string") fail("no reminder fixture in .uat-seed.json");

const sql = postgres(seed.databaseUrl, { prepare: false, max: 1 });
try {
  // Only the seeded UAT fixture's SCHEDULED expiry reminders — never
  // arbitrary rows, never other statuses, no application code touched.
  const rows = await sql`
    update notifications
    set scheduled_for = now() - interval '1 second', next_retry_at = null
    where listing_period_id = ${seed.reminderPeriodId}
      and type = 'LISTING_EXPIRY_REMINDER'
      and status = 'SCHEDULED'
    returning dedupe_key
  `;
  if (rows.length === 0) {
    console.log(
      "[uat-reminder] no SCHEDULED reminders for the UAT fixture yet.\n" +
        "  Run the scheduler first:  curl -H \"Authorization: Bearer $CRON_SECRET\" http://localhost:3000/api/jobs/send-reminders\n" +
        "  (or they were already delivered — restart pnpm uat:dev to reset).",
    );
  } else {
    console.log(`[uat-reminder] ${rows.length} reminder(s) are now due:`);
    for (const row of rows) console.log(`    ${row.dedupe_key}`);
    console.log(
      "  Now invoke the REAL secured worker and watch the server log:\n" +
        "  curl -H \"Authorization: Bearer $CRON_SECRET\" http://localhost:3000/api/jobs/send-reminders",
    );
  }
} finally {
  await sql.end();
}
