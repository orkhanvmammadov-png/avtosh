# O.15.4A — Variant Research Policy (pilot-validated)

Identity model: brand -> canonical model family -> optional model_variant.
A variant is a genuine, stable, marketplace-meaningful third identity level
(the sealed positive pattern: BMW 3 Series -> 316/318/320/.../330).

NEVER variants: generations/chassis codes (E90, W205), model years, body
styles (Touring, Estate), engines/displacement (2.0 TFSI, CDI), power/drive
badges (Audi 35..55, xDrive/sDrive, quattro, 4MATIC), transmissions, trims
(Avantgarde, EX), packages (M Sport), limited editions without stable
identity, market-only labels (Santa Fe Sport), and duplicates of the family.

Evidence standard: one official manufacturer source OR two independent
reliable references, all recorded in the source register with
source_checked_at = 2026-09-24. Internal/generative knowledge, dealer or
classified titles, SEO aggregators and numeric similarity are not evidence.

Conventions validated by the pilot:
- Mercedes designations use the official spaced display ("C 180"); slugs are
  deterministic slugify(name) ("c-180").
- Fuel-suffix aliases (320i/320d, 530d) normalize to the numeric variant.
- M/AMG/ST-class derivatives are recorded as REVIEW_VARIANT_IDENTITY —
  variant vs separate identity is an Owner taxonomy decision, never implied.
- RESEARCHED_EMPTY means "no qualifying identities established from the
  evidence checked in this pilot", never "variants cannot exist".
- Regression constraints unchanged and untouched: Toyota Corolla, Toyota
  Camry and Yamaha MT-07 stay variant-free in minimal UAT and were not
  researched (outside P0_WAVE_1).
