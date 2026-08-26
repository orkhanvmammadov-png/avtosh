// Deterministic E2E seed for the ephemeral Postgres started by
// scripts/db/with-temp-postgres.sh. Writes discovered public ids (and the
// local ephemeral DATABASE_URL, which is never a secret) to .e2e-seed.json
// so Playwright specs can target known listings and toggle scenarios.
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });
const out = { databaseUrl: process.env.DATABASE_URL };

// TEST FIXTURE: promotion packages ship DISABLED in the production
// seed (unapproved placeholder pricing). The E2E environment activates
// them explicitly as controlled fixture data — this does not weaken
// the production safeguard, which is regression-tested separately.
await sql`update promotion_packages set is_active = true`;

const [seller] = await sql`insert into users (phone_e164, display_name) values ('+994501110001', 'Elvin') returning id`;
const cats = Object.fromEntries((await sql`select id, code from categories`).map((c) => [c.code, c.id]));
const brand = async (name, slug, codes) => {
  const [b] = await sql`insert into brands (name, slug) values (${name}, ${slug}) returning id`;
  for (const code of codes) await sql`insert into brand_categories (brand_id, category_id) values (${b.id}, ${cats[code]})`;
  return b.id;
};
const model = async (brandId, code, name, slug) =>
  (await sql`insert into models (brand_id, category_id, name, slug) values (${brandId}, ${cats[code]}, ${name}, ${slug}) returning id`)[0].id;

const toyota = await brand("Toyota", "toyota", ["CAR"]);
const bmw = await brand("BMW", "bmw", ["CAR", "MOTORCYCLE"]);
const yamaha = await brand("Yamaha", "yamaha", ["MOTORCYCLE"]);
const corolla = await model(toyota, "CAR", "Corolla", "corolla");
const camry = await model(toyota, "CAR", "Camry", "camry");
const x5 = await model(bmw, "CAR", "X5", "x5");
const gs = await model(bmw, "MOTORCYCLE", "R 1250 GS", "r-1250-gs");
const mt07 = await model(yamaha, "MOTORCYCLE", "MT-07", "mt-07");
const baku = (await sql`insert into cities (name_az, slug, sort_order) values ('Bakı', 'baki', 1) returning id`)[0].id;
const ganja = (await sql`insert into cities (name_az, slug, sort_order) values ('Gəncə', 'gence', 2) returning id`)[0].id;
const abs = (await sql`insert into features (code, name_az) values ('ABS', 'ABS') returning id`)[0].id;
const petrol = (await sql`select id from reference_options where group_code='FUEL_TYPE' and code='PETROL'`)[0].id;
const auto = (await sql`select id from reference_options where group_code='TRANSMISSION' and code='AUTOMATIC'`)[0].id;
const sedan = (await sql`select id from reference_options where group_code='BODY_TYPE' and code='SEDAN'`)[0].id;

async function listing(spec) {
  const status = spec.status ?? "ACTIVE";
  const [row] = await sql`
    insert into listings (owner_id, category_id, brand_id, model_id, city_id, year, price_minor, mileage,
      fuel_type_id, transmission_id, body_type_id, credit_available, description, contact_phone_e164,
      status, submitted_at, published_at, current_expires_at, sold_at)
    values (${seller.id}, ${cats[spec.category ?? "CAR"]}, ${spec.brand}, ${spec.model}, ${spec.city ?? baku},
      ${spec.year ?? 2020}, ${spec.price ?? 2500000}, ${spec.mileage ?? 60000},
      ${spec.category === "MOTORCYCLE" ? null : petrol}, ${spec.category === "MOTORCYCLE" ? null : auto},
      ${spec.category === "MOTORCYCLE" ? null : sedan}, ${spec.credit ?? false},
      ${"Əla vəziyyətdə, bir sahib. <b>HTML yoxdur</b>"}, ${spec.contact === null ? null : "+994501234567"},
      ${status}::listing_status, now() - interval '3 days',
      now() - (${spec.publishedMinutesAgo ?? 60} || ' minutes')::interval,
      ${status === "EXPIRED" ? sql`now() - interval '1 day'` : sql`now() + interval '20 days'`},
      ${status === "SOLD" ? sql`now()` : null})
    returning id, public_id::text as public_id
  `;
  if (spec.images !== false) {
    for (let i = 0; i < 3; i++) {
      await sql`insert into listing_images (listing_id, storage_path, sort_order, is_primary, mime_type, file_size_bytes, width, height)
        values (${row.id}, ${`listings/${crypto.randomUUID()}.webp`}, ${i}, ${i === 0}, 'image/webp', 1000, 1600, 1200)`;
    }
  }
  await sql`insert into listing_features (listing_id, feature_id) values (${row.id}, ${abs})`;
  return row;
}
async function promote(listingId, type) {
  const [pay] = await sql`insert into payments (user_id, listing_id, type, amount_minor, idempotency_key, status)
    values (${seller.id}, ${listingId}, ${type}::payment_type, 0, ${`e2e:${listingId}:${type}`}, 'CREATED') returning id`;
  await sql`insert into listing_promotions (listing_id, type, payment_id, starts_at, ends_at, status, purchased_duration_days, purchased_price_minor)
    values (${listingId}, ${type}::promotion_type, ${pay.id}, now() - interval '1 hour', now() + interval '7 days', 'ACTIVE', 7, 0)`;
}

// 30 organic Toyota cars (enough for two result pages of 24)
const cars = [];
for (let i = 0; i < 30; i++) {
  cars.push(await listing({ brand: toyota, model: i % 2 ? camry : corolla, price: 1500000 + i * 50000, year: 2010 + (i % 14), mileage: 20000 + i * 5000, publishedMinutesAgo: 100 + i * 10, city: i % 3 ? baku : ganja, credit: i % 4 === 0 }));
}
const boosted = [];
for (let i = 0; i < 3; i++) { const l = await listing({ brand: bmw, model: x5, price: 4000000 + i * 100000, year: 2021, publishedMinutesAgo: 5000 + i }); await promote(l.id, "BOOST"); boosted.push(l.public_id); }
const premium = [];
for (let i = 0; i < 3; i++) { const l = await listing({ brand: toyota, model: camry, price: 3000000 + i * 10000, year: 2022, publishedMinutesAgo: 6000 + i }); await promote(l.id, "PREMIUM"); premium.push(l.public_id); }
const motoPremium = await listing({ category: "MOTORCYCLE", brand: yamaha, model: mt07, price: 900000, year: 2023, mileage: 3000, publishedMinutesAgo: 7000 });
await promote(motoPremium.id, "PREMIUM"); premium.push(motoPremium.public_id);
const motos = [await listing({ category: "MOTORCYCLE", brand: bmw, model: gs, price: 2200000, year: 2019, mileage: 15000, publishedMinutesAgo: 50 }), await listing({ category: "MOTORCYCLE", brand: yamaha, model: mt07, price: 800000, year: 2020, mileage: 9000, publishedMinutesAgo: 40 })];
const sold = await listing({ brand: toyota, model: corolla, status: "SOLD", publishedMinutesAgo: 9000 });
const expired = await listing({ brand: toyota, model: corolla, status: "EXPIRED", publishedMinutesAgo: 60000 });
const suspended = await listing({ brand: toyota, model: corolla, status: "SUSPENDED" });
const noImage = await listing({ brand: toyota, model: corolla, images: false, price: 1234500, publishedMinutesAgo: 1 });
const noContact = await listing({ brand: toyota, model: camry, contact: null, price: 1999900, publishedMinutesAgo: 2 });

Object.assign(out, {
  activeCar: cars[0].public_id, activeCarId: cars[0].id, sellerId: seller.id,
  boosted, premium, motos: motos.map((m) => m.public_id),
  sold: sold.public_id, expired: expired.public_id, suspended: suspended.public_id,
  noImage: noImage.public_id, noContact: noContact.public_id,
  toyotaBrandId: toyota, corollaModelId: corolla, yamahaBrandId: yamaha, bakuCityId: baku,
});
writeFileSync(".e2e-seed.json", JSON.stringify(out, null, 2));
await sql.end();
console.log(`[e2e-seed] ${cars.length + boosted.length + premium.length + motos.length + 5} listings seeded`);
