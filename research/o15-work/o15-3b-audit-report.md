# O.15.3C — QA Report (supersedes the 3B revision)

## A. Attribution
- Rows validated: **11170** (brand 531, CAR 4895, MOTO 5744)
- 100% non-empty decision + reason_code + rule_ref; rule_ref whitelist and
  rule/decision consistency enforced as hard validations.
- Provenance: every master row carries source, source_checked_at=2026-09-24
  (Owner decision: dataset CHECK date) and source_snapshot_date=UNKNOWN
  (original snapshot date not establishable — never conflated).

## B. Count reconciliation
- See car-family-count-reconciliation.csv (machine-generated three-config replay):
  4502 (3A) + 0 added − 2 merged − 0 removed = 4500 (3B) — exclusively the
  Aion UT and AMC AMX styling convergences;
  4500 (3B) + 1 added (family '170') − 0 − 0 = **4501 (3C)**.
- MOTO: 5744 raw = 5725 kept/reassigned + 17 excluded + 2 review;
  5725 − 3 duplicate-key collapses = **5722** unique import-candidate
  families (bluroc/hero-125 ×2, kl-service/kxe250, kl-service/kxe450).

## C. Reopened Mercedes cases
- 17 rows reopened; outcomes: 3 EXCLUDE (T1 van codes), 3 RETURNED_TO_REVIEW
  (108 D, 109 D, bare 230), 2 -> family '170', 9 -> E-Class. Candidates and
  evidence in mercedes-reopened-review.csv; owner columns empty.

## D. Review rows
- CAR REVIEW: **95** ({'BARE_MARQUE_ROW': 4, 'HISTORICAL_TAXONOMY': 10, 'TRIM_OR_FAMILY': 1, 'NEEDS_TAXONOMY_DECISION': 79, 'JUNK_VALUE': 1}); MOTO REVIEW: **2**
- Mercedes research groups now: {'ambiguous_historical': 27, 'sales_designation': 48, 'chassis_defensible': 2, 'junk_or_incomplete': 2}
- Enriched with evidence_reference / evidence_checked_at / research_outcome /
  recommended_* / residual_risk; owner columns remain empty.

## E. Family-level priorities
- P0_AZ_CORE: **148**
- P1_AZ_RELEVANT: **1610**
- P2_GLOBAL_MAINSTREAM: **274**
- P3_LONG_TAIL: **1518**
- P4_HISTORICAL_OR_LOW_CONFIDENCE: **951**
- Curated P0 pilot matches: 148 families (bounded queue).
- AZ relevance is heuristic (AZ_RELEVANCE_HEURISTIC) — no proven AZ sales data used.

## F. Import-key validation
- 433 unique global brand slugs; 433 linked; 
  10223 unique (brand, category, model_slug) keys with consistent display
  names and deterministic slugs; zero REVIEW/EXCLUDE leakage; zero lost rows;
  zero styling-only family splits.

## Hard validations
ALL PASSED.
