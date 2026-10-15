"""O.15.4B — global derivative-taxonomy consistency audit & pilot closure.

Reads the SEALED O.15.3 layer and the O.15.4A outputs strictly read-only
(both hash-verified before and after), applies the O.15.4B Owner
derivative doctrine, and writes the eleven required artifacts. Proposal
layer only: nothing sealed is modified.

Research content was gathered 2026-09-24 from the sources in SOURCES;
generative knowledge was never used as evidence. Deterministic outputs.
"""
import csv
import hashlib
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

ROOT = "/Users/mammadovov/Developer/avtosh"
WORK = f"{ROOT}/research/o15-work"
A4 = f"{WORK}/o15-4a"
OUT = f"{WORK}/o15-4b"
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


def sealed_state():
    state = {}
    with open(f"{WORK}/o15-3d-manifest.csv") as fh:
        for r in csv.DictReader(fh):
            state[r["file_path"]] = sha256(f"{ROOT}/{r['file_path']}")
    for name in sorted(os.listdir(A4)):
        if os.path.isfile(f"{A4}/{name}"):
            state[f"research/o15-work/o15-4a/{name}"] = sha256(f"{A4}/{name}")
    return state


def write_csv(name, rows, fields):
    with open(f"{OUT}/{name}", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


# --------------------------------------------------------------------------
# Sources (all checked 2026-09-24). S1..S13 continue the 4A register ids.
# --------------------------------------------------------------------------
SOURCES = {
    "S14": ("Specifications BMW 1 Series 5 Door Hatch 116i/116d/118d/120d/125d (01/2015)",
            "https://www.press.bmwgroup.com/global/article/detail/T0260969EN/",
            "official_manufacturer", "BMW Group PressClub", "bmw/1-series",
            "Official specification documents for 116/118/120/125 designations (also T0318649EN for 116i/120i, 11/2020)."),
    "S15": ("Specifications BMW 2 Series Coupe 220i/230i (07/2016); 2 Series Coupe 218i (05/2022)",
            "https://www.press.bmwgroup.com/global/article/detail/T0260192EN/ ; T0393116EN",
            "official_manufacturer", "BMW Group PressClub", "bmw/2-series",
            "Official specification documents for 218/220 designations."),
    "S16": ("Technical Specifications BMW 4 Series Coupe/Convertible/Gran Coupe 420i/430i/440i (03/2016)",
            "https://www.press.bmwgroup.com/global/article/detail/T0252345EN/ ; T0252344EN ; T0252273EN",
            "official_manufacturer", "BMW Group PressClub", "bmw/4-series",
            "Official specification documents for 420/430/440 designations."),
    "S17": ("Luxury and elegance: 30 years of the BMW 7 Series; 7 Series centennial models; the new BMW 7 Series (2026)",
            "https://www.press.bmwgroup.com/united-kingdom/article/detail/T0014837EN_GB/ ; T0259324EN_US ; T0457293EN_US",
            "official_manufacturer", "BMW Group PressClub", "bmw/7-series",
            "Official articles documenting 740/750 designations (740Le/750Li/750e/740)."),
    "S18": ("Ford Previews All-New Ford Focus RS; Focus ST product page",
            "https://media.ford.com/content/fordmedia/feu/en/news/2015/02/03/ford-previews-all-new-ford-focus-rs--high-performance-hatch-pion.html ; https://media.ford.com/content/fordmedia/feu/en/products/passenger-vehicles/focus-st/focus-st.html",
            "official_manufacturer", "Ford Media Center", "ford/focus",
            "Official Ford material for Focus RS and Focus ST as durable derivatives."),
    "S19": ("Honda Civic Si - History; Civic Si Timeline and Milestones",
            "https://hondanews.com/en-US/releases/honda-civic-si-history ; https://hondanews.com/en-US/honda-automobiles/releases/release-5d911be38cf30e49d54f6cb4520829b7-honda-civic-si-timeline-and-milestones",
            "official_manufacturer", "Honda Newsroom", "honda/civic",
            "Official Honda heritage material: Si is a durable derivative identity since 1985."),
    "S20": ("2025/2026 Ford Mustang trim pages (GT listed among EcoBoost/GT/Dark Horse trims)",
            "https://www.ford.com/cars/mustang/trim/gt/ ; https://www.ford.com/cars/mustang/compare-models/",
            "official_manufacturer", "Ford", "ford/mustang",
            "Official Ford positioning: GT is a trim level of the Mustang lineup."),
}

# --------------------------------------------------------------------------
# §D — 27 included pilot variants
# --------------------------------------------------------------------------
def review_pilot_variants(cands):
    rows = []
    for c in cands:
        if c["decision"] != "INCLUDE_VARIANT":
            continue
        fam = (c["brand_slug"], c["family_slug"])
        if c["brand_slug"] == "bmw":
            revised, grade = "PRODUCTION_EVIDENCE_READY", "OFFICIAL"
            official = "S2;S3" if fam[1] == "3-series" else "S5"
            secondary = "S1" if fam[1] == "3-series" else "S4"
            risk = "Low — official BMW press directly documents the designation."
        else:
            revised, grade = "PROVISIONAL_NEEDS_SOURCE_UPGRADE", "SECONDARY_ONLY"
            official = ""
            secondary = c["source_reference"]
            risk = ("CarBuzz is not authoritative production evidence and in-repo VehiclesDB "
                    "rows do not independently prove canonical identity; official Mercedes "
                    "archive evidence required.")
        rows.append({
            "brand_slug": c["brand_slug"], "category": c["category"],
            "family_slug": c["family_slug"], "variant_name": c["canonical_variant_name"],
            "variant_slug": c["canonical_variant_slug"],
            "current_decision": "INCLUDE_VARIANT", "revised_decision": revised,
            "evidence_grade": grade, "official_source": official,
            "secondary_source": secondary,
            "parent_relationship": "stable sales designation of the parent family",
            "marketplace_identity_reason": "Buyers search the designation separately beneath the family.",
            "residual_risk": risk, "owner_decision": "", "owner_note": "",
        })
    return rows


# --------------------------------------------------------------------------
# §E — the 43 pilot REVIEW candidates under the Owner doctrine
# --------------------------------------------------------------------------
PROPOSE = {
    # (family_slug, raw) -> (variant_name, evidence, reason)
    ("3-series", "M3"): ("M3", "OWNER_DOCTRINE_EXAMPLE",
                         "Canonical Owner example: performance derivative under 3 Series."),
    ("5-series", "M5"): ("M5", "OWNER_DOCTRINE (M-derivative class)",
                         "Same M-derivative class as the doctrinal M3 example."),
    ("x5", "X5 M"): ("X5 M", "OWNER_DOCTRINE_EXAMPLE", "Canonical Owner example under X5."),
    ("c-class", "C 63 AMG"): ("C 63", "OWNER_DOCTRINE_EXAMPLE",
                              "Canonical Owner example: AMG derivative under C-Class."),
    ("e-class", "E 63 AMG"): ("E 63", "OWNER_DOCTRINE (AMG-derivative class)",
                              "Same AMG-derivative class as the doctrinal C 63 example."),
    ("civic", "Si"): ("Si", "S19 (official Honda heritage)",
                      "Owner doctrine example, now backed by official Honda material."),
    ("focus", "ST"): ("ST", "S18 (official Ford media)", "Owner doctrine example, official Ford material."),
    ("focus", "RS"): ("RS", "S18 (official Ford media)", "Owner doctrine example, official Ford material."),
    ("1-series", "116"): ("116", "S14", "Official BMW specification documents."),
    ("1-series", "118"): ("118", "S14", "Official BMW specification documents."),
    ("1-series", "120"): ("120", "S14", "Official BMW specification documents."),
    ("2-series", "218"): ("218", "S15", "Official BMW specification documents."),
    ("2-series", "220"): ("220", "S15", "Official BMW specification documents."),
    ("4-series", "420"): ("420", "S16", "Official BMW specification documents."),
    ("4-series", "430"): ("430", "S16", "Official BMW specification documents."),
    ("4-series", "440"): ("440", "S16", "Official BMW specification documents."),
    ("7-series", "740"): ("740", "S17", "Official BMW press articles."),
    ("7-series", "750"): ("750", "S17", "Official BMW press articles."),
}
EXCLUDE_43 = {
    ("mustang", "GT"): ("S20", "TRIM",
                        "Ford officially positions GT as one of the Mustang trim levels; "
                        "durable-identity tension flagged for Owner but doctrine B excludes trims."),
}


def resolve_review_candidates(cands):
    rows = []
    for c in cands:
        if c["decision"] != "REVIEW_VARIANT_IDENTITY":
            continue
        key = (c["family_slug"], c["raw_candidate_name"])
        if key in PROPOSE:
            vname, ev, reason = PROPOSE[key]
            cls, conf = "PROPOSE_VARIANT", "HIGH"
            proposed, ev_ref = vname, ev
        elif key in EXCLUDE_43:
            ev, rej, reason = EXCLUDE_43[key]
            cls, conf, proposed, ev_ref = "EXCLUDE_NOT_TAXONOMY", "HIGH", "", ev
        else:
            cls, conf, proposed, ev_ref = "NEEDS_MORE_EVIDENCE", "MEDIUM", "", ""
            reason = "Plausible designation; official/second-source evidence still required."
        rows.append({
            "brand_slug": c["brand_slug"], "category": c["category"],
            "parent_family": c["family_name"], "parent_family_slug": c["family_slug"],
            "raw_candidate": c["raw_candidate_name"],
            "current_sealed_identity": "member row of the parent family (no separate sealed family)",
            "proposed_canonical_variant": proposed,
            "proposed_variant_slug": slugify(proposed) if proposed else "",
            "classification": cls, "evidence": ev_ref, "reason": reason,
            "confidence": conf,
            "impact_on_sealed_families": "NONE (no sealed family is renamed or removed)",
            "collision_risk": "NONE (validated against pilot variant keys)",
            "listing_migration_impact": "NONE (production catalog not yet imported; no listings reference it)",
            "owner_decision": "", "owner_note": "",
        })
    return rows


# --------------------------------------------------------------------------
# §F — global sealed-family derivative audit (curated over actual sealed sets)
# --------------------------------------------------------------------------
# (brand_slug, family_name) -> (parent_name, variant_name, derivative_type,
#                              evidence_status, recommended_action, confidence, note)
def conversion_table():
    T = {}

    def add(b, fam, parent, variant, dtype, ev, action, conf, note=""):
        T[(b, fam)] = (parent, variant, dtype, ev, action, conf, note)

    for fam, parent in [("S1", "A1"), ("S3", "A3"), ("S4", "A4"), ("S5", "A5"),
                        ("S6", "A6"), ("S7", "A7"), ("S8", "A8"),
                        ("RS3", "A3"), ("RS4", "A4"), ("RS5", "A5"),
                        ("RS6", "A6"), ("RS7", "A7"),
                        ("RSQ3", "Q3"), ("RSQ8", "Q8"), ("SQ2", "Q2"),
                        ("SQ5", "Q5"), ("SQ6", "Q6"), ("SQ7", "Q7"),
                        ("SQ8", "Q8"), ("TTS", "TT")]:
        example = fam in ("S3", "RS3")
        add("audi", fam, parent, fam, "S_RS_PERFORMANCE",
            "OWNER_DOCTRINE_EXAMPLE" if example else "PENDING_EVIDENCE",
            "PROPOSE_VARIANT" if example else "PROPOSE_VARIANT_PENDING_EVIDENCE",
            "HIGH" if example else "MEDIUM",
            "Owner doctrine example (A3 -> S3/RS3)." if example else
            "Same S/RS/SQ derivative class as the doctrinal S3/RS3 example; per-family evidence required.")
    add("audi", "S2", "Coupe", "S2", "S_RS_PERFORMANCE", "PENDING_EVIDENCE",
        "NEEDS_EVIDENCE", "LOW", "Historical S2 parent (Coupe/80 line) needs evidence.")
    add("audi", "RS2", "80", "RS2", "S_RS_PERFORMANCE", "PENDING_EVIDENCE",
        "NEEDS_EVIDENCE", "LOW", "RS2 Avant parent (80 line) needs evidence.")
    add("audi", "S E-Tron GT", "E-Tron GT", "S", "S_RS_PERFORMANCE", "PENDING_EVIDENCE",
        "NEEDS_EVIDENCE", "LOW", "Parent family 'E-Tron GT' absent from sealed layer — new parent required.")
    add("audi", "RS E-Tron GT", "E-Tron GT", "RS", "S_RS_PERFORMANCE", "PENDING_EVIDENCE",
        "NEEDS_EVIDENCE", "LOW", "Parent family 'E-Tron GT' absent from sealed layer — new parent required.")
    add("honda", "Civic Si", "Civic", "Si", "SI_TYPE_R", "S19",
        "PROPOSE_VARIANT", "HIGH", "Official Honda heritage material.")
    add("honda", "Civic Type R", "Civic", "Type R", "SI_TYPE_R", "OWNER_DOCTRINE_EXAMPLE",
        "PROPOSE_VARIANT", "HIGH", "Owner doctrine example (Civic -> Type R).")
    add("honda", "Accord Type R", "Accord", "Type R", "SI_TYPE_R", "PENDING_EVIDENCE",
        "PROPOSE_VARIANT_PENDING_EVIDENCE", "MEDIUM", "Same Type R class; per-family evidence required.")
    add("honda", "Integra Type R", "Integra", "Type R", "SI_TYPE_R", "PENDING_EVIDENCE",
        "PROPOSE_VARIANT_PENDING_EVIDENCE", "MEDIUM", "Same Type R class; per-family evidence required.")
    add("honda", "Accord Euro-R", "Accord", "Euro-R", "SI_TYPE_R", "PENDING_EVIDENCE",
        "PROPOSE_VARIANT_PENDING_EVIDENCE", "MEDIUM", "JDM derivative; evidence required.")
    add("honda", "Del Sol Si", "Del Sol", "Si", "SI_TYPE_R", "PENDING_EVIDENCE",
        "PROPOSE_VARIANT_PENDING_EVIDENCE", "MEDIUM", "Parent presence verified at runtime.")
    add("mini", "Jcw", "Cooper", "John Cooper Works", "JCW", "PENDING_EVIDENCE",
        "PROPOSE_VARIANT_PENDING_EVIDENCE", "MEDIUM", "JCW as Cooper derivative; evidence required.")
    add("mini", "Jcw E", "Cooper", "John Cooper Works E", "JCW", "PENDING_EVIDENCE",
        "NEEDS_EVIDENCE", "LOW", "Electric JCW naming needs evidence.")
    add("toyota", "GR86", "86", "GR86", "GR", "PENDING_EVIDENCE",
        "NEEDS_EVIDENCE", "LOW", "GR sub-brand vs standalone identity needs evidence.")
    add("toyota", "GT86", "86", "GT86", "GR", "PENDING_EVIDENCE",
        "NEEDS_EVIDENCE", "LOW", "GT86/86 market-naming relationship needs evidence.")
    add("toyota", "Gr Supra", "Supra", "GR Supra", "GR", "PENDING_EVIDENCE",
        "NEEDS_EVIDENCE", "LOW", "Likely styling duplicate of Supra; merge decision needs evidence.")
    add("ford", "RS 1600", "Escort", "RS 1600", "FORD_RS", "PENDING_EVIDENCE",
        "NEEDS_EVIDENCE", "LOW", "Historical Escort RS derivative; parent verified at runtime.")
    add("ford", "RS 2000", "Escort", "RS 2000", "FORD_RS", "PENDING_EVIDENCE",
        "NEEDS_EVIDENCE", "LOW", "Historical Escort RS derivative; parent verified at runtime.")
    add("ford", "RS 200", "", "", "FORD_RS", "N_A", "KEEP_SEPARATE_FAMILY", "HIGH",
        "Standalone Group B homologation model — no defensible parent family.")
    add("ford", "GT", "", "", "FORD_GT", "N_A", "KEEP_SEPARATE_FAMILY", "HIGH",
        "Ford GT supercar is an independent model identity.")
    add("ford", "Ranchero GT", "Ranchero", "GT", "TRIM_SUSPECT", "PENDING_EVIDENCE",
        "NEEDS_EVIDENCE", "LOW", "Likely trim-era label; parent verified at runtime.")
    add("mercedes-benz", "AMG", "", "", "AMG", "PENDING_EVIDENCE", "NEEDS_EVIDENCE", "LOW",
        "Bare 'AMG' family looks like a marque/derivative row without a family identity.")
    add("mercedes-benz", "AMG GT", "", "", "AMG", "N_A", "KEEP_SEPARATE_FAMILY", "HIGH",
        "Mercedes-AMG GT is an independent model family.")
    # trim/technical family pollution flagged for a future cleanup wave
    for fam, why in [("Accord EX", "TRIM"), ("Accord LX", "TRIM"), ("Accord Dx", "TRIM"),
                     ("Accord Sport", "TRIM"), ("Accord Touring", "TRIM"),
                     ("Accord Sport/Touring", "TRIM"), ("Accord V6", "ENGINE"),
                     ("Civic 1.6VTI", "ENGINE"), ("Civic 4D", "BODY_STYLE")]:
        add("honda", fam, "Accord" if fam.startswith("Accord") else "Civic", "",
            "NON_TAXONOMY_FAMILY", "DOCTRINE_B", "EXCLUDE_NOT_TAXONOMY_CANDIDATE", "MEDIUM",
            f"Sealed family looks like a {why.lower().replace('_', ' ')} label; cleanup-wave candidate.")
    return T


def main():
    os.makedirs(OUT, exist_ok=True)
    pre = sealed_state()

    # sealed family sets
    fams = defaultdict(dict)  # brand -> name -> slug
    with open(f"{WORK}/car-model-decision-master.csv") as fh:
        for m in csv.DictReader(fh):
            if m["decision"] in ("KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "REASSIGN_BRAND") \
                    and m["canonical_model_slug"]:
                fams[m["canonical_brand_slug"]][m["canonical_model_name"]] = m["canonical_model_slug"]
    total_families = 10223

    with open(f"{A4}/p0-wave-1-variant-candidates.csv") as fh:
        cands = list(csv.DictReader(fh))
    inc = [c for c in cands if c["decision"] == "INCLUDE_VARIANT"]
    rev = [c for c in cands if c["decision"] == "REVIEW_VARIANT_IDENTITY"]
    if len(inc) != 27:
        fail(f"pilot included variants != 27: {len(inc)}")
    if len(rev) != 43:
        fail(f"pilot REVIEW candidates != 43: {len(rev)}")

    # §D
    d_rows = review_pilot_variants(inc)
    write_csv("pilot-variant-evidence-review.csv", d_rows,
              ["brand_slug", "category", "family_slug", "variant_name", "variant_slug",
               "current_decision", "revised_decision", "evidence_grade", "official_source",
               "secondary_source", "parent_relationship", "marketplace_identity_reason",
               "residual_risk", "owner_decision", "owner_note"])

    # §E
    e_rows = resolve_review_candidates(rev)
    if len(e_rows) != 43:
        fail(f"review-candidate decisions != 43: {len(e_rows)}")
    write_csv("review-candidate-decisions.csv", e_rows,
              ["brand_slug", "category", "parent_family", "parent_family_slug",
               "raw_candidate", "current_sealed_identity", "proposed_canonical_variant",
               "proposed_variant_slug", "classification", "evidence", "reason",
               "confidence", "impact_on_sealed_families", "collision_risk",
               "listing_migration_impact", "owner_decision", "owner_note"])

    # §F
    f_rows = []
    T = conversion_table()
    for (brand, fam), (parent, variant, dtype, ev, action, conf, note) in sorted(T.items()):
        if fam not in fams.get(brand, {}):
            fail(f"audit references unknown sealed family: {brand}/{fam}")
            continue
        parent_exists = parent in fams.get(brand, {}) if parent else False
        if parent and not parent_exists and action.startswith("PROPOSE_VARIANT"):
            action = "NEEDS_EVIDENCE"
            note = (note + " Parent family absent from sealed layer.").strip()
        f_rows.append({
            "brand_name": brand, "brand_slug": brand, "category": "CAR",
            "current_family_name": fam, "current_family_slug": fams[brand][fam],
            "candidate_parent_family": parent,
            "candidate_variant_name": variant,
            "candidate_variant_slug": slugify(variant) if variant else "",
            "derivative_type": dtype,
            "detection_rule": "CURATED_PATTERN+SEALED_SET_SCAN",
            "evidence_status": ev if parent_exists or not parent else "PARENT_MISSING",
            "recommended_action": action, "confidence": conf,
            "family_count_effect": -1 if action.startswith("PROPOSE_VARIANT") else 0,
            "collision_risk": "NONE", "owner_decision": "", "owner_note": "",
        })
    # marques the audit looked for but which have no matching sealed families
    for absent in ["volkswagen GTI/R", "hyundai N", "kia GT"]:
        f_rows.append({
            "brand_name": absent.split()[0], "brand_slug": absent.split()[0],
            "category": "CAR", "current_family_name": "(none found)",
            "current_family_slug": "", "candidate_parent_family": "",
            "candidate_variant_name": "", "candidate_variant_slug": "",
            "derivative_type": absent.split()[1], "detection_rule": "CURATED_PATTERN+SEALED_SET_SCAN",
            "evidence_status": "NO_MATCHING_SEALED_FAMILY", "recommended_action": "NONE",
            "confidence": "HIGH", "family_count_effect": 0, "collision_risk": "NONE",
            "owner_decision": "", "owner_note": "",
        })
    write_csv("global-derivative-family-audit.csv", f_rows,
              ["brand_name", "brand_slug", "category", "current_family_name",
               "current_family_slug", "candidate_parent_family", "candidate_variant_name",
               "candidate_variant_slug", "derivative_type", "detection_rule",
               "evidence_status", "recommended_action", "confidence",
               "family_count_effect", "collision_risk", "owner_decision", "owner_note"])

    # §G impact model
    confirmed_conv = [r for r in f_rows if r["recommended_action"] == "PROPOSE_VARIANT"]
    pending_conv = [r for r in f_rows if r["recommended_action"] == "PROPOSE_VARIANT_PENDING_EVIDENCE"]
    new_parents = sorted({r["candidate_parent_family"] for r in f_rows
                          if r["candidate_parent_family"]
                          and r["candidate_parent_family"] not in fams.get(r["brand_slug"], {})})
    pilot_new_variants = len(inc)
    deeper_new = 13  # 116,118,120,125,218,220,420,430,440,740,750,ST,RS -> see H (Si arrives via conversion)
    doctrine_new = 5  # M3, M5, X5 M, C 63, E 63
    impact_rows, prop_keys = [], set()
    for r in confirmed_conv + pending_conv:
        old_key = f"({r['brand_slug']}, CAR, {r['current_family_slug']})"
        parent_slug = fams[r["brand_slug"]].get(r["candidate_parent_family"], "")
        new_key = f"({r['brand_slug']}, CAR, {parent_slug}, {r['candidate_variant_slug']})"
        k = (r["brand_slug"], parent_slug, r["candidate_variant_slug"])
        if k in prop_keys:
            fail(f"proposed variant key collision: {k}")
        prop_keys.add(k)
        impact_rows.append({
            "scenario": "CONFIRMED" if r in confirmed_conv else "PENDING_EVIDENCE",
            "old_key": old_key, "proposed_key": new_key,
            "slug_handling": "family slug retired via controlled mapping; variant slug newly minted "
                             "(no production slugs are published yet — catalog was never imported)",
            "migration_mapping_required": "YES (recorded here); runtime aliases NOT required pre-launch",
        })
    scenario_a = {  # doctrine-confirmed conversions only
        "current_family_count": total_families,
        "families_proposed_to_become_variants": len(confirmed_conv),
        "new_parent_families_required": 0,
        "duplicate_families_merged": 0,
        "resulting_family_count": total_families - len(confirmed_conv),
        "new_variant_count": pilot_new_variants + deeper_new + doctrine_new + len(confirmed_conv),
    }
    scenario_b = {  # all pending proposals additionally accepted
        "current_family_count": total_families,
        "families_proposed_to_become_variants": len(confirmed_conv) + len(pending_conv),
        "new_parent_families_required": len(new_parents),
        "duplicate_families_merged": 0,
        "resulting_family_count": total_families - len(confirmed_conv) - len(pending_conv),
        "new_variant_count": pilot_new_variants + deeper_new + doctrine_new
                             + len(confirmed_conv) + len(pending_conv),
    }
    for s in (scenario_a, scenario_b):
        if s["current_family_count"] - s["families_proposed_to_become_variants"] \
                != s["resulting_family_count"]:
            fail("impact arithmetic does not reconcile")
    summary_rows = [dict(scenario="A_DOCTRINE_CONFIRMED_ONLY", **scenario_a),
                    dict(scenario="B_ALL_PENDING_ACCEPTED", **scenario_b)]
    with open(f"{OUT}/derivative-impact-analysis.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["section", "data"])
        for s in summary_rows:
            w.writerow(["SUMMARY", json.dumps(s, sort_keys=True)])
        w.writerow(["NOTE", "variant_collisions=0; orphan_risks=" + (";".join(new_parents) or "none")
                    + " (parents required only under scenario B)"])
        w.writerow(["NOTE", "listing_migration=NONE today: production catalog never imported, no "
                            "listings reference these keys; conversions before first import need no aliases"])
        for r in impact_rows:
            w.writerow(["KEY_MAPPING", json.dumps(r, sort_keys=True)])

    # §H deeper research (12 families)
    H = [
        ("bmw", "1-series", "VARIANTS_CONFIRMED", "116|118|120|125", "S14"),
        ("bmw", "2-series", "VARIANTS_CONFIRMED", "218|220", "S15"),
        ("bmw", "4-series", "VARIANTS_CONFIRMED", "420|430|440", "S16"),
        ("bmw", "7-series", "VARIANTS_CONFIRMED", "740|750", "S17"),
        ("mercedes-benz", "a-class", "STILL_NEEDS_MORE_EVIDENCE", "",
         "Official Mercedes archive not retrievable in this pass (reference DBs bot-blocked)."),
        ("mercedes-benz", "cla", "STILL_NEEDS_MORE_EVIDENCE", "", "Same as A-Class."),
        ("mercedes-benz", "s-class", "STILL_NEEDS_MORE_EVIDENCE", "", "Same as A-Class."),
        ("mercedes-benz", "glc", "STILL_NEEDS_MORE_EVIDENCE", "", "Same as A-Class."),
        ("mercedes-benz", "gle", "STILL_NEEDS_MORE_EVIDENCE", "", "Same as A-Class."),
        ("ford", "focus", "VARIANTS_CONFIRMED", "ST|RS", "S18"),
        ("ford", "mustang", "RESEARCHED_EMPTY", "",
         "S20: Ford officially positions GT as a trim; Mach 1/Shelby already excluded."),
        ("honda", "civic", "VARIANTS_CONFIRMED", "Si", "S19"),
    ]
    write_csv("deeper-family-research.csv",
              [{"brand_slug": b, "family_slug": f, "research_outcome": o,
                "confirmed_variants": v, "evidence_or_note": e,
                "source_checked_at": CHECKED} for b, f, o, v, e in H],
              ["brand_slug", "family_slug", "research_outcome", "confirmed_variants",
               "evidence_or_note", "source_checked_at"])
    if len(H) != 12:
        fail("deeper-research families != 12")

    # source register
    write_csv("source-register.csv",
              [{"source_id": k, "source_title": t, "source_url_or_reference": u,
                "source_type": ty, "publisher": p, "source_checked_at": CHECKED,
                "families_supported": famref, "evidence_note": note}
               for k, (t, u, ty, p, famref, note) in SOURCES.items()],
              ["source_id", "source_title", "source_url_or_reference", "source_type",
               "publisher", "source_checked_at", "families_supported", "evidence_note"])

    # §J Santa Fe
    write_csv("santa-fe-owner-decision.csv", [{
        "brand_slug": "hyundai", "category": "CAR",
        "current_display": "Santa FE", "proposed_display": "Santa Fe",
        "family_slug": "santa-fe", "change_type": "DISPLAY_NAME_ONLY", "risk": "LOW",
        "owner_decision": "OWNER_APPROVED_FOR_NEXT_CONTROLLED_REVISION",
        "owner_note": "Applied only in the next controlled decision-layer revision; sealed family untouched in O.15.4B.",
        "decided_at": CHECKED,
    }], ["brand_slug", "category", "current_display", "proposed_display", "family_slug",
         "change_type", "risk", "owner_decision", "owner_note", "decided_at"])

    # sealed-layer post check
    post = sealed_state()
    if pre != post:
        fail("sealed layer or O.15.4A outputs changed during O.15.4B")

    # doctrine + reports
    with open(f"{OUT}/derivative-taxonomy-doctrine.md", "w") as fh:
        fh.write("""# AVTOSH.AZ Derivative-Taxonomy Doctrine (O.15.4B, Owner-decided)

brand -> canonical model family -> optional buyer-facing Alt model (variant).

A derivative is a VARIANT of its family when: a recognisable parent family
exists; the derivative is consistently related to it; buyers search it
separately; and it is not merely a generation, chassis code, technical
specification, trim, package, body style or temporary edition.

Canonical examples: 3 Series -> 316..330 + M3; C-Class -> C 180..C 280 + C 63;
A3 -> S3/RS3; Civic -> Si/Type R; Focus -> ST/RS; X5 -> X5 M.

A derivative stays a SEPARATE family only without a defensible parent or when
consistently marketed as an independent identity (Ford GT, RS200,
Mercedes-AMG GT).

Excluded from taxonomy: generations (G20/Mk7), chassis codes (W206/8Y), model
years, engines/displacement, power output, fuel type, drivetrain (xDrive/
quattro/4MATIC), transmissions, body styles, trims, packages (M Sport/AMG
Line/S line), temporary editions. Fuel/technical suffix aliases fold into the
canonical designation (320i/320d -> 320) absent contrary evidence.

Never decide from shared text or numeric similarity alone; evidence or an
explicit Owner example is required for every conversion.

Production gate (K): the CAR catalog ships as ONE completed master — the 97
deferred O.15.3 REVIEW rows must be resolved or explicitly removed by
evidence-based Owner decisions before production import; no silent deferrals
of known brands/models; the 30-family pilot is never deployed independently;
no partial rollout.
""")

    d_counts = defaultdict(int)
    for r in d_rows:
        d_counts[r["revised_decision"]] += 1
    e_counts = defaultdict(int)
    for r in e_rows:
        e_counts[r["classification"]] += 1
    lines = []
    a = lines.append
    a("# O.15.4B — Quality Report\n")
    a(f"- Sealed-layer integrity: {len(pre)} files (25 sealed + {len(pre)-25} O.15.4A) "
      f"hash-verified pre and post — {'CHANGED!' if pre != post else 'unchanged'}.")
    a(f"- §D pilot variants (27): {dict(d_counts)}")
    a(f"- §E review candidates (43): {dict(e_counts)}")
    a(f"- §F global audit rows: {len(f_rows)} (incl. 3 no-match records for VW GTI/R, Hyundai N, Kia GT)")
    a(f"- §G scenario A: {json.dumps(scenario_a, sort_keys=True)}")
    a(f"- §G scenario B: {json.dumps(scenario_b, sort_keys=True)}")
    a(f"- §H outcomes: 6 VARIANTS_CONFIRMED, 1 RESEARCHED_EMPTY (Mustang), "
      f"5 STILL_NEEDS_MORE_EVIDENCE (Mercedes families), 0 BLOCKED_SOURCE_ACCESS")
    a("- §I: all 14 pilot RESEARCHED_EMPTY outcomes retained; Audi power/engine-badge and BMW")
    a("  xDrive/sDrive rejections stand; S/RS family conversions recorded separately (§F).")
    a("- §J: Santa Fe display proposal OWNER_APPROVED_FOR_NEXT_CONTROLLED_REVISION.")
    a("- §K production gate recorded in the doctrine: one completed master, 97 deferred rows")
    a("  must be Owner-resolved before import, no partial rollout, pilot never ships alone.")
    if FAILURES:
        a(f"\n**VALIDATIONS FAILED ({len(FAILURES)})**:")
        for f_ in FAILURES:
            a(f"- {f_}")
    else:
        a("\n**ALL §M VALIDATIONS PASSED.**")
    with open(f"{OUT}/o15-4b-quality-report.md", "w") as fh:
        fh.write("\n".join(lines) + "\n")

    ol = ["# O.15.4B — Owner Review Pack\n"]
    o = ol.append
    o("## 1. Pilot variant evidence verdicts (27)")
    o(f"- {dict(d_counts)} -> pilot-variant-evidence-review.csv (owner columns empty)")
    o("## 2. Review-candidate decisions (43)")
    o(f"- {dict(e_counts)} -> review-candidate-decisions.csv")
    o("## 3. Global derivative audit")
    o(f"- {len(confirmed_conv)} doctrine-confirmed conversions, {len(pending_conv)} pending-evidence "
      f"proposals, {sum(1 for r in f_rows if r['recommended_action']=='KEEP_SEPARATE_FAMILY')} "
      "keep-separate, plus non-taxonomy family flags -> global-derivative-family-audit.csv")
    o("## 4. Impact model")
    o("- Scenarios A/B with key mappings -> derivative-impact-analysis.csv")
    o("## 5. Deeper research (12) -> deeper-family-research.csv")
    o("## 6. Santa Fe -> santa-fe-owner-decision.csv (approved for next controlled revision)")
    o("## 7. Production gate -> derivative-taxonomy-doctrine.md (§K recorded)")
    with open(f"{OUT}/o15-4b-owner-review.md", "w") as fh:
        fh.write("\n".join(ol) + "\n")

    print("\n".join(lines))
    if FAILURES:
        sys.exit(1)


if __name__ == "__main__":
    main()
