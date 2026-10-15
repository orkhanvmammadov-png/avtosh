# O.15.3A — Normalization Decision Layer: Quality Report

Generated deterministically by `generate.py` from the six read-only source files.

## Brands
- Raw distinct CAR brands: **278**
- Raw distinct MOTO brands: **251**
- Car: INCLUDE 221 / NORMALIZE 24 / EXCLUDE 33 / REVIEW 0
- Motorcycle: INCLUDE 225 / NORMALIZE 10 / EXCLUDE 14 / REVIEW 2
- Canonical brand universe (INCLUDE, deduplicated across categories): **433**
- Duplicate canonical slugs: **0** (hard-failed at generation time)
- Broken normalization targets: **0** []
- lower(name) canonical collisions: **0** 

## CAR models
- Raw rows: **4895**
- KEEP_FAMILY: **4480**
- NORMALIZE_TO_FAMILY: **158**
- REASSIGN_BRAND: **62**
- EXCLUDE: **100**
- REVIEW: **95**
- CAR families after normalization: **4501**
- Same-family duplicates among KEEP_FAMILY rows: **2** [('mercedes-benz', '170'), ('mercedes-benz', '190')]
- REVIEW reasons: {'BARE_MARQUE_ROW': 4, 'HISTORICAL_TAXONOMY': 10, 'TRIM_OR_FAMILY': 1, 'NEEDS_TAXONOMY_DECISION': 79, 'JUNK_VALUE': 1}

## MOTO models
- Raw rows: **5744** — kept/reassigned: **5725**, EXCLUDE: **17**, REVIEW: **2**
- MOTO stays two-level; no variants manufactured.

## Variant research backlog
- Families initialized NEEDS_RESEARCH: **4501** (100% — the source contains no
  Alt-model data; VARIANT_NOT_APPLICABLE requires positive evidence, not absent data).

## Unresolved items (deliberate)
- Brand REVIEW: ['MGB', 'Moto S.p.a.']
- CAR model REVIEW rows: 95 — each carries a reason_code; they require a
  genuine taxonomy decision or outside research and were NOT silently resolved.
