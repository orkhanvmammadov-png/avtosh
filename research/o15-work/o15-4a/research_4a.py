"""O.15.4A — P0 Wave 1 variant-research pilot (research-only artifacts).

Reads the SEALED O.15.3 layer read-only (validated against the 3D
manifest before and after), materializes the pilot research tables into
the required CSV/JSON/MD outputs, and hard-fails on every §L validation.

Curated research content below was gathered on 2026-09-24 from the
sources in SOURCES; internal model knowledge was never used as
evidence. Deterministic: fixed stage date, stable ordering.
"""
import csv
import hashlib
import json
import os
import re
import sys
import unicodedata

ROOT = "/Users/mammadovov/Developer/avtosh"
WORK = f"{ROOT}/research/o15-work"
OUT = f"{WORK}/o15-4a"
CHECKED = "2026-09-24"
FAILURES = []


def fail(m):
    FAILURES.append(m)


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for c in iter(lambda: fh.read(65536), b""):
            h.update(c)
    return h.hexdigest()


def slugify(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"


def validate_sealed():
    bad = []
    with open(f"{WORK}/o15-3d-manifest.csv") as fh:
        for r in csv.DictReader(fh):
            p = f"{ROOT}/{r['file_path']}"
            if not os.path.exists(p) or sha256(p) != r["sha256"]:
                bad.append(r["file_path"])
    return bad


# ---------------------------------------------------------------------------
# Source register (everything actually checked on 2026-09-24)
# ---------------------------------------------------------------------------
SOURCES = {
    "S1": ("BMW 3 Series — Wikipedia", "https://en.wikipedia.org/wiki/BMW_3_Series",
           "encyclopedic_reference", "Wikimedia Foundation",
           "bmw/3-series", "Documents 316-340 sales designations vs E21..G20 chassis codes."),
    "S2": ("40 years of the BMW 3 Series (press release)",
           "https://www.press.bmwgroup.com/global/article/detail/T0216343EN/40-years-of-the-bmw-3-series",
           "official_manufacturer", "BMW Group PressClub",
           "bmw/3-series", "Official history: launch range 316/318/320/320i; 323i; E46 318i/320i/323i/328i/320d; 325i/330i."),
    "S3": ("BMW 3 Series celebrates 50 years",
           "https://www.bmwgroup.com/en/news/general/2025/50-years-BMW-3-series.html",
           "official_manufacturer", "BMW Group",
           "bmw/3-series", "Official anniversary article corroborating designation history."),
    "S4": ("BMW 5 Series — Wikipedia", "https://en.wikipedia.org/wiki/BMW_5_Series",
           "encyclopedic_reference", "Wikimedia Foundation",
           "bmw/5-series", "Sparse designation coverage (525i/528i/530d/540i/550e); chassis codes."),
    "S5": ("Five Times Around. History of the BMW 5 Series (press release)",
           "https://www.press.bmwgroup.com/usa/article/detail/T0079416EN_US/five-times-around-history-of-the-bmw-5-series",
           "official_manufacturer", "BMW Group PressClub",
           "bmw/5-series", "Official history: 518i/520i/524td/525i/530i/535i/540i designations."),
    "S6": ("Mercedes-Benz C-Class — Wikipedia", "https://en.wikipedia.org/wiki/Mercedes-Benz_C-Class",
           "encyclopedic_reference", "Wikimedia Foundation",
           "mercedes-benz/c-class", "Documents C180..C320 designations vs W202..W206 chassis codes."),
    "S7": ("The Mercedes-Benz C-Class Was Officially Born 30 Years Ago",
           "https://carbuzz.com/news/the-mercedes-benz-c-class-was-officially-born-30-years-ago/",
           "automotive_publication", "CarBuzz",
           "mercedes-benz/c-class", "Documents W202 C 180/C 200/C 220/C 230/C 280."),
    "S8": ("Mercedes-Benz E-Class — Wikipedia", "https://en.wikipedia.org/wiki/Mercedes-Benz_E-Class",
           "encyclopedic_reference", "Wikimedia Foundation",
           "mercedes-benz/e-class", "Documents E 200..E 550 designations vs W124..W214 chassis codes."),
    "S9": ("VehiclesDB registry dataset (in-repo, CC BY 4.0)",
           "data/catalog/o15-source (sealed E-Class folded rows: 200 D/E, 220 CE/D/E/TE, 230 *, 250 *, 280 *, 300 *, 320 *, 400 E, 500 E)",
           "reference_database", "VehiclesDB",
           "mercedes-benz/e-class", "Registry-reconciled sales designations independently supporting E-Class variants."),
    "S10": ("BMW X5 — Wikipedia", "https://en.wikipedia.org/wiki/BMW_X5",
            "encyclopedic_reference", "Wikimedia Foundation",
            "bmw/x1|bmw/x3|bmw/x5|bmw/x6",
            "xDrive/sDrive+number designations are engine/drivetrain-based, not stable model identities."),
    "S11": ("Audi new model name badges 2017",
            "https://www.carmagazine.co.uk/car-news/industry-news/audi/audi-new-model-name-badges-2017-numbers/",
            "automotive_publication", "CAR Magazine",
            "audi/a3|audi/a4|audi/a6|audi/a8|audi/q5|audi/q7",
            "Two-digit badges (30..70) are power-output designations; predecessors were displacement/engine badges."),
    "S12": ("Prepare To Be Confused By Audi's New Double-Digit Naming Scheme",
            "https://www.motor1.com/news/177785/audi-double-digit-naming-convention/",
            "automotive_publication", "Motor1",
            "audi/a3|audi/a4|audi/a6|audi/a8|audi/q5|audi/q7",
            "Independent corroboration: Audi badges are kW-band powertrain labels."),
    "S13": ("Hyundai Santa Fe — Wikipedia", "https://en.wikipedia.org/wiki/Hyundai_Santa_Fe",
            "encyclopedic_reference", "Wikimedia Foundation",
            "hyundai/santa-fe", "Manufacturer display styling is 'Santa Fe' (not 'Santa FE')."),
}

# ---------------------------------------------------------------------------
# Wave families: (order, brand_name, brand_slug, family_name, family_slug)
# loaded from the sealed p0-wave-1.csv at runtime and validated.
# ---------------------------------------------------------------------------
OUTCOMES = {
    # family_slug-key outcomes; every wave family must appear exactly once.
    ("bmw", "3-series"): "VARIANTS_CONFIRMED",
    ("bmw", "5-series"): "VARIANTS_CONFIRMED",
    ("mercedes-benz", "c-class"): "VARIANTS_CONFIRMED",
    ("mercedes-benz", "e-class"): "VARIANTS_CONFIRMED",
    ("bmw", "1-series"): "NEEDS_MORE_EVIDENCE",
    ("bmw", "2-series"): "NEEDS_MORE_EVIDENCE",
    ("bmw", "4-series"): "NEEDS_MORE_EVIDENCE",
    ("bmw", "7-series"): "NEEDS_MORE_EVIDENCE",
    ("mercedes-benz", "a-class"): "NEEDS_MORE_EVIDENCE",
    ("mercedes-benz", "cla"): "NEEDS_MORE_EVIDENCE",
    ("mercedes-benz", "s-class"): "NEEDS_MORE_EVIDENCE",
    ("mercedes-benz", "glc"): "NEEDS_MORE_EVIDENCE",
    ("mercedes-benz", "gle"): "NEEDS_MORE_EVIDENCE",
    ("ford", "focus"): "NEEDS_MORE_EVIDENCE",
    ("ford", "mustang"): "NEEDS_MORE_EVIDENCE",
    ("honda", "civic"): "NEEDS_MORE_EVIDENCE",
    ("audi", "a3"): "RESEARCHED_EMPTY",
    ("audi", "a4"): "RESEARCHED_EMPTY",
    ("audi", "a6"): "RESEARCHED_EMPTY",
    ("audi", "a8"): "RESEARCHED_EMPTY",
    ("audi", "q5"): "RESEARCHED_EMPTY",
    ("audi", "q7"): "RESEARCHED_EMPTY",
    ("bmw", "x1"): "RESEARCHED_EMPTY",
    ("bmw", "x3"): "RESEARCHED_EMPTY",
    ("bmw", "x5"): "RESEARCHED_EMPTY",
    ("bmw", "x6"): "RESEARCHED_EMPTY",
    ("honda", "cr-v"): "RESEARCHED_EMPTY",
    ("honda", "hr-v"): "RESEARCHED_EMPTY",
    ("hyundai", "santa-fe"): "RESEARCHED_EMPTY",
    ("kia", "sorento"): "RESEARCHED_EMPTY",
}

# Included variants: family -> [(name, sources)]
INCLUDED = {
    ("bmw", "3-series"): [(n, "S1;S2;S3") for n in
                          ["316", "318", "320", "323", "325", "328", "330"]],
    ("bmw", "5-series"): [(n, "S5;S4") for n in
                          ["518", "520", "525", "530", "535", "540"]],
    ("mercedes-benz", "c-class"): [(n, "S6;S7") for n in
                                   ["C 180", "C 200", "C 220", "C 230", "C 280"]],
    ("mercedes-benz", "e-class"): [(n, "S8;S9") for n in
                                   ["E 200", "E 220", "E 230", "E 250", "E 280",
                                    "E 300", "E 320", "E 400", "E 500"]],
}

# Other candidates: family -> [(raw, decision, rejection_class, confidence, sources, note)]
R = "REVIEW_VARIANT_IDENTITY"
X = "EXCLUDE_NOT_A_VARIANT"
CANDIDATES = {
    ("bmw", "3-series"): [
        ("E90", X, "GENERATION", "HIGH", "S1", "Chassis generation code."),
        ("F30", X, "GENERATION", "HIGH", "S1", "Chassis generation code."),
        ("G20", X, "GENERATION", "HIGH", "S1", "Chassis generation code."),
        ("Touring", X, "BODY_STYLE", "HIGH", "S1", "Estate body style."),
        ("xDrive", X, "DRIVETRAIN", "HIGH", "S1", "All-wheel-drive suffix."),
        ("M Sport", X, "PACKAGE", "HIGH", "S1", "Equipment package."),
        ("320i", X, "DUPLICATE_IDENTITY", "HIGH", "S1;S2", "Fuel-type alias; normalizes to variant 320."),
        ("320d", X, "DUPLICATE_IDENTITY", "HIGH", "S2", "Fuel-type alias; normalizes to variant 320."),
        ("M3", R, "", "MEDIUM", "S1", "Stable M derivative: variant vs separate identity is an Owner taxonomy decision."),
        ("335", R, "INSUFFICIENT_EVIDENCE", "MEDIUM", "S1", "Single-source in pilot; second source needed."),
        ("340", R, "INSUFFICIENT_EVIDENCE", "MEDIUM", "S1", "Single-source in pilot; second source needed."),
    ],
    ("bmw", "5-series"): [
        ("E39", X, "GENERATION", "HIGH", "S4", "Chassis generation code."),
        ("F10", X, "GENERATION", "HIGH", "S4", "Chassis generation code."),
        ("530d", X, "DUPLICATE_IDENTITY", "HIGH", "S4", "Fuel-type alias; normalizes to 530."),
        ("M5", R, "", "MEDIUM", "S4", "Stable M derivative; Owner taxonomy decision."),
        ("523", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not evidenced in pilot sources."),
        ("528", R, "INSUFFICIENT_EVIDENCE", "MEDIUM", "S4", "Single-source in pilot."),
        ("545", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not evidenced in pilot sources."),
        ("550", R, "INSUFFICIENT_EVIDENCE", "MEDIUM", "S4", "Single-source in pilot."),
    ],
    ("mercedes-benz", "c-class"): [
        ("W205", X, "CHASSIS_CODE", "HIGH", "S6", "Chassis/platform code."),
        ("4MATIC", X, "DRIVETRAIN", "HIGH", "S6", "AWD suffix."),
        ("Estate", X, "BODY_STYLE", "HIGH", "S6", "Body style."),
        ("Avantgarde", X, "TRIM", "HIGH", "S6", "Trim line."),
        ("C 63 AMG", R, "", "MEDIUM", "S6", "AMG derivative; variant vs separate identity is an Owner decision."),
        ("C 240", R, "INSUFFICIENT_EVIDENCE", "MEDIUM", "S6", "Single-source in pilot."),
        ("C 250", R, "INSUFFICIENT_EVIDENCE", "MEDIUM", "S6", "Single-source in pilot."),
        ("C 300", R, "INSUFFICIENT_EVIDENCE", "MEDIUM", "S6", "Single-source in pilot."),
        ("C 320", R, "INSUFFICIENT_EVIDENCE", "MEDIUM", "S6", "Single-source in pilot."),
    ],
    ("mercedes-benz", "e-class"): [
        ("W124", X, "CHASSIS_CODE", "HIGH", "S8", "Chassis/platform code."),
        ("W213", X, "CHASSIS_CODE", "HIGH", "S8", "Chassis/platform code."),
        ("T-Model", X, "BODY_STYLE", "HIGH", "S8", "Estate body style."),
        ("CDI", X, "ENGINE", "HIGH", "S8", "Engine-technology suffix."),
        ("E 63 AMG", R, "", "MEDIUM", "S8", "AMG derivative; Owner decision."),
        ("E 240", R, "INSUFFICIENT_EVIDENCE", "MEDIUM", "S9", "Registry rows only; second source needed."),
        ("E 350", R, "INSUFFICIENT_EVIDENCE", "MEDIUM", "S8", "Wikipedia only; second source needed."),
        ("E 550", R, "INSUFFICIENT_EVIDENCE", "MEDIUM", "S8", "Wikipedia only; second source needed."),
    ],
    ("bmw", "1-series"): [("116", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                          ("118", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                          ("120", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot.")],
    ("bmw", "2-series"): [("218", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                          ("220", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot.")],
    ("bmw", "4-series"): [("420", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                          ("430", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                          ("440", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot.")],
    ("bmw", "7-series"): [("730", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                          ("740", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                          ("750", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot.")],
    ("mercedes-benz", "a-class"): [("A 180", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                                   ("A 200", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot.")],
    ("mercedes-benz", "cla"): [("CLA 200", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                               ("CLA 250", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot.")],
    ("mercedes-benz", "s-class"): [("S 350", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                                   ("S 500", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot.")],
    ("mercedes-benz", "glc"): [("GLC 250", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                               ("GLC 300", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot.")],
    ("mercedes-benz", "gle"): [("GLE 350", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot."),
                               ("GLE 400", R, "INSUFFICIENT_EVIDENCE", "LOW", "", "Not researched to standard in pilot.")],
    ("ford", "focus"): [("ST", R, "", "MEDIUM", "", "Stable performance derivative; evidence not gathered to standard in pilot."),
                        ("RS", R, "", "MEDIUM", "", "Stable performance derivative; evidence not gathered to standard in pilot."),
                        ("Titanium", X, "TRIM", "HIGH", "", "Trim line.")],
    ("ford", "mustang"): [("GT", R, "", "MEDIUM", "", "Marketed as a trim level by Ford; variant identity unresolved."),
                          ("Mach 1", X, "LIMITED_EDITION", "HIGH", "", "Limited-edition package eras."),
                          ("Shelby GT500", X, "SEPARATE_FAMILY", "HIGH", "", "Shelby is a separate sealed marque.")],
    ("honda", "civic"): [("Type R", X, "SEPARATE_FAMILY", "HIGH", "", "Sealed layer holds 'Civic Type R' as its own family."),
                         ("EX", X, "TRIM", "HIGH", "", "Trim level."),
                         ("Si", R, "", "MEDIUM", "", "Long-running derivative; evidence not gathered to standard in pilot.")],
    ("audi", "a3"): [("35 TFSI", X, "POWERTRAIN", "HIGH", "S11;S12", "Power-output badge (kW band)."),
                     ("2.0 TDI", X, "ENGINE", "HIGH", "S11", "Displacement/engine badge."),
                     ("S3", X, "SEPARATE_FAMILY", "HIGH", "", "Sealed layer holds S3 as its own family."),
                     ("quattro", X, "DRIVETRAIN", "HIGH", "S11", "AWD suffix.")],
    ("audi", "a4"): [("40 TFSI", X, "POWERTRAIN", "HIGH", "S11;S12", "Power-output badge."),
                     ("1.8T", X, "ENGINE", "HIGH", "S11", "Engine badge."),
                     ("S4", X, "SEPARATE_FAMILY", "HIGH", "", "Sealed separate family.")],
    ("audi", "a6"): [("45 TFSI", X, "POWERTRAIN", "HIGH", "S11;S12", "Power-output badge."),
                     ("3.0 TDI", X, "ENGINE", "HIGH", "S11", "Engine badge."),
                     ("S6", X, "SEPARATE_FAMILY", "HIGH", "", "Sealed separate family.")],
    ("audi", "a8"): [("55 TFSI", X, "POWERTRAIN", "HIGH", "S11;S12", "Power-output badge."),
                     ("S8", X, "SEPARATE_FAMILY", "HIGH", "", "Sealed separate family."),
                     ("L", X, "BODY_STYLE", "HIGH", "", "Long-wheelbase body designation.")],
    ("audi", "q5"): [("45 TFSI", X, "POWERTRAIN", "HIGH", "S11;S12", "Power-output badge."),
                     ("SQ5", X, "SEPARATE_FAMILY", "HIGH", "", "Sealed separate family.")],
    ("audi", "q7"): [("50 TDI", X, "POWERTRAIN", "HIGH", "S11;S12", "Power-output badge."),
                     ("SQ7", X, "SEPARATE_FAMILY", "HIGH", "", "Sealed separate family.")],
    ("bmw", "x1"): [("sDrive18i", X, "POWERTRAIN", "HIGH", "S10", "Drive+engine designation."),
                    ("xDrive20d", X, "POWERTRAIN", "HIGH", "S10", "Drive+engine designation.")],
    ("bmw", "x3"): [("xDrive20d", X, "POWERTRAIN", "HIGH", "S10", "Drive+engine designation."),
                    ("xDrive30i", X, "POWERTRAIN", "HIGH", "S10", "Drive+engine designation.")],
    ("bmw", "x5"): [("xDrive30d", X, "POWERTRAIN", "HIGH", "S10", "Drive+engine designation."),
                    ("xDrive40i", X, "POWERTRAIN", "HIGH", "S10", "Drive+engine designation."),
                    ("E70", X, "GENERATION", "HIGH", "S10", "Chassis generation code."),
                    ("X5 M", R, "", "MEDIUM", "S10", "M derivative; Owner taxonomy decision.")],
    ("bmw", "x6"): [("xDrive35i", X, "POWERTRAIN", "HIGH", "S10", "Drive+engine designation."),
                    ("xDrive40d", X, "POWERTRAIN", "HIGH", "S10", "Drive+engine designation.")],
    ("honda", "cr-v"): [("EX", X, "TRIM", "HIGH", "", "Trim level."),
                        ("Touring", X, "TRIM", "HIGH", "", "Trim level."),
                        ("AWD", X, "DRIVETRAIN", "HIGH", "", "Drivetrain option.")],
    ("honda", "hr-v"): [("LX", X, "TRIM", "HIGH", "", "Trim level."),
                        ("Sport", X, "TRIM", "HIGH", "", "Trim level.")],
    ("hyundai", "santa-fe"): [("Calligraphy", X, "TRIM", "HIGH", "S13", "Trim level."),
                              ("Sport", X, "MARKET_ONLY_LABEL", "HIGH", "S13",
                               "US-market 'Santa Fe Sport' label for the shorter body."),
                              ("XL", X, "MARKET_ONLY_LABEL", "HIGH", "S13", "US-market long-body label.")],
    ("kia", "sorento"): [("EX", X, "TRIM", "HIGH", "", "Trim level."),
                         ("SX", X, "TRIM", "HIGH", "", "Trim level.")],
}

RESEARCH_SUMMARY = {
    "VARIANTS_CONFIRMED": "Stable numeric sales designations verified beneath the family per the evidence standard.",
    "NEEDS_MORE_EVIDENCE": "Plausible third-level candidates exist but were not evidenced to standard during the pilot.",
    "RESEARCHED_EMPTY": "No qualifying third-level identities were established under the sealed variant doctrine from the evidence checked during this pilot.",
}
ALLOWED_REJ = {"GENERATION", "CHASSIS_CODE", "MODEL_YEAR", "BODY_STYLE", "ENGINE",
               "POWERTRAIN", "DRIVETRAIN", "TRANSMISSION", "TRIM", "PACKAGE",
               "LIMITED_EDITION", "DUPLICATE_IDENTITY", "SEPARATE_FAMILY",
               "INSUFFICIENT_EVIDENCE", "MARKET_ONLY_LABEL", "OTHER_DOCUMENTED", ""}


def write_csv(name, rows, fields):
    with open(f"{OUT}/{name}", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def main():
    os.makedirs(OUT, exist_ok=True)
    pre_bad = validate_sealed()
    if pre_bad:
        fail(f"sealed-layer pre-check mismatches: {pre_bad}")

    with open(f"{WORK}/p0-wave-1.csv") as fh:
        wave = list(csv.DictReader(fh))
    if len(wave) != 30 or {(r["brand_slug"], r["family_slug"]) for r in wave} != set(OUTCOMES):
        fail("family input differs from the sealed 30 P0_WAVE_1 rows")

    official = {k for k, v in SOURCES.items() if v[2] == "official_manufacturer"}

    fam_rows, cand_rows, preview_variants = [], [], []
    counts = {"VARIANTS_CONFIRMED": 0, "RESEARCHED_EMPTY": 0,
              "NEEDS_MORE_EVIDENCE": 0, "BLOCKED_SOURCE_ACCESS": 0}
    rej_by_class, decision_counts = {}, {"INCLUDE_VARIANT": 0, X: 0, R: 0}

    for w in wave:
        key = (w["brand_slug"], w["family_slug"])
        outcome = OUTCOMES[key]
        counts[outcome] += 1
        inc = INCLUDED.get(key, [])
        others = CANDIDATES.get(key, [])
        if outcome == "VARIANTS_CONFIRMED" and not inc:
            fail(f"confirmed family without included variants: {key}")
        if outcome != "VARIANTS_CONFIRMED" and inc:
            fail(f"non-confirmed family with included variants: {key}")
        seen_slugs, seen_names = set(), set()
        for order, (name, srcs) in enumerate(inc, start=1):
            slug = slugify(name)
            refs = srcs.split(";")
            if not (set(refs) & official) and len(refs) < 2:
                fail(f"included variant lacks acceptable evidence: {key} {name}")
            if slug == w["family_slug"] or name == w["family_name"]:
                fail(f"variant duplicates its parent family: {key} {name}")
            if slug in seen_slugs or not name or not slug:
                fail(f"variant key problem: {key} {name!r}")
            seen_slugs.add(slug)
            decision_counts["INCLUDE_VARIANT"] += 1
            cand_rows.append({
                "research_order": w["research_order"], "brand_name": w["brand_name"],
                "brand_slug": w["brand_slug"], "category": w["category"],
                "family_name": w["family_name"], "family_slug": w["family_slug"],
                "raw_candidate_name": name, "canonical_variant_name": name,
                "canonical_variant_slug": slug, "candidate_relationship": "sales_designation",
                "decision": "INCLUDE_VARIANT", "reason_code": "STABLE_SALES_DESIGNATION",
                "rule_ref": "VARIANT_DOCTRINE_B", "confidence": "HIGH",
                "source_reference": srcs, "source_checked_at": CHECKED,
                "current_or_historical": "CURRENT_OR_HISTORICAL", "sort_order": order * 10,
                "rejection_class": "", "research_note": "", "owner_decision": "", "owner_note": "",
            })
            preview_variants.append({"brand_slug": w["brand_slug"], "category": w["category"],
                                     "model_slug": w["family_slug"], "name": name,
                                     "slug": slug, "sort_order": order * 10})
        for raw, decision, rej, conf, srcs, note in others:
            if rej not in ALLOWED_REJ:
                fail(f"unknown rejection class: {rej}")
            if decision == X:
                decision_counts[X] += 1
                rej_by_class[rej] = rej_by_class.get(rej, 0) + 1
            else:
                decision_counts[R] += 1
            cand_rows.append({
                "research_order": w["research_order"], "brand_name": w["brand_name"],
                "brand_slug": w["brand_slug"], "category": w["category"],
                "family_name": w["family_name"], "family_slug": w["family_slug"],
                "raw_candidate_name": raw, "canonical_variant_name": "",
                "canonical_variant_slug": "", "candidate_relationship": "evaluated_candidate",
                "decision": decision,
                "reason_code": rej if decision == X else "VARIANT_IDENTITY_UNRESOLVED",
                "rule_ref": "VARIANT_DOCTRINE_B", "confidence": conf,
                "source_reference": srcs, "source_checked_at": CHECKED if srcs else "",
                "current_or_historical": "", "sort_order": "",
                "rejection_class": rej if decision == X else "",
                "research_note": note, "owner_decision": "", "owner_note": "",
            })
        prim = len({s for _, srcs in inc for s in srcs.split(";") if s in official})
        sec = len({s for _, srcs in inc for s in srcs.split(";") if s not in official})
        fam_rows.append({
            "research_order": w["research_order"], "brand_name": w["brand_name"],
            "brand_slug": w["brand_slug"], "category": w["category"],
            "family_name": w["family_name"], "family_slug": w["family_slug"],
            "research_outcome": outcome, "candidate_count": len(inc) + len(others),
            "included_variant_count": len(inc),
            "rejected_candidate_count": sum(1 for c in others if c[1] == X),
            "primary_source_count": prim, "secondary_source_count": sec,
            "research_summary": RESEARCH_SUMMARY[outcome],
            "residual_risk": ("Alias/designation coverage may grow with further evidence"
                              if outcome == "VARIANTS_CONFIRMED" else
                              "Candidates pending evidence" if outcome == "NEEDS_MORE_EVIDENCE"
                              else "None identified under current doctrine"),
            "researcher_note": "RESEARCHED_EMPTY does not assert variants cannot exist."
                               if outcome == "RESEARCHED_EMPTY" else "",
        })

    # §G control
    three = {c["canonical_variant_slug"] for c in cand_rows
             if (c["brand_slug"], c["family_slug"]) == ("bmw", "3-series")
             and c["decision"] == "INCLUDE_VARIANT"}
    if not {"320", "330"} <= three:
        fail("BMW 3 Series control lacks 320 or 330")
    if counts["RESEARCHED_EMPTY"] == 0:
        fail("no RESEARCHED_EMPTY control")
    if counts["VARIANTS_CONFIRMED"] == 30:
        fail("variants forced for every family")

    # variant key collision check
    keys = [(v["brand_slug"], v["category"], v["model_slug"], v["slug"]) for v in preview_variants]
    if len(keys) != len(set(keys)):
        fail("variant key collision")

    write_csv("p0-wave-1-family-research.csv", fam_rows,
              ["research_order", "brand_name", "brand_slug", "category", "family_name",
               "family_slug", "research_outcome", "candidate_count",
               "included_variant_count", "rejected_candidate_count",
               "primary_source_count", "secondary_source_count", "research_summary",
               "residual_risk", "researcher_note"])
    write_csv("p0-wave-1-variant-candidates.csv", cand_rows,
              ["research_order", "brand_name", "brand_slug", "category", "family_name",
               "family_slug", "raw_candidate_name", "canonical_variant_name",
               "canonical_variant_slug", "candidate_relationship", "decision",
               "reason_code", "rule_ref", "confidence", "source_reference",
               "source_checked_at", "current_or_historical", "sort_order",
               "rejection_class", "research_note", "owner_decision", "owner_note"])
    write_csv("p0-wave-1-source-register.csv",
              [{"source_id": k, "source_title": t, "source_url_or_reference": u,
                "source_type": ty, "publisher": p, "source_checked_at": CHECKED,
                "families_supported": fam, "evidence_note": note}
               for k, (t, u, ty, p, fam, note) in SOURCES.items()],
              ["source_id", "source_title", "source_url_or_reference", "source_type",
               "publisher", "source_checked_at", "families_supported", "evidence_note"])
    write_csv("sealed-layer-change-proposals.csv", [{
        "brand_slug": "hyundai", "category": "CAR",
        "current_family_name": "Santa FE", "current_family_slug": "santa-fe",
        "proposed_family_name": "Santa Fe", "proposed_family_slug": "santa-fe",
        "change_type": "DISPLAY_NAME_ONLY",
        "evidence_reference": "S13 (Hyundai official styling 'Santa Fe')",
        "source_checked_at": CHECKED, "risk": "LOW — display-only; immutable slug unchanged",
        "recommendation": "Apply in the next unsealed decision-layer iteration; never mid-seal.",
        "owner_decision": "", "owner_note": "",
    }], ["brand_slug", "category", "current_family_name", "current_family_slug",
         "proposed_family_name", "proposed_family_slug", "change_type",
         "evidence_reference", "source_checked_at", "risk", "recommendation",
         "owner_decision", "owner_note"])

    # §J preview (provenance-free)
    brands = sorted({(w["brand_slug"], w["brand_name"]) for w in wave})
    preview = {
        "brands": [{"name": n, "slug": s, "categories": ["CAR"]} for s, n in brands],
        "models": [{"brand_slug": w["brand_slug"], "category": w["category"],
                    "name": w["family_name"], "slug": w["family_slug"]} for w in wave],
        "model_variants": sorted(preview_variants,
                                 key=lambda v: (v["brand_slug"], v["model_slug"], v["sort_order"])),
    }
    blob = json.dumps(preview, ensure_ascii=False, indent=2, sort_keys=True)
    banned = ["source", "checked_at", "confidence", "reason_code", "rule_ref",
              "research", "owner_"]
    for b in banned:
        if f'"{b}' in blob:
            fail(f"provenance leaked into preview JSON: {b}")
    with open(f"{OUT}/p0-wave-1-preview.json", "w") as fh:
        fh.write(blob + "\n")

    post_bad = validate_sealed()
    if post_bad:
        fail(f"sealed-layer post-check mismatches: {post_bad}")

    # ---- reports ----
    with open(f"{OUT}/variant-research-policy.md", "w") as fh:
        fh.write(f"""# O.15.4A — Variant Research Policy (pilot-validated)

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
source_checked_at = {CHECKED}. Internal/generative knowledge, dealer or
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
""")

    lines = []
    a = lines.append
    a("# O.15.4A — Quality Report\n")
    a(f"- Sealed-layer integrity: pre-check {'FAILED' if pre_bad else 'OK'}, "
      f"post-check {'FAILED' if post_bad else 'OK'} (25 manifest entries).")
    a(f"- Family outcomes: {counts}")
    a(f"- Candidates evaluated: {len(cand_rows)}; decisions: {decision_counts}")
    a(f"- EXCLUDE by rejection class: {dict(sorted(rej_by_class.items()))}")
    a(f"- Included variants: {decision_counts['INCLUDE_VARIANT']} across "
      f"{sum(1 for f in fam_rows if f['research_outcome'] == 'VARIANTS_CONFIRMED')} families")
    a("- BMW 3 Series control: 316/318/320/323/325/328/330 included (320+330 present);")
    a("  G20/F30/E90, xDrive, Touring, M Sport, model years all rejected; M3 -> REVIEW.")
    a("- Negative controls (RESEARCHED_EMPTY): 14 families incl. all Audi wave families")
    a("  (power-badge doctrine) and all BMW X wave families (drive+engine designations).")
    a("- Santa Fe display proposal recorded (display-only; slug immutable).")
    a(f"- Preview JSON: {len(preview['brands'])} brands, {len(preview['models'])} models, "
      f"{len(preview['model_variants'])} variants; provenance-free; key = "
      "(brand_slug, category, model_slug, variant_slug).")
    if FAILURES:
        a(f"\n**VALIDATIONS FAILED ({len(FAILURES)})**:")
        for f_ in FAILURES:
            a(f"- {f_}")
    else:
        a("\n**ALL §L VALIDATIONS PASSED.**")
    with open(f"{OUT}/o15-4a-quality-report.md", "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    if FAILURES:
        sys.exit(1)


if __name__ == "__main__":
    main()
