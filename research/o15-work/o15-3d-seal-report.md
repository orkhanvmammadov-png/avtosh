# O.15.3D — Decision-Layer Seal Report

Sealed at stage date 2026-09-24 (deterministic; no runtime clock in outputs).

## Owner decisions applied
- **D1** Mercedes reopened QA (17 rows): `RATIFIED` -> mercedes-reopened-review.csv
- **D2** 95 CAR + 2 MOTO REVIEW rows: `DEFER_TO_RESEARCH_BACKLOG` -> car-review-closure.csv; moto-review-closure.csv; deferred-review-backlog.csv
- **D3** 21 MEDIUM-risk exclusions: `APPROVE_EXCLUSION_FOR_V1` -> medium-risk-exclusion-review.csv
- **D4** 8 source-gap marques: `ACKNOWLEDGED_SOURCE_GAP` -> source-gap-marques.csv
- **D5** Triumph identity: `RATIFIED` -> brand-decision-master.csv
- **D6** Approved family universe: `RATIFIED` -> car-family-count-reconciliation.csv
- **D7** Provenance: `RATIFIED` -> all decision masters
- **D8** P0 pilot: `APPROVED` -> variant-priority-backlog.csv; p0-wave-1.csv

## Sealed counts
- CAR import-candidate families: **4501**
- MOTO import-candidate families: **5722**
- Total import-candidate families: **10223**
- Deferred REVIEW rows: **97** (95 CAR + 2 MOTO) — barred from production import
- Approved MEDIUM-risk exclusions: **21** (KIT_REPLICA 9, COMMERCIAL_ONLY 7, AUTOCYCLE 2, TRIKE_CONVERSION 3)
- REPORTING CORRECTION: the 3C summary stated KIT_REPLICA 8 / TRIKE_CONVERSION 4;
  the sealed data has always been 9 / 3 (MOTO 'Jzr' kit trikes are KIT_REPLICA).
  Same 21 rows, same four approved classes — the split in the 3C prose was wrong.
- Reconciliation preserved: CAR 4502 -> 4500 -> 4501; MOTO 5744 = 5725+17+2, 5722 unique.

## Source integrity (byte hashes at seal time)
- AVTOSH_O15_Catalog_01_CAR_A-F.xlsx: `d26e0c6c6bd4a9fe01dbe0d821dd09f02c03cb9fd34e906e33422ffcb9fe62c1`
- AVTOSH_O15_Catalog_02_CAR_G-L.xlsx: `05cd0f83d7f1da51307f3fb9fe8b9c6699d4583baf3f3a7f30a30642055fb1b7`
- AVTOSH_O15_Catalog_03_CAR_M-R.xlsx: `f7460e15ccb81971cce324be0454ac4744c8624b2550294c3649ab2e9093968f`
- AVTOSH_O15_Catalog_04_CAR_S-Z.xlsx: `b428790936ef4584163562e39ec61422f624ab26f14c0861d4cd3b81a3ecc002`
- AVTOSH_O15_Catalog_05_MOTO_A-M.xlsx: `a02963d4ed9fc49a43d8f0576f0717487eebfe7a09053b5f0559020ec9bd8a48`
- AVTOSH_O15_Catalog_06_MOTO_N-Z.xlsx: `1eed1389fb3b27b94322c9ab7b3ae95e09c0f6c8cfa819939c3f276f8e64c6a1`

## P0_WAVE_1 (30 families, deterministic)
1. Audi — A3 (registration_breadth=14)
2. Audi — A4 (registration_breadth=14)
3. Audi — Q5 (registration_breadth=14)
4. Audi — Q7 (registration_breadth=14)
5. BMW — 1 Series (registration_breadth=14)
6. BMW — 2 Series (registration_breadth=14)
7. BMW — 3 Series (registration_breadth=14)
8. BMW — 4 Series (registration_breadth=14)
9. BMW — 5 Series (registration_breadth=14)
10. BMW — X1 (registration_breadth=14)
11. BMW — X3 (registration_breadth=14)
12. BMW — X5 (registration_breadth=14)
13. Ford — Mustang (registration_breadth=14)
14. Honda — CR-V (registration_breadth=14)
15. Honda — HR-V (registration_breadth=14)
16. Mercedes-Benz — A-Class (registration_breadth=14)
17. Mercedes-Benz — C-Class (registration_breadth=14)
18. Mercedes-Benz — CLA (registration_breadth=14)
19. Mercedes-Benz — E-Class (registration_breadth=14)
20. Mercedes-Benz — GLC (registration_breadth=14)
21. Mercedes-Benz — GLE (registration_breadth=14)
22. Mercedes-Benz — S-Class (registration_breadth=14)
23. Audi — A6 (registration_breadth=13)
24. Audi — A8 (registration_breadth=13)
25. BMW — 7 Series (registration_breadth=13)
26. BMW — X6 (registration_breadth=13)
27. Ford — Focus (registration_breadth=13)
28. Honda — Civic (registration_breadth=13)
29. Hyundai — Santa FE (registration_breadth=13)
30. Kia — Sorento (registration_breadth=13)

## Validations
See o15-3d validation list; sealing fails on any violation.

**ALL SEAL VALIDATIONS PASSED.**
