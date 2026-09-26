# Catalog Data Import

Format and tooling for loading verified catalog data (brands,
brand/category relationships, models, cities, features) into the
database.

**The repository does not contain production catalog data.** The
example files in `examples/` are format illustrations only. The
official Azerbaijan vehicle brand/model catalog, location list, and
final feature catalog must come from product-owner-verified sources
before launch.

## Format

One JSON file, any subset of the four sections:

```json
{
  "brands": [
    { "name": "Toyota", "slug": "toyota", "categories": ["CAR"], "is_active": true }
  ],
  "models": [
    { "brand_slug": "toyota", "category": "CAR", "name": "Corolla", "slug": "corolla", "is_active": true }
  ],
  "cities": [
    { "name_az": "Bakı", "slug": "baki", "sort_order": 1, "is_active": true }
  ],
  "features": [
    { "code": "AIR_CONDITIONING", "name_az": "Kondisioner", "category": "CAR", "is_active": true }
  ]
}
```

Rules:

- `slug`/`code` are the stable identifiers used for idempotent
  upserts — never change them for an existing entity; renames go
  through `name`/`name_az`.
- `categories`/`category` use category **codes** (`CAR`,
  `MOTORCYCLE`), which must already exist in the database.
- `is_active` defaults to `true`; deactivation is done by importing
  the entity with `"is_active": false` — the importer never deletes.
- `features[].category` may be `null` for features that apply to all
  categories.

## Running an import

```bash
DATABASE_URL=postgres://... pnpm catalog:import data/catalog/examples/sample-catalog.json
```

Dry run (validates and reports what would change, then rolls back):

```bash
DATABASE_URL=postgres://... pnpm catalog:import data/catalog/examples/sample-catalog.json --dry-run
```

Behavior:

- The whole file is Zod-validated before any write.
- Referenced categories and brand slugs are verified to exist;
  unknown references abort the import before any change.
- The import runs in ONE transaction — it applies fully or not at
  all.
- Re-running the same file is idempotent (upserts by slug/code).
- Existing entities are updated (name, activation, ordering), never
  deleted.

Run it only against a database you are entitled to change. Production
imports should first be exercised with `--dry-run` and against
staging.

## Owner brand catalog

`owner-brands.json` is the owner-supplied brand list (brands and
brand/category links only — no models), generated deterministically
from `source/AVTOSH_owner_brand_category_map.json` (status
DRAFT_REVIEW) by `scripts/catalog/generate-owner-brands.mts`. All
210 rows are included with their proposed categories; a display name
whose canonical identity differs from its spelling keeps its stable
identity slug via the generator's `SLUG_OVERRIDES` (e.g. Mercedes →
`mercedes-benz`, Ssang Yong → `ssangyong`, iCar → `icaur`, Radar →
`riddara`, Seres Aito → `aito`).

Rows carrying a `review_reason` are research QA notes added during
category mapping, not exclusions and not owner-authored flags: they
are listed verbatim in `owner-brands-review-pending.json` and remain
under Product review. The owner has passed local UAT for the
displayed brand selections (PR #42); that does not by itself resolve
the QA notes, and manufacturer identity and vehicle-form
compatibility have not been externally verified.

Production gate: the importer accepts this file technically when
given a `DATABASE_URL` — the gate is authorization, not tooling. No
production import has been authorized or performed, and none may run
while the mapping is DRAFT_REVIEW. The production database's existing
brand identities (UUIDs/slugs) have not been inspected; they must be
reconciled against this file's slugs before any production import.

Never edit the generated files by hand: change the source mapping,
re-run the generator, and commit all three together (the unit tests
fail on any drift).

```bash
node scripts/catalog/generate-owner-brands.mts          # regenerate
node scripts/catalog/generate-owner-brands.mts --check  # verify
```

For local UAT import, use the ephemeral database started by
`pnpm uat:dev` (see the harness output for its port) — not an
arbitrary `DATABASE_URL`.

## Owner model catalog

`owner-models.json` holds the owner-supplied model families and Alt
models (variants), generated deterministically from the immutable
source `source/AVTOSH_owner_model_source.md` (an HTML option dump,
status DRAFT_REVIEW) by `scripts/catalog/generate-owner-models.mts`.
`owner-models-provenance.json` records every source option verbatim
(value, class, data-group, data-count, label) with its resolution —
brand, category + decision basis, role, slugs — including the five
category-unresolved rows that are excluded pending Product review and
the documented Suzuki VL800 Intruder malformed-reference ruling. The
same generator/`--check`/no-hand-edit rules apply as for brands.
Import the complete set together with the brands file into a local
UAT database only; production import remains unauthorized.

The import format's `model_variants` section is
`{brand_slug, category, model_slug, name, slug, is_active, sort_order}`,
upserted by `(model_id, slug)`.
