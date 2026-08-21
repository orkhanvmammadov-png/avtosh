// Seeds synthetic ACTIVE listings into the ephemeral database and prints
// EXPLAIN ANALYZE summaries for the key public search query shapes.
// Run: pnpm db:explain   (never against a real database)
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });
const N = Number(process.env.EXPLAIN_ROWS ?? 20000);

const [u] = await sql`insert into users (phone_e164) values ('+994509999999') returning id`;
const cats = await sql`select id, code from categories order by code`;
const car = cats.find((c) => c.code === "CAR").id;
const moto = cats.find((c) => c.code === "MOTORCYCLE").id;
const brands = [];
for (let i = 0; i < 6; i++) {
  const [b] = await sql`insert into brands (name, slug) values (${"ExBrand" + i}, ${"ex-brand-" + i}) returning id`;
  const cat = i < 4 ? car : moto;
  await sql`insert into brand_categories (brand_id, category_id) values (${b.id}, ${cat})`;
  for (let j = 0; j < 5; j++) {
    const [m] = await sql`insert into models (brand_id, category_id, name, slug) values (${b.id}, ${cat}, ${"M" + i + "-" + j}, ${"ex-m-" + i + "-" + j}) returning id`;
    brands.push({ brand: b.id, model: m.id, cat });
  }
}
const cities = [];
for (let i = 0; i < 8; i++) {
  const [c] = await sql`insert into cities (name_az, slug) values (${"ExCity" + i}, ${"ex-city-" + i}) returning id`;
  cities.push(c.id);
}
const batch = [];
for (let g = 1; g <= N; g++) {
  const bm = brands[g % brands.length];
  batch.push({
    owner_id: u.id, category_id: bm.cat, brand_id: bm.brand, model_id: bm.model,
    city_id: cities[g % cities.length], year: 1995 + (g % 30),
    price_minor: 100000 + ((g * 7919) % 5000000), mileage: (g * 131) % 400000,
    status: "ACTIVE",
    published_at: new Date(Date.now() - g * 60_000),
    current_expires_at: new Date(Date.now() + 20 * 86_400_000),
  });
  if (batch.length === 2000 || g === N) {
    await sql`insert into listings ${sql(batch, "owner_id", "category_id", "brand_id", "model_id", "city_id", "year", "price_minor", "mileage", "status", "published_at", "current_expires_at")}`;
    batch.length = 0;
  }
}
await sql`analyze listings`;

// postgres.js cannot prefix EXPLAIN onto a tagged query; re-issue as text with inlined literals (synthetic values only).
const lit = (v) => `'${v}'`;
const text = {
  "category + newest": `select l.id from listings l where l.status='ACTIVE' and l.current_expires_at > now() and l.category_id = ${lit(car)} order by l.published_at desc, l.id desc limit 25`,
  "category + brand + model + newest": `select l.id from listings l where l.status='ACTIVE' and l.current_expires_at > now() and l.category_id = ${lit(car)} and l.brand_id = ${lit(brands[0].brand)} and l.model_id = ${lit(brands[0].model)} order by l.published_at desc, l.id desc limit 25`,
  "price range + price asc": `select l.id from listings l where l.status='ACTIVE' and l.current_expires_at > now() and l.category_id = ${lit(car)} and l.price_minor between 500000 and 1500000 order by l.price_minor asc, l.id asc limit 25`,
  "year range + newest": `select l.id from listings l where l.status='ACTIVE' and l.current_expires_at > now() and l.category_id = ${lit(car)} and l.year between 2015 and 2020 order by l.published_at desc, l.id desc limit 25`,
  "city + newest": `select l.id from listings l where l.status='ACTIVE' and l.current_expires_at > now() and l.category_id = ${lit(car)} and l.city_id = ${lit(cities[0])} order by l.published_at desc, l.id desc limit 25`,
  "premium read": `select l.id from (select p.listing_id, max(p.starts_at) s from listing_promotions p where p.type='PREMIUM' and p.starts_at <= now() and p.ends_at > now() and p.status in ('SCHEDULED','ACTIVE') group by p.listing_id) pr join listings l on l.id = pr.listing_id where l.status='ACTIVE' and l.current_expires_at > now() order by pr.s desc, l.id desc limit 25`,
  "boost read": `select l.id from listings l where l.status='ACTIVE' and l.current_expires_at > now() and l.category_id = ${lit(car)} and exists (select 1 from listing_promotions p where p.listing_id=l.id and p.type='BOOST' and p.starts_at <= now() and p.ends_at > now() and p.status in ('SCHEDULED','ACTIVE')) order by l.id limit 50`,
};
for (const [name, q] of Object.entries(text)) {
  const plan = await sql.unsafe(`explain (analyze, format text) ${q}`);
  const lines = plan.map((r) => r["QUERY PLAN"]);
  const top = lines[0];
  const scans = lines.filter((l) => /Index|Seq Scan|Sort /.test(l)).map((l) => l.trim()).slice(0, 4);
  const time = lines.find((l) => l.includes("Execution Time"));
  console.log(`\n# ${name}\n  ${top.trim()}\n  ${scans.join("\n  ")}\n  ${time?.trim()}`);
}
await sql.end();
