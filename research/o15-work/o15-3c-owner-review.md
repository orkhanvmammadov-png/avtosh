# O.15.3C — Owner Review Pack

Everything below awaits Owner decision; nothing has been silently resolved.

## 1. Open REVIEW rows (decide per row in the closure files)
- CAR: **95** rows -> car-review-closure.csv
- MOTO: **2** rows -> moto-review-closure.csv
- Each row: candidate decision, confidence, evidence reference/required,
  research_outcome; `owner_decision` / `owner_note` await you.

## 2. Reopened Mercedes rows (17) — mercedes-reopened-review.csv
| raw | was | candidate | action |
|---|---|---|---|
| 108 D | NORMALIZE_TO_FAMILY:S-Class | REVIEW | RETURNED_TO_REVIEW |
| 109 D | NORMALIZE_TO_FAMILY:S-Class | REVIEW | RETURNED_TO_REVIEW |
| 170 | NORMALIZE_TO_FAMILY:SLK | KEEP_FAMILY:170 | RECLASSIFIED_TO_FAMILY_170 |
| 170 D | NORMALIZE_TO_FAMILY:SLK | KEEP_FAMILY:170 | RECLASSIFIED_TO_FAMILY_170 |
| 207 D | NORMALIZE_TO_FAMILY:E-Class | EXCLUDE | RECLASSIFIED_EXCLUDE_COMMERCIAL |
| 208 D | NORMALIZE_TO_FAMILY:E-Class | EXCLUDE | RECLASSIFIED_EXCLUDE_COMMERCIAL |
| 209 D | NORMALIZE_TO_FAMILY:E-Class | EXCLUDE | RECLASSIFIED_EXCLUDE_COMMERCIAL |
| 220 CE | NORMALIZE_TO_FAMILY:S-Class | NORMALIZE_TO_FAMILY:E-Class | RECLASSIFIED_TO_E_CLASS |
| 220 D | NORMALIZE_TO_FAMILY:S-Class | NORMALIZE_TO_FAMILY:E-Class | RECLASSIFIED_TO_E_CLASS |
| 220 E | NORMALIZE_TO_FAMILY:S-Class | NORMALIZE_TO_FAMILY:E-Class | RECLASSIFIED_TO_E_CLASS |
| 220 TE | NORMALIZE_TO_FAMILY:S-Class | NORMALIZE_TO_FAMILY:E-Class | RECLASSIFIED_TO_E_CLASS |
| 230 | NORMALIZE_TO_FAMILY:SL | REVIEW | RETURNED_TO_REVIEW |
| 230 C | NORMALIZE_TO_FAMILY:SL | NORMALIZE_TO_FAMILY:E-Class | RECLASSIFIED_TO_E_CLASS |
| 230 CE | NORMALIZE_TO_FAMILY:SL | NORMALIZE_TO_FAMILY:E-Class | RECLASSIFIED_TO_E_CLASS |
| 230 E | NORMALIZE_TO_FAMILY:SL | NORMALIZE_TO_FAMILY:E-Class | RECLASSIFIED_TO_E_CLASS |
| 230 T | NORMALIZE_TO_FAMILY:SL | NORMALIZE_TO_FAMILY:E-Class | RECLASSIFIED_TO_E_CLASS |
| 230 TE | NORMALIZE_TO_FAMILY:SL | NORMALIZE_TO_FAMILY:E-Class | RECLASSIFIED_TO_E_CLASS |

## 3. MEDIUM-risk exclusions (not finally signed off)
- **21** rows -> medium-risk-exclusion-review.csv
  (KIT_REPLICA, TRIKE_CONVERSION, AUTOCYCLE, COMMERCIAL_ONLY; decisions unchanged,
  owner columns await sign-off).

## 4. Source-gap acknowledgements (Owner decision §3 recorded)
- AUDI China, Riddara, JETTA, AITO, Mercedes-Maybach, Geometry, DR/Stilnovo, SMA
  remain SOURCE_GAP; no invented models. -> source-gap-marques.csv

## 5. Family-level priority results (research queue only)
- P0_AZ_CORE: **148**
- P1_AZ_RELEVANT: **1610**
- P2_GLOBAL_MAINSTREAM: **274**
- P3_LONG_TAIL: **1518**
- P4_HISTORICAL_OR_LOW_CONFIDENCE: **951**
- P0 is a bounded curated pilot; AZ relevance is explicitly AZ_RELEVANCE_HEURISTIC.

## 6. Provenance status
- source_checked_at = 2026-09-24 (dataset CHECK date, Owner decision §1)
- source_snapshot_date = UNKNOWN (original snapshot date not establishable)
- Full rule attribution on all rows (rule_ref); per-row file/sheet coordinates
  are not carried (dataset-level provenance only).

## 7. Final count reconciliation
- CAR: 4502 -> 4500 (2 styling merges) -> **4501** (+ family '170').
- MOTO: 5744 rows = 5725 kept + 17 excluded + 2 review; **5722** unique families.
- Machine detail: car-family-count-reconciliation.csv.

## Recorded Owner decisions
- Triumph: ONE global canonical marque, immutable slug `triumph`, CAR+MOTO
  category links, category-owned model families.
