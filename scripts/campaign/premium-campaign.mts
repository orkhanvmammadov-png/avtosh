/**
 * O.16 — Complimentary Premium campaign operator tool (Owner-run,
 * NEVER a deployment/migration side effect; CI never runs it).
 * Self-contained SQL (plain-node runnable); the database carries the
 * invariants shared with the server path (partial unique grant index,
 * same-type no-overlap exclusion, source-integrity check), and the
 * integration suite proves script grants and server grants are
 * mutually idempotent.
 *
 * Modes (exactly one; connection from the private env file, e.g.
 * `( set -a; . ~/.avtosh/production.env; set +a;
 *    DATABASE_URL="$MIGRATION_DATABASE_URL" node scripts/campaign/premium-campaign.mts --dry-run --code X )`):
 *
 *   --activate --code <CODE> --starts-at <ISO, Asia/Baku business
 *     date, e.g. 2026-10-20T00:00:00+04:00> [--grant-days 30]
 *       Creates the campaign row. Enrollment window = EXACTLY
 *       grant-days × 24 h (30 days ⇒ 720 hours) from that instant;
 *       a listing approved in the final minute still receives its
 *       FULL grant — the window bounds enrollment, not the benefit.
 *       Activation alone grants nothing.
 *   --dry-run --code <CODE>
 *       READ-ONLY preview: eligible (ACTIVE+unexpired+not
 *       deactivated), already holding paid/scheduled Premium,
 *       already granted by this campaign, expected new grants.
 *   --execute --code <CODE>
 *       The explicit backfill: bounded batches, one transaction per
 *       listing (listing lock → eligibility re-check → insert with
 *       ON CONFLICT DO NOTHING → audit + outbox only when inserted).
 *       Resumable and idempotent — re-running skips granted rows.
 *   --stop --code <CODE>
 *       Closes enrollment (status STOPPED). Grants already issued
 *       keep running to their end; nothing is deleted; paid history
 *       is untouched.
 */
import postgres from "postgres";

const BATCH = 200;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const code = arg("code");
const modes = ["activate", "dry-run", "execute", "stop"].filter((m) => has(m));
if (modes.length !== 1 || code === undefined || code === "") {
  console.error(
    "Usage: --activate|--dry-run|--execute|--stop --code <CODE> [--starts-at <ISO>] [--grant-days 30]",
  );
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (load it from the private env file).");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false });

const campaignByCode = async () =>
  (
    await sql`
      select id, code, grant_days, enrollment_starts_at, enrollment_ends_at, status
      from premium_campaigns where code = ${code}
    `
  )[0];

try {
  if (has("activate")) {
    const startsRaw = arg("starts-at");
    const grantDays = Number(arg("grant-days") ?? "30");
    if (startsRaw === undefined || Number.isNaN(Date.parse(startsRaw))) {
      console.error("--activate requires --starts-at <ISO timestamp with offset>.");
      process.exit(1);
    }
    if (!Number.isInteger(grantDays) || grantDays < 1 || grantDays > 90) {
      console.error("--grant-days must be an integer in [1, 90].");
      process.exit(1);
    }
    const startsAt = new Date(startsRaw);
    const endsAt = new Date(startsAt.getTime() + grantDays * 24 * 3_600_000);
    const [row] = await sql`
      insert into premium_campaigns (code, grant_days, enrollment_starts_at, enrollment_ends_at)
      values (${code}, ${grantDays}, ${startsAt}, ${endsAt})
      returning id, enrollment_starts_at, enrollment_ends_at
    `;
    console.log(`campaign ${code} created (id ${row!.id})`);
    console.log(`  enrollment: ${row!.enrollment_starts_at.toISOString()} → ${row!.enrollment_ends_at.toISOString()}`);
    console.log(`  (= exactly ${grantDays}×24h; Asia/Baku display: use the +04:00 instants above)`);
    console.log("  No grants were made. Run --dry-run, review, then --execute.");
  }

  if (has("dry-run")) {
    const campaign = await campaignByCode();
    if (!campaign) throw new Error(`campaign ${code} not found — run --activate first`);
    const [counts] = await sql`
      with eligible as (
        select l.id from listings l
        where l.status = 'ACTIVE' and l.current_expires_at > now()
          and l.seller_deactivated_at is null
      )
      select
        (select count(*) from eligible)::int as eligible,
        (select count(distinct p.listing_id) from listing_promotions p
          join eligible e on e.id = p.listing_id
          where p.type = 'PREMIUM' and p.source = 'PAID'
            and p.status in ('SCHEDULED','ACTIVE') and p.ends_at > now())::int as with_paid_premium,
        (select count(*) from listing_promotions p
          join eligible e on e.id = p.listing_id
          where p.campaign_id = ${campaign.id})::int as already_granted,
        (select count(*) from eligible e where not exists (
          select 1 from listing_promotions p
          where p.listing_id = e.id and p.campaign_id = ${campaign.id}))::int as expected_new
    `;
    console.log(`[dry-run] campaign ${code} (status ${campaign.status})`);
    console.log(`  eligible listings:            ${counts!.eligible}`);
    console.log(`  with paid/scheduled Premium:  ${counts!.with_paid_premium} (grant will queue after it)`);
    console.log(`  already granted:              ${counts!.already_granted}`);
    console.log(`  expected new grants:          ${counts!.expected_new}`);
  }

  if (has("execute")) {
    const campaign = await campaignByCode();
    if (!campaign) throw new Error(`campaign ${code} not found`);
    if (campaign.status !== "ACTIVE") throw new Error(`campaign ${code} is ${campaign.status} — not executable`);
    let granted = 0;
    let skipped = 0;
    for (;;) {
      const batch = await sql`
        select l.id from listings l
        where l.status = 'ACTIVE' and l.current_expires_at > now()
          and l.seller_deactivated_at is null
          and not exists (
            select 1 from listing_promotions p
            where p.listing_id = l.id and p.campaign_id = ${campaign.id})
        order by l.id limit ${BATCH}
      `;
      if (batch.length === 0) break;
      for (const listing of batch) {
        await sql.begin(async (tx) => {
          await tx`select id from listings where id = ${listing.id} for update`;
          // Re-check eligibility under the lock (status may have moved).
          const [still] = await tx`
            select 1 from listings l where l.id = ${listing.id}
              and l.status = 'ACTIVE' and l.current_expires_at > now()
              and l.seller_deactivated_at is null
          `;
          if (!still) {
            skipped += 1;
            return;
          }
          const inserted = await tx`
            insert into listing_promotions
              (listing_id, type, package_id, payment_id, campaign_id, source,
               starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
            select ${listing.id}, 'PREMIUM'::promotion_type, null, null,
              ${campaign.id}, 'CAMPAIGN', base.starts_at,
              base.starts_at + (${campaign.grant_days} || ' days')::interval,
              case when base.starts_at <= now() then 'ACTIVE' else 'SCHEDULED' end::promotion_status,
              ${campaign.grant_days}, 0
            from (select greatest(now(), coalesce(
              (select max(ends_at) from listing_promotions
                where listing_id = ${listing.id} and type = 'PREMIUM'
                  and status in ('SCHEDULED','ACTIVE') and ends_at > now()), now())) as starts_at) base
            on conflict (listing_id, campaign_id) where campaign_id is not null do nothing
            returning starts_at, ends_at
          `;
          if (inserted.length === 0) {
            skipped += 1;
            return;
          }
          await tx`
            insert into audit_logs (actor_user_id, actor_type, action, entity_type, entity_id, after_data)
            values (null, 'SYSTEM', 'PROMOTION_CAMPAIGN_GRANTED', 'listing', ${listing.id},
              ${tx.json({
                campaign_id: campaign.id,
                campaign_code: campaign.code,
                granted_via: "BACKFILL",
                promotion_type: "PREMIUM",
                starts_at: inserted[0]!.starts_at.toISOString(),
                ends_at: inserted[0]!.ends_at.toISOString(),
              })})
          `;
          granted += 1;
        });
      }
      console.log(`  …granted ${granted} so far (skipped ${skipped})`);
    }
    console.log(`backfill complete: ${granted} granted, ${skipped} skipped (ineligible or already granted).`);
    console.log("Re-running is safe: granted listings are excluded by the unique index.");
  }

  if (has("stop")) {
    const rows = await sql`
      update premium_campaigns set status = 'STOPPED', stopped_at = now()
      where code = ${code} and status = 'ACTIVE'
      returning id
    `;
    if (rows.length === 0) {
      console.error(`campaign ${code} was not ACTIVE (already stopped or missing).`);
      process.exit(1);
    }
    console.log(`campaign ${code} STOPPED: enrollment is closed (approval hook and --execute now refuse).`);
    console.log("Grants already issued keep running to their end; nothing was deleted.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
