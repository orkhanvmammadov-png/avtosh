/**
 * O.16 — Complimentary Premium campaign operator tool (Owner-run,
 * NEVER a deployment/migration side effect; CI never runs it).
 * Self-contained SQL (plain-node runnable); the database carries the
 * invariants shared with the server path (partial unique grant index,
 * same-type no-overlap exclusion, source-integrity check, and the
 * FOR SHARE ENROLLING+window read inside every grant transaction).
 *
 * LIFECYCLE — no grant can happen before the ONE explicit opening:
 *   DRAFT      --prepare creates it; dry-runs allowed; approvals and
 *              --execute grant NOTHING while DRAFT.
 *   ENROLLING  --open flips DRAFT→ENROLLING, and is REJECTED unless
 *              now is inside the configured window — run it at or
 *              after the start instant. From this moment approvals
 *              enroll and --execute may backfill.
 *   STOPPED    --stop (terminal). In-flight grant transactions hold
 *              the campaign row FOR SHARE, so the stop UPDATE waits
 *              for them; once committed, no later grant transaction
 *              can pass the locked read. Issued grants keep running;
 *              nothing is deleted.
 *
 * Modes (exactly one; connection from the private env file, e.g.
 * `( set -a; . ~/.avtosh/production.env; set +a;
 *    DATABASE_URL="$MIGRATION_DATABASE_URL" node scripts/campaign/premium-campaign.mts --dry-run --code X )`):
 *
 *   --prepare --code <CODE> --starts-at <ISO with offset, e.g.
 *       2026-10-20T00:00:00+04:00 (Asia/Baku business date)>
 *       [--grant-days 30]
 *     Creates the DRAFT campaign. Window = EXACTLY grant-days × 24 h
 *     (30 d ⇒ 720 h) from that instant; a listing approved in the
 *     final minute still receives its FULL grant — the window bounds
 *     enrollment, never the benefit.
 *   --dry-run --code <CODE>   READ-ONLY counts (works on DRAFT).
 *   --open --code <CODE>      The explicit enrollment opening.
 *   --execute --code <CODE>   The explicit backfill (ENROLLING only;
 *     bounded per-listing transactions, each re-reading the campaign
 *     FOR SHARE and re-checking listing eligibility under lock;
 *     resumable and idempotent — granted rows are skipped).
 *   --stop --code <CODE>      Close enrollment (DRAFT or ENROLLING).
 */
import postgres from "postgres";

const BATCH = 200;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const code = arg("code");
const modes = ["prepare", "dry-run", "open", "execute", "stop"].filter((m) => has(m));
if (modes.length !== 1 || code === undefined || code === "") {
  console.error(
    "Usage: --prepare|--dry-run|--open|--execute|--stop --code <CODE> [--starts-at <ISO with explicit offset>] [--grant-days 30]",
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
  if (has("prepare")) {
    const startsRaw = arg("starts-at");
    const grantDays = Number(arg("grant-days") ?? "30");
    // An explicit offset is mandatory: the documented Baku start
    // instant must never depend on the operator machine's timezone.
    if (
      startsRaw === undefined ||
      Number.isNaN(Date.parse(startsRaw)) ||
      !/(Z|[+-]\d{2}:?\d{2})$/.test(startsRaw.trim())
    ) {
      console.error(
        "--prepare requires --starts-at as an ISO timestamp WITH an explicit offset, e.g. 2026-10-20T00:00:00+04:00 (Asia/Baku) — bare local timestamps are refused.",
      );
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
      returning id, enrollment_starts_at, enrollment_ends_at, status
    `;
    console.log(`campaign ${code} prepared as ${row!.status} (id ${row!.id})`);
    console.log(`  enrollment window: ${row!.enrollment_starts_at.toISOString()} → ${row!.enrollment_ends_at.toISOString()}`);
    console.log(`  (= exactly ${grantDays}×24h; Asia/Baku display: the +04:00 instants above)`);
    console.log("  DRAFT grants NOTHING — approvals included. Review --dry-run, then --open at/after the start instant.");
  }

  if (has("dry-run")) {
    const campaign = await campaignByCode();
    if (!campaign) throw new Error(`campaign ${code} not found — run --prepare first`);
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

  if (has("open")) {
    const campaign = await campaignByCode();
    if (!campaign) throw new Error(`campaign ${code} not found — run --prepare first`);
    if (campaign.status !== "DRAFT") throw new Error(`campaign ${code} is ${campaign.status}, not DRAFT — nothing to open`);
    const rows = await sql`
      update premium_campaigns
      set status = 'ENROLLING', opened_at = now()
      where code = ${code} and status = 'DRAFT'
        and enrollment_starts_at <= now() and enrollment_ends_at > now()
      returning id
    `;
    if (rows.length === 0) {
      console.error(
        `REFUSED: now is outside the configured window (${campaign.enrollment_starts_at.toISOString()} → ${campaign.enrollment_ends_at.toISOString()}).`,
      );
      console.error("Run --open at or after the start instant and before the end; or --prepare a corrected campaign.");
      process.exit(1);
    }
    console.log(`campaign ${code} is ENROLLING — approvals now enroll; run --execute for the backfill.`);
  }

  if (has("execute")) {
    const campaign = await campaignByCode();
    if (!campaign) throw new Error(`campaign ${code} not found`);
    if (campaign.status !== "ENROLLING") {
      throw new Error(`campaign ${code} is ${campaign.status} — only an ENROLLING campaign may backfill (run --open first)`);
    }
    let granted = 0;
    let skipped = 0;
    let closed = false;
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
          // Race-safe gate: FOR SHARE on the ENROLLING+in-window row.
          // A concurrent --stop blocks until this tx commits; after a
          // committed stop (or window end mid-backfill) this read is
          // empty and the loop halts without granting.
          const [live] = await tx`
            select grant_days, code from premium_campaigns
            where id = ${campaign.id} and status = 'ENROLLING'
              and enrollment_starts_at <= clock_timestamp()
              and enrollment_ends_at > clock_timestamp()
            for share
          `;
          if (!live) {
            closed = true;
            return;
          }
          await tx`select id from listings where id = ${listing.id} for update`;
          const [still] = await tx`
            select 1 from listings l where l.id = ${listing.id}
              and l.status = 'ACTIVE' and l.current_expires_at > now()
              and l.seller_deactivated_at is null
          `;
          if (!still) {
            skipped += 1;
            return;
          }
          // Wall-clock deadline guard inside the INSERT itself: now()
          // is frozen at transaction start, and the listing FOR
          // UPDATE wait above can cross the enrollment deadline —
          // the EXISTS re-check with clock_timestamp() runs after
          // every lock is held, immediately before the write.
          const inserted = await tx`
            insert into listing_promotions
              (listing_id, type, package_id, payment_id, campaign_id, source,
               starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
            select ${listing.id}, 'PREMIUM'::promotion_type, null, null,
              ${campaign.id}, 'CAMPAIGN', base.starts_at,
              base.starts_at + (${live.grant_days} || ' days')::interval,
              case when base.starts_at <= clock_timestamp() then 'ACTIVE' else 'SCHEDULED' end::promotion_status,
              ${live.grant_days}, 0
            from (select greatest(clock_timestamp(), coalesce(
              (select max(ends_at) from listing_promotions
                where listing_id = ${listing.id} and type = 'PREMIUM'
                  and status in ('SCHEDULED','ACTIVE') and ends_at > clock_timestamp()), clock_timestamp())) as starts_at) base
            where exists (
              select 1 from premium_campaigns c
              where c.id = ${campaign.id} and c.status = 'ENROLLING'
                and c.enrollment_starts_at <= clock_timestamp()
                and c.enrollment_ends_at > clock_timestamp())
            on conflict (listing_id, campaign_id) where campaign_id is not null do nothing
            returning starts_at, ends_at
          `;
          if (inserted.length === 0) {
            const [existing] = await tx`
              select 1 from listing_promotions
              where listing_id = ${listing.id} and campaign_id = ${campaign.id}
            `;
            if (existing) {
              skipped += 1; // already granted — resumable re-run
            } else {
              closed = true; // deadline passed while waiting on locks
            }
            return;
          }
          // Same committed side effects as the server path: audit AND
          // the PROMOTION_ACTIVATED outbox event.
          await tx`
            insert into audit_logs (actor_user_id, actor_type, action, entity_type, entity_id, after_data)
            values (null, 'SYSTEM', 'PROMOTION_CAMPAIGN_GRANTED', 'listing', ${listing.id},
              ${tx.json({
                campaign_id: campaign.id,
                campaign_code: live.code,
                granted_via: "BACKFILL",
                promotion_type: "PREMIUM",
                starts_at: inserted[0]!.starts_at.toISOString(),
                ends_at: inserted[0]!.ends_at.toISOString(),
              })})
          `;
          await tx`
            insert into outbox_events (event_type, aggregate_type, aggregate_id, payload)
            values ('PROMOTION_ACTIVATED', 'listing', ${listing.id},
              ${tx.json({
                listing_id: listing.id,
                promotion_type: "PREMIUM",
                source: "CAMPAIGN",
                campaign_code: live.code,
                granted_via: "BACKFILL",
                starts_at: inserted[0]!.starts_at.toISOString(),
                ends_at: inserted[0]!.ends_at.toISOString(),
                queued: inserted[0]!.starts_at.getTime() > Date.now(),
              })})
          `;
          granted += 1;
        });
        if (closed) break;
      }
      if (closed) break;
      console.log(`  …granted ${granted} so far (skipped ${skipped})`);
    }
    if (closed) {
      console.log(`backfill HALTED: the campaign is no longer ENROLLING/in-window. ${granted} granted, ${skipped} skipped.`);
      process.exit(1);
    }
    console.log(`backfill complete: ${granted} granted, ${skipped} skipped (ineligible or already granted).`);
    console.log("Re-running is safe: granted listings are excluded by the unique index.");
  }

  if (has("stop")) {
    const rows = await sql`
      update premium_campaigns set status = 'STOPPED', stopped_at = now()
      where code = ${code} and status in ('DRAFT', 'ENROLLING')
      returning id
    `;
    if (rows.length === 0) {
      console.error(`campaign ${code} was not DRAFT/ENROLLING (already stopped or missing).`);
      process.exit(1);
    }
    console.log(`campaign ${code} STOPPED: no further grants (the stop waited out any in-flight grant transactions).`);
    console.log("Grants already issued keep running to their end; nothing was deleted.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
