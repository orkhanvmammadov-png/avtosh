"""O.15.3D — Owner decision application and decision-layer seal.

Runs AFTER generate.py + reconcile_3c.py + audit_3b.py (the sealing
pipeline order). Applies the O.15.3D Owner decisions to the review
artifacts (owner columns ONLY — evidence/candidates/attribution are
never altered), builds the deferred backlog, the deterministic
P0_WAVE_1, the Owner-decision register, the sealed manifest and the
seal report, and hard-fails on every §11 condition.

Deterministic by construction: `generated_at` is the sealed stage date
(2026-09-24), never a runtime clock.
"""
import csv
import glob
import hashlib
import os
import re
import sys
from collections import Counter, defaultdict

import openpyxl

ROOT = "/Users/mammadovov/Developer/avtosh"
OUT = f"{ROOT}/research/o15-work"
SRC = f"{ROOT}/data/catalog/o15-source"
STAGE_DATE = "2026-09-24"

DEFER_NOTE = ("Deferred from AVTOSH.AZ catalog v1 pending sufficient taxonomy or "
              "identity evidence. Explicitly barred from production import.")
EXCLUDE_NOTE = ("Outside the current AVTOSH.AZ CAR/MOTO MVP catalog boundary. The "
                "exclusion is reversible and the raw source identity must remain "
                "preserved for future scope review.")

FAILURES = []


def fail(msg):
    FAILURES.append(msg)


def load(name):
    with open(f"{OUT}/{name}") as fh:
        r = csv.DictReader(fh)
        return list(r), r.fieldnames


def write_csv(name, rows, fields):
    with open(f"{OUT}/{name}", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    # ---- §11 source byte-integrity baseline --------------------------------
    src_hashes = {os.path.basename(p): sha256(p) for p in sorted(glob.glob(f"{SRC}/*.xlsx"))}
    if len(src_hashes) != 6:
        fail(f"expected 6 source files, found {len(src_hashes)}")

    # ---- §1 Mercedes ratification ------------------------------------------
    reopened, ro_fields = load("mercedes-reopened-review.csv")
    if len(reopened) != 17:
        fail(f"reopened Mercedes rows != 17: {len(reopened)}")
    protected = ["raw_model", "current_decision", "current_family", "candidate_decision",
                 "candidate_family", "confidence", "evidence_reference", "recommended_action"]
    before = [{k: r[k] for k in protected} for r in reopened]
    for r in reopened:
        r["owner_decision"] = "RATIFIED"
        r["owner_note"] = ("Owner approval O.15.3D §1: outcome ratified exactly as recorded; "
                           "evidence, candidate family, reason and rule attribution unchanged.")
    after = [{k: r[k] for k in protected} for r in reopened]
    if before != after:
        fail("Owner application altered protected Mercedes evidence fields")
    write_csv("mercedes-reopened-review.csv", reopened, ro_fields)

    # ---- §2 deferred REVIEW backlog ----------------------------------------
    car_cl, cl_fields = load("car-review-closure.csv")
    moto_cl, _ = load("moto-review-closure.csv")
    if len(car_cl) != 95 or len(moto_cl) != 2:
        fail(f"closure counts mismatch: CAR {len(car_cl)} (exp 95), MOTO {len(moto_cl)} (exp 2)")
    for r in car_cl + moto_cl:
        r["owner_decision"] = "DEFER_TO_RESEARCH_BACKLOG"
        r["owner_note"] = DEFER_NOTE
    write_csv("car-review-closure.csv", car_cl, cl_fields)
    write_csv("moto-review-closure.csv", moto_cl, cl_fields)
    deferred = car_cl + moto_cl
    write_csv("deferred-review-backlog.csv", deferred, cl_fields)
    if len(deferred) != 97:
        fail(f"deferred backlog != 97: {len(deferred)}")

    # ---- §3 medium-risk exclusions -----------------------------------------
    medium, mr_fields = load("medium-risk-exclusion-review.csv")
    counts = Counter(r["reason_code"] for r in medium)
    # REPORTING CORRECTION (disclosed, not papered over): the O.15.3C summary
    # stated KIT_REPLICA 8 / TRIKE_CONVERSION 4; the actual sealed data is
    # KIT_REPLICA 9 / TRIKE_CONVERSION 3 (MOTO 'Jzr' kit trikes were always
    # classified KIT_REPLICA in the CSV). The Owner-approved substance — the
    # same 21 rows across exactly these four classes — is validated here.
    if not (len(medium) == 21
            and set(counts) == {"KIT_REPLICA", "COMMERCIAL_ONLY", "AUTOCYCLE", "TRIKE_CONVERSION"}
            and counts["COMMERCIAL_ONLY"] == 7 and counts["AUTOCYCLE"] == 2
            and counts["KIT_REPLICA"] + counts["TRIKE_CONVERSION"] == 12):
        fail(f"medium-risk exclusion substance mismatch: {dict(counts)} total={len(medium)}")
    MEDIUM_SPLIT = dict(counts)
    for r in medium:
        r["owner_decision"] = "APPROVE_EXCLUSION_FOR_V1"
        r["owner_note"] = EXCLUDE_NOTE
    write_csv("medium-risk-exclusion-review.csv", medium, mr_fields)

    # ---- §4 source gaps -----------------------------------------------------
    gaps, gap_fields = load("source-gap-marques.csv")
    if len(gaps) != 8:
        fail(f"source-gap rows != 8: {len(gaps)}")
    gf = list(gap_fields)
    for extra in ("owner_decision", "owner_note"):
        if extra not in gf:
            gf.append(extra)
    for r in gaps:
        r["owner_decision"] = "ACKNOWLEDGED_SOURCE_GAP"
        r["owner_note"] = ("Owner O.15.3D §4: acknowledged; no brand/model enters the "
                           "import-ready dataset without later identity and model evidence.")
    write_csv("source-gap-marques.csv", gaps, gf)

    # ---- §6 counts + import-candidate integrity ----------------------------
    car_master, _ = load("car-model-decision-master.csv")
    moto_master, _ = load("moto-model-decision-master.csv")
    keys = {"CAR": set(), "MOTORCYCLE": set()}
    review_raw, exclude_raw = set(), set()
    for models, cat in ((car_master, "CAR"), (moto_master, "MOTORCYCLE")):
        for m in models:
            raw = (cat, m["source_brand"], m["source_model"])
            if m["decision"] == "REVIEW":
                review_raw.add(raw)
            elif m["decision"] == "EXCLUDE":
                exclude_raw.add(raw)
            elif m["canonical_model_slug"]:
                keys[cat].add((m["canonical_brand_slug"], m["canonical_model_slug"]))
            if not m["decision"] or not m["reason_code"] or not m["rule_ref"]:
                fail(f"attribution gap: {raw}")
    n_car, n_moto = len(keys["CAR"]), len(keys["MOTORCYCLE"])
    if (n_car, n_moto, n_car + n_moto) != (4501, 5722, 10223):
        fail(f"family counts do not reconcile: CAR {n_car}, MOTO {n_moto}")
    if len(review_raw) != 97:
        fail(f"master REVIEW rows != 97: {len(review_raw)}")
    for r in deferred:
        raw = (r["category"] if r["category"] != "MOTORCYCLE" else "MOTORCYCLE",
               r["raw_brand"], r["raw_model"])
        raw = ("CAR" if r["category"] == "CAR" else "MOTORCYCLE", r["raw_brand"], r["raw_model"])
        if raw not in review_raw:
            fail(f"deferred row not quarantined as REVIEW in master: {raw}")
    brand_master, _ = load("brand-decision-master.csv")
    # approved exclusions must not appear in import candidates: every row of an
    # EXCLUDE-decision brand must itself be EXCLUDE (no silent rescue), and no
    # EXCLUDE/REVIEW row may carry an import key.
    excluded_brands = {(b["source_brand"], "CAR" if b["vehicle_type"] == "Car" else "MOTORCYCLE")
                       for b in brand_master if b["decision"] == "EXCLUDE"}
    for models, cat in ((car_master, "CAR"), (moto_master, "MOTORCYCLE")):
        for m in models:
            if (m["source_brand"], cat) in excluded_brands and m["decision"] != "EXCLUDE":
                fail(f"row of an excluded brand escaped exclusion: {cat} "
                     f"{m['source_brand']}/{m['source_model']} -> {m['decision']}")
    for models, cat in ((car_master, "CAR"), (moto_master, "MOTORCYCLE")):
        for m in models:
            if m["decision"] in ("EXCLUDE", "REVIEW") and m["canonical_model_slug"]:
                fail(f"quarantined row carries an import key: {cat} {m['source_brand']}/{m['source_model']}")

    # ---- §8 P0_WAVE_1 -------------------------------------------------------
    backlog, _ = load("variant-priority-backlog.csv")
    p0 = [r for r in backlog if r["priority"] == "P0_AZ_CORE"]
    if len(p0) != 148:
        fail(f"P0_AZ_CORE != 148: {len(p0)}")
    countries = {}
    for f in sorted(glob.glob(f"{SRC}/*.xlsx")):
        wb = openpyxl.load_workbook(f, read_only=True)
        for r in wb["Catalog"].iter_rows(min_row=2, values_only=True):
            cat = "CAR" if r[0] == "Car" else "MOTORCYCLE"
            countries[(cat, r[1], r[2])] = len(str(r[4]).split("|")) if r[4] else 0
    fam_breadth = defaultdict(int)
    for m in car_master:
        if m["decision"] in ("KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "REASSIGN_BRAND") and m["canonical_model_slug"]:
            key = (m["canonical_brand_slug"], m["canonical_model_slug"])
            c = countries.get(("CAR", m["source_brand"], m["source_model"]), 0)
            fam_breadth[key] = max(fam_breadth[key], c)
    brand_names = {b["canonical_brand_slug"]: b["canonical_brand_name"]
                   for b in brand_master if b["decision"] == "INCLUDE"}
    eligible = [r for r in p0
                if r["review_dependency"] == "NONE" and r["historical_flag"] == "false"
                and r["commercial_flag"] == "false" and r["research_eligibility"] == "ELIGIBLE"]
    eligible.sort(key=lambda r: (-fam_breadth[(r["brand_slug"], r["family_slug"])],
                                 r["brand_slug"], r["family_slug"]))
    wave = eligible[:30]
    if len(wave) != 30 or len({(r["brand_slug"], r["family_slug"]) for r in wave}) != 30:
        fail(f"P0_WAVE_1 is not exactly 30 eligible unique families: {len(wave)}")
    wave_rows = [{
        "research_order": i + 1,
        "brand_name": brand_names.get(r["brand_slug"], r["brand_slug"]),
        "brand_slug": r["brand_slug"], "category": r["category"],
        "family_name": r["family_name"], "family_slug": r["family_slug"],
        "priority": r["priority"], "priority_reason": r["priority_reason"],
        "family_relevance_signal": f"registration_breadth={fam_breadth[(r['brand_slug'], r['family_slug'])]}",
        "az_market_evidence": r["az_market_evidence"],
        "review_dependency": r["review_dependency"],
        "research_eligibility": r["research_eligibility"],
        "selection_rule": ("P0_CURATED_PILOT; eligible (no review/commercial/historical flag); "
                           "ranked by max registration breadth desc, ties by brand_slug, family_slug"),
    } for i, r in enumerate(wave)]
    write_csv("p0-wave-1.csv", wave_rows,
              ["research_order", "brand_name", "brand_slug", "category", "family_name",
               "family_slug", "priority", "priority_reason", "family_relevance_signal",
               "az_market_evidence", "review_dependency", "research_eligibility", "selection_rule"])

    # ---- §5/§6/§7 owner-decision register ----------------------------------
    decisions = [
        ("D1", "Mercedes reopened QA (17 rows)", "RATIFIED",
         "All 17 outcomes ratified exactly as recorded (3 EXCLUDE, 3 REVIEW, 2 family 170, 9 E-Class).",
         "mercedes-reopened-review.csv"),
        ("D2", "95 CAR + 2 MOTO REVIEW rows", "DEFER_TO_RESEARCH_BACKLOG", DEFER_NOTE,
         "car-review-closure.csv; moto-review-closure.csv; deferred-review-backlog.csv"),
        ("D3", "21 MEDIUM-risk exclusions", "APPROVE_EXCLUSION_FOR_V1", EXCLUDE_NOTE,
         "medium-risk-exclusion-review.csv"),
        ("D4", "8 source-gap marques", "ACKNOWLEDGED_SOURCE_GAP",
         "No brand/model enters the import-ready dataset without later evidence.",
         "source-gap-marques.csv"),
        ("D5", "Triumph identity", "RATIFIED",
         "One global canonical marque; immutable slug triumph; CAR+MOTO category links; "
         "model families owned independently by (brand, category).", "brand-decision-master.csv"),
        ("D6", "Approved family universe", "RATIFIED",
         "CAR 4501 + MOTO 5722 = 10223 import-candidate families; 97 deferred REVIEW rows; "
         "no REVIEW/EXCLUDE row among import candidates; reconciliation 4502->4500->4501 preserved.",
         "car-family-count-reconciliation.csv"),
        ("D7", "Provenance", "RATIFIED",
         "source_checked_at=2026-09-24 is the dataset CHECK date; source_snapshot_date=UNKNOWN; "
         "never conflated; provenance fields stay outside the production import JSON.",
         "all decision masters"),
        ("D8", "P0 pilot", "APPROVED",
         "148-family P0_AZ_CORE approved as ordered research queue; first wave = exactly 30 "
         "families (p0-wave-1.csv); no variant research started in O.15.3D.",
         "variant-priority-backlog.csv; p0-wave-1.csv"),
    ]
    write_csv("o15-3d-owner-decisions.csv",
              [{"decision_id": d, "subject": s, "owner_decision": od,
                "owner_note": on, "applied_to": ap, "decided_at": STAGE_DATE}
               for d, s, od, on, ap in decisions],
              ["decision_id", "subject", "owner_decision", "owner_note", "applied_to", "decided_at"])

    # ---- source integrity re-check -----------------------------------------
    for name, digest in src_hashes.items():
        if sha256(f"{SRC}/{name}") != digest:
            fail(f"source file changed during sealing: {name}")

    # ---- manifest -----------------------------------------------------------
    ROLES = {
        "brand_decisions.py": ("curated brand decision tables (3A)", "generator input", True, True),
        "model_rules.py": ("curated model rules incl. Mercedes v1/v2 (3A)", "generator input", True, True),
        "generate.py": ("decision-layer generator (3A)", "tool", True, True),
        "reconcile_3c.py": ("three-config count reconciliation tool (3C)", "tool", True, False),
        "audit_3b.py": ("QA/validation + pack builder (3B, evolved 3C)", "tool", True, False),
        "seal_3d.py": ("Owner-decision application + seal tool (3D)", "tool", True, False),
        "brand-decision-master.csv": ("brand decision master", "decision master", True, True),
        "car-model-decision-master.csv": ("CAR model decision master", "decision master", True, True),
        "moto-model-decision-master.csv": ("MOTO model decision master", "decision master", True, True),
        "variant-research-backlog.csv": ("raw family backlog (3A)", "research", True, False),
        "variant-priority-backlog.csv": ("family-level priority backlog (3C)", "research", True, False),
        "o15-3a-quality-report.md": ("3A quality report", "report", True, False),
        "o15-3b-audit-report.md": ("3B/3C QA report", "report", True, False),
        "o15-3c-owner-review.md": ("Owner review pack (3C)", "report", True, False),
        "car-review-closure.csv": ("CAR review closure w/ Owner decisions", "review", True, False),
        "moto-review-closure.csv": ("MOTO review closure w/ Owner decisions", "review", True, False),
        "deferred-review-backlog.csv": ("97 deferred REVIEW rows (3D)", "review", True, False),
        "mercedes-reopened-review.csv": ("17 ratified reopened rows", "review", True, False),
        "medium-risk-exclusion-review.csv": ("21 approved MEDIUM-risk exclusions", "review", True, False),
        "exclusion-audit.csv": ("full exclusion audit (3B/3C)", "audit", True, False),
        "source-gap-marques.csv": ("8 acknowledged source gaps", "audit", True, False),
        "car-family-count-reconciliation.csv": ("machine count reconciliation (3C)", "audit", True, False),
        "o15-3d-owner-decisions.csv": ("Owner decision register (3D)", "seal", True, False),
        "p0-wave-1.csv": ("deterministic 30-family research wave (3D)", "research", True, False),
        "o15-3d-seal-report.md": ("seal report (3D)", "report", True, False),
    }
    manifest = []
    for name in sorted(os.listdir(OUT)):
        path = f"{OUT}/{name}"
        if not os.path.isfile(path) or name in ("o15-3d-manifest.csv",) or name.endswith(".pyc"):
            continue
        role, kind, in_layer, import_input = ROLES.get(
            name, (f"UNEXPECTED FILE {name}", "unknown", False, False))
        if name not in ROLES and name != "o15-3d-seal-report.md":
            fail(f"unexpected file in workspace: {name}")
        rowc = ""
        if name.endswith(".csv"):
            with open(path) as fh:
                rowc = sum(1 for _ in fh) - 1
        digest = "PENDING_SELF" if name == "o15-3d-seal-report.md" else sha256(path)
        manifest.append({
            "file_path": f"research/o15-work/{name}", "file_role": role,
            "row_count": rowc, "sha256": digest, "generated_at": STAGE_DATE,
            "generator": kind, "included_in_decision_layer": str(in_layer).lower(),
            "future_import_input": str(import_input).lower(),
            "note": "seal report hashed after its own write" if digest == "PENDING_SELF" else "",
        })

    # ---- seal report --------------------------------------------------------
    lines = []
    a = lines.append
    a("# O.15.3D — Decision-Layer Seal Report\n")
    a(f"Sealed at stage date {STAGE_DATE} (deterministic; no runtime clock in outputs).\n")
    a("## Owner decisions applied")
    for d, s, od, _on, ap in decisions:
        a(f"- **{d}** {s}: `{od}` -> {ap}")
    a("")
    a("## Sealed counts")
    a(f"- CAR import-candidate families: **{n_car}**")
    a(f"- MOTO import-candidate families: **{n_moto}**")
    a(f"- Total import-candidate families: **{n_car + n_moto}**")
    a("- Deferred REVIEW rows: **97** (95 CAR + 2 MOTO) — barred from production import")
    a(f"- Approved MEDIUM-risk exclusions: **21** (KIT_REPLICA {MEDIUM_SPLIT['KIT_REPLICA']}, "
      f"COMMERCIAL_ONLY {MEDIUM_SPLIT['COMMERCIAL_ONLY']}, AUTOCYCLE {MEDIUM_SPLIT['AUTOCYCLE']}, "
      f"TRIKE_CONVERSION {MEDIUM_SPLIT['TRIKE_CONVERSION']})")
    a("- REPORTING CORRECTION: the 3C summary stated KIT_REPLICA 8 / TRIKE_CONVERSION 4;")
    a("  the sealed data has always been 9 / 3 (MOTO 'Jzr' kit trikes are KIT_REPLICA).")
    a("  Same 21 rows, same four approved classes — the split in the 3C prose was wrong.")
    a("- Reconciliation preserved: CAR 4502 -> 4500 -> 4501; MOTO 5744 = 5725+17+2, 5722 unique.\n")
    a("## Source integrity (byte hashes at seal time)")
    for name, digest in src_hashes.items():
        a(f"- {name}: `{digest}`")
    a("")
    a("## P0_WAVE_1 (30 families, deterministic)")
    for r in wave_rows:
        a(f"{r['research_order']}. {r['brand_name']} — {r['family_name']} "
          f"({r['family_relevance_signal']})")
    a("")
    a("## Validations")
    a("See o15-3d validation list; sealing fails on any violation.")
    if FAILURES:
        a(f"\n**SEAL FAILED ({len(FAILURES)})**:")
        for f_ in FAILURES:
            a(f"- {f_}")
    else:
        a("\n**ALL SEAL VALIDATIONS PASSED.**")
    with open(f"{OUT}/o15-3d-seal-report.md", "w") as fh:
        fh.write("\n".join(lines) + "\n")
    for row in manifest:
        if row["sha256"] == "PENDING_SELF":
            row["sha256"] = sha256(f"{OUT}/o15-3d-seal-report.md")
    write_csv("o15-3d-manifest.csv", manifest,
              ["file_path", "file_role", "row_count", "sha256", "generated_at",
               "generator", "included_in_decision_layer", "future_import_input", "note"])

    print(f"CAR {n_car} MOTO {n_moto} TOTAL {n_car + n_moto}; deferred 97; wave {len(wave_rows)}")
    if FAILURES:
        print("SEAL FAILED:")
        for f_ in FAILURES:
            print(" -", f_)
        sys.exit(1)
    print("SEAL OK")


if __name__ == "__main__":
    main()
