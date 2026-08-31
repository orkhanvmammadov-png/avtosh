// Deterministic LOCAL UAT seed (Phase 4.17.5). Runs ONLY inside the
// ephemeral PostgreSQL started by scripts/db/with-temp-postgres.sh —
// see assertUatSafety(). It never touches production, Supabase, or
// any remote database, and it changes no application code: everything
// it inserts is reachable through the accepted business rules.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import postgres from "postgres";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// SAFETY — every condition must hold or the seed refuses loudly.
// ---------------------------------------------------------------------------
export function assertUatSafety(databaseUrl) {
  const fail = (why) => {
    console.error(`[uat-seed] REFUSED: ${why}`);
    process.exit(1);
  };
  if (process.env.AVTOSH_UAT !== "1") fail("AVTOSH_UAT=1 is required.");
  if (process.env.NODE_ENV === "production") fail("NODE_ENV=production.");
  if (process.env.VERCEL_ENV === "production") fail("VERCEL_ENV=production.");
  if (process.env.TEMP_PG_EPHEMERAL !== "1") {
    fail("not running inside scripts/db/with-temp-postgres.sh (TEMP_PG_EPHEMERAL marker missing).");
  }
  if (databaseUrl === undefined) fail("DATABASE_URL missing.");
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    fail("DATABASE_URL is not a valid URL.");
  }
  // Strict contract of the ephemeral wrapper: loopback host, the
  // wrapper's dedicated port range, its user, its database name, no
  // password. A remote/Supabase/production URL can never satisfy this.
  if (url.protocol !== "postgres:") fail(`protocol ${url.protocol} is not postgres:`);
  if (url.hostname !== "127.0.0.1") fail(`host ${url.hostname} is not 127.0.0.1`);
  const port = Number(url.port);
  if (!(port >= 54329 && port <= 54399)) fail(`port ${url.port} is outside the ephemeral range 54329–54399`);
  if (url.username !== "avtosh") fail(`user ${url.username} is not the ephemeral 'avtosh' user`);
  if (url.password !== "") fail("ephemeral database has no password — one was supplied");
  if (url.pathname !== "/avtosh_temp") fail(`database ${url.pathname} is not /avtosh_temp`);
}

assertUatSafety(process.env.DATABASE_URL);

// UAT storage isolation: clear ONLY the dedicated uat namespace.
if (process.env.STORAGE_DRIVER !== "local" || process.env.LOCAL_STORAGE_SUBDIR !== "uat") {
  console.error("[uat-seed] REFUSED: STORAGE_DRIVER=local and LOCAL_STORAGE_SUBDIR=uat are required.");
  process.exit(1);
}
const uatStorage = path.join(process.cwd(), ".dev-storage", "uat");
rmSync(uatStorage, { recursive: true, force: true });
const imagesDir = path.join(uatStorage, "listing-images");
mkdirSync(imagesDir, { recursive: true });

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });

// ---------------------------------------------------------------------------
// Accounts (fake, local-only AZ mobiles). Login is ALWAYS the real
// OTP flow — no sessions are created here.
// ---------------------------------------------------------------------------
const ACCOUNTS = [
  { key: "SELLER_A", phone: "+994551000001", name: "UAT Seller A", roles: [] },
  { key: "SELLER_B", phone: "+994551000002", name: "UAT Seller B", roles: [] },
  { key: "MODERATOR", phone: "+994551000003", name: "UAT Moderator", roles: ["MODERATOR"] },
  { key: "ADMIN", phone: "+994551000004", name: "UAT Admin", roles: ["ADMIN"] },
  { key: "SUPER_ADMIN", phone: "+994551000005", name: "UAT Super Admin", roles: ["SUPER_ADMIN"] },
  { key: "STAFF_CANDIDATE", phone: "+994551000006", name: "UAT Namizəd", roles: [] },
];
const users = {};
for (const account of ACCOUNTS) {
  const [row] = await sql`
    insert into users (phone_e164, display_name, phone_verified_at)
    values (${account.phone}, ${account.name}, now()) returning id
  `;
  users[account.key] = row.id;
  for (const role of ["USER", ...account.roles]) {
    await sql`
      insert into user_roles (user_id, role_id)
      select ${row.id}, id from roles where code = ${role} on conflict do nothing
    `;
  }
}

// ---------------------------------------------------------------------------
// Catalog (fresh ephemeral DB every run — no conflicts possible).
// ---------------------------------------------------------------------------
const cats = Object.fromEntries((await sql`select id, code from categories`).map((c) => [c.code, c.id]));
async function brand(name, slug, codes) {
  const [b] = await sql`insert into brands (name, slug) values (${name}, ${slug}) returning id`;
  for (const code of codes) {
    await sql`insert into brand_categories (brand_id, category_id) values (${b.id}, ${cats[code]})`;
  }
  return b.id;
}
async function model(brandId, code, name, slug) {
  return (await sql`insert into models (brand_id, category_id, name, slug)
    values (${brandId}, ${cats[code]}, ${name}, ${slug}) returning id`)[0].id;
}
const toyota = await brand("Toyota", "toyota", ["CAR"]);
const bmw = await brand("BMW", "bmw", ["CAR", "MOTORCYCLE"]);
const yamaha = await brand("Yamaha", "yamaha", ["MOTORCYCLE"]);
const corolla = await model(toyota, "CAR", "Corolla", "corolla");
const camry = await model(toyota, "CAR", "Camry", "camry");
const x5 = await model(bmw, "CAR", "X5", "x5");
const mt07 = await model(yamaha, "MOTORCYCLE", "MT-07", "mt-07");
const baku = (await sql`insert into cities (name_az, slug, sort_order) values ('Bakı', 'baki', 1) returning id`)[0].id;
await sql`insert into cities (name_az, slug, sort_order) values ('Gəncə', 'gence', 2)`;
const abs = (await sql`insert into features (code, name_az) values ('ABS', 'ABS') returning id`)[0].id;
const petrol = (await sql`select id from reference_options where group_code='FUEL_TYPE' and code='PETROL'`)[0].id;
const auto = (await sql`select id from reference_options where group_code='TRANSMISSION' and code='AUTOMATIC'`)[0].id;
const sedan = (await sql`select id from reference_options where group_code='BODY_TYPE' and code='SEDAN'`)[0].id;

// ---------------------------------------------------------------------------
// Promotion packages: the production migration seeds them DISABLED
// (unapproved pricing). The UAT environment activates them explicitly
// as controlled, documented UAT-ONLY prices — sellers still resolve
// prices through the real server package model.
// ---------------------------------------------------------------------------
await sql`update promotion_packages set is_active = true`;
const packages = await sql`
  select id, type::text as type, duration_days, price_minor::text as price_minor
  from promotion_packages
`;
const pkg = (type, days) => packages.find((p) => p.type === type && p.duration_days === days);

// ---------------------------------------------------------------------------
// Real local images: sharp-generated WebP written into the UAT
// storage namespace so the local driver serves them through the
// production-shaped signed-URL read path. No network fetches.
// ---------------------------------------------------------------------------
const PALETTE = [
  { r: 30, g: 64, b: 175 }, { r: 15, g: 118, b: 110 }, { r: 146, g: 64, b: 14 },
  { r: 76, g: 29, b: 149 }, { r: 153, g: 27, b: 27 }, { r: 21, g: 94, b: 117 },
];
let colorCursor = 0;
async function attachImages(listingId, count = 3) {
  for (let i = 0; i < count; i += 1) {
    const storagePath = `listings/${randomUUID()}.webp`;
    const background = PALETTE[(colorCursor += 1) % PALETTE.length];
    const buffer = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background },
    })
      .webp({ quality: 60 })
      .toBuffer();
    const file = path.join(imagesDir, ...storagePath.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, buffer);
    await sql`
      insert into listing_images
        (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
      values (${listingId}, ${storagePath}, ${i}, ${i === 0}, 'image/webp', ${buffer.length}, 1600, 1200)
    `;
  }
}

// ---------------------------------------------------------------------------
// SELLER_B fixture matrix — lifecycle-consistent supporting rows.
// SELLER_A is deliberately untouched: zero listings, publications,
// payments, promotions (the clean FREE×3 → PAID#4 quota journey).
// ---------------------------------------------------------------------------
const B = users.SELLER_B;
let publicationNumber = 0;
const seeded = {};

async function insertListing(spec) {
  const submitted = !["DRAFT"].includes(spec.status);
  const published = ["ACTIVE", "SOLD", "EXPIRED", "SUSPENDED"].includes(spec.status);
  const startedDaysAgo = spec.startedDaysAgo ?? 5;
  const [row] = await sql`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor,
      mileage, fuel_type_id, transmission_id, body_type_id, description, contact_phone_e164,
      status, submitted_at, published_at, current_expires_at, sold_at)
    values (${B}, ${cats[spec.category ?? "CAR"]}, ${spec.brand ?? toyota}, ${spec.model ?? corolla},
      ${baku}, ${spec.year ?? 2021}, ${spec.price ?? 2500000}, ${spec.mileage ?? 64000},
      ${spec.category === "MOTORCYCLE" ? null : petrol}, ${spec.category === "MOTORCYCLE" ? null : auto},
      ${spec.category === "MOTORCYCLE" ? null : sedan},
      ${spec.description ?? "UAT elanı — əla vəziyyətdə, bir sahib."}, ${"+994551000002"},
      ${spec.status}::listing_status,
      ${submitted ? sql`now() - make_interval(days => ${startedDaysAgo})` : null},
      ${published ? sql`now() - make_interval(days => ${startedDaysAgo})` : null},
      ${published ? (spec.expiresOffsetMinutes !== undefined
        ? sql`now() + make_interval(mins => ${spec.expiresOffsetMinutes})`
        : sql`now() + make_interval(days => ${spec.expiresOffsetDays ?? 25})`) : null},
      ${spec.status === "SOLD" ? sql`now() - interval '1 day'` : null})
    returning id, public_id::text as public_id, revision
  `;
  await sql`insert into listing_features (listing_id, feature_id) values (${row.id}, ${abs})`;

  if (submitted) {
    // Real lifetime publication accounting: first 3 FREE, then PAID
    // with a SUCCESS listing-fee payment (constraint-enforced).
    publicationNumber += 1;
    let paymentId = null;
    if (publicationNumber > 3) {
      const [payment] = await sql`
        insert into payments (user_id, listing_id, type, amount_minor, currency, idempotency_key,
          status, fulfillment_status, provider, paid_at)
        values (${B}, ${row.id}, 'LISTING_FEE', 200, 'AZN', ${`uat:fee:${row.id}`},
          'SUCCESS', 'FULFILLED', 'KAPITAL', now() - make_interval(days => ${startedDaysAgo}))
        returning id
      `;
      paymentId = payment.id;
    }
    await sql`
      insert into listing_publications (listing_id, user_id, publication_number, billing_type, payment_id)
      values (${row.id}, ${B}, ${publicationNumber}, ${paymentId === null ? "FREE" : "PAID"}::billing_type, ${paymentId})
    `;
  }
  if (published || spec.periodEndsInPast) {
    await sql`
      insert into listing_periods (listing_id, period_number, source, starts_at, ends_at, status)
      select ${row.id}, 1, 'INITIAL', now() - make_interval(days => ${startedDaysAgo}),
             coalesce(current_expires_at, now() - interval '1 day'),
             ${spec.periodStatus ?? "ACTIVE"}::listing_period_status
      from listings where id = ${row.id}
    `;
  }
  if (spec.images !== false) {
    await attachImages(row.id, spec.imageCount ?? 3);
  }
  return row;
}

async function review(listing, decision, reasonCode, note) {
  await sql`
    insert into moderation_reviews (listing_id, moderator_id, listing_revision, decision, reason_code, note)
    values (${listing.id}, ${users.MODERATOR}, ${listing.revision}, ${decision}::moderation_decision,
      ${reasonCode}, ${note})
  `;
}

async function promote(listingId, type, durationDays) {
  const chosen = pkg(type, durationDays);
  const [payment] = await sql`
    insert into payments (user_id, listing_id, type, amount_minor, currency, idempotency_key,
      status, fulfillment_status, provider, promotion_package_id,
      package_duration_days, package_price_minor, paid_at)
    values (${B}, ${listingId}, ${type}::payment_type, ${chosen.price_minor}, 'AZN',
      ${`uat:${type}:${listingId}`}, 'SUCCESS', 'FULFILLED', 'KAPITAL', ${chosen.id},
      ${chosen.duration_days}, ${chosen.price_minor}, now() - interval '1 hour')
    returning id
  `;
  await sql`
    insert into listing_promotions (listing_id, type, payment_id, package_id, starts_at, ends_at,
      status, purchased_duration_days, purchased_price_minor)
    values (${listingId}, ${type}::promotion_type, ${payment.id}, ${chosen.id},
      now() - interval '1 hour', now() + make_interval(days => ${chosen.duration_days}),
      'ACTIVE', ${chosen.duration_days}, ${chosen.price_minor})
  `;
}

// DRAFT — continue in the wizard.
seeded.draft = await insertListing({ status: "DRAFT", model: corolla, images: false });
// PENDING_MODERATION ×2 — left for the moderator to claim/decide (one with images).
seeded.pending1 = await insertListing({ status: "PENDING_MODERATION", model: camry, price: 2890000 });
seeded.pending2 = await insertListing({ status: "PENDING_MODERATION", model: corolla, price: 1790000, images: false });
// CORRECTION_REQUIRED / REJECTED — with real moderator feedback.
seeded.correction = await insertListing({ status: "CORRECTION_REQUIRED", model: corolla, price: 2100000, images: false });
await review(seeded.correction, "CORRECTION_REQUESTED", "INVALID_PHOTOS", "Şəkillər aydın deyil — yenidən çəkib göndərin.");
seeded.rejected = await insertListing({ status: "REJECTED", model: camry, price: 100000, images: false });
await review(seeded.rejected, "REJECTED", "SUSPICIOUS_PRICE", "Qiymət bazar reallığına uyğun deyil.");
// ACTIVE public listing — reportable, contactable, admin-detail ready.
seeded.active = await insertListing({ status: "ACTIVE", model: corolla, price: 2500000 });
await review(seeded.active, "APPROVED", null, null);
// Promotions.
seeded.premium = await insertListing({ status: "ACTIVE", model: camry, price: 3350000 });
await promote(seeded.premium.id, "PREMIUM", 7);
seeded.boost = await insertListing({ status: "ACTIVE", brand: bmw, model: x5, price: 4550000 });
await promote(seeded.boost.id, "BOOST", 7);
seeded.both = await insertListing({ status: "ACTIVE", category: "MOTORCYCLE", brand: yamaha, model: mt07, price: 990000, mileage: 4000 });
await promote(seeded.both.id, "PREMIUM", 3);
await promote(seeded.both.id, "BOOST", 3);
// EXPIRY DEMO — time already lapsed, durable status still ACTIVE:
// public visibility must ALREADY exclude it (accepted fail-safe);
// the real secured expiry job then flips it to EXPIRED.
seeded.expiryDemo = await insertListing({ status: "ACTIVE", model: corolla, price: 1650000, expiresOffsetMinutes: -1, images: false });
// REMINDER DEMO — expires in 6 days → the real scheduler creates the
// D5/D3/D1 reminder rows for its period.
seeded.reminder = await insertListing({ status: "ACTIVE", model: camry, price: 2750000, expiresOffsetDays: 6, images: false });
// EXPIRED, renewal-eligible (lapsed initial period).
seeded.expired = await insertListing({ status: "EXPIRED", model: corolla, price: 1450000, startedDaysAgo: 40, expiresOffsetDays: -10, periodStatus: "EXPIRED", images: false });
// SOLD.
seeded.sold = await insertListing({ status: "SOLD", model: camry, price: 2300000, startedDaysAgo: 20, images: false });
// SUSPENDED (valid remaining period → admin unsuspension restores ACTIVE).
seeded.suspended = await insertListing({ status: "SUSPENDED", model: corolla, price: 1990000 });
await sql`
  insert into listing_status_history (listing_id, from_status, to_status, actor_user_id, actor_type, reason_code, notes)
  values (${seeded.suspended.id}, 'ACTIVE', 'SUSPENDED', ${users.MODERATOR}, 'MODERATOR', 'MISLEADING_INFO', 'UAT: dayandırılmış elan fiksturası')
`;

const [reminderPeriod] = await sql`
  select id from listing_periods where listing_id = ${seeded.reminder.id}
`;

const out = {
  databaseUrl: process.env.DATABASE_URL,
  accounts: Object.fromEntries(ACCOUNTS.map((a) => [a.key, { phone: a.phone, userId: users[a.key] }])),
  listings: Object.fromEntries(Object.entries(seeded).map(([k, v]) => [k, { id: v.id, publicId: v.public_id }])),
  reminderListingId: seeded.reminder.id,
  reminderPeriodId: reminderPeriod.id,
};
writeFileSync(".uat-seed.json", JSON.stringify(out, null, 2));
await sql.end();

console.log("\n[uat-seed] LOCAL UAT DATA READY (ephemeral DB — restart pnpm uat:dev to reset)\n");
console.log("  Accounts (login via real OTP — the code prints in THIS terminal):");
for (const account of ACCOUNTS) {
  console.log(`    ${account.key.padEnd(16)} ${account.phone}  ${account.roles.join(",") || "USER"}`);
}
console.log("\n  Key SELLER_B fixtures (public №):");
for (const [key, value] of Object.entries(seeded)) {
  console.log(`    ${key.padEnd(12)} №${value.public_id}`);
}
console.log("\n  Details written to .uat-seed.json (local, gitignored).\n");
