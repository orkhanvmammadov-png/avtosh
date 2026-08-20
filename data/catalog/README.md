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
