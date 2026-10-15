"""O.15.3A — deterministic normalization decision-layer generator.

Reads the six source XLSX files (read-only), applies the curated brand
and model decision tables, and writes reviewable research artifacts:

  brand-decision-master.csv
  car-model-decision-master.csv
  moto-model-decision-master.csv
  variant-research-backlog.csv
  o15-3a-quality-report.md

Research tooling only — never touches schema, APIs, importer data, or
the source files. Requires openpyxl.
"""
import csv
import glob
import os
import re
import unicodedata
from collections import Counter, defaultdict

import openpyxl

from brand_decisions import (
    CAR_EXCLUDE, CAR_INCLUDE_OVERRIDES, CAR_NORMALIZE,
    MOTO_EXCLUDE, MOTO_INCLUDE_OVERRIDES, MOTO_NORMALIZE, MOTO_REVIEW,
    SHARED_MARQUES,
)
from model_rules import EXACT, mercedes_numeric_rule

ROOT = "/Users/mammadovov/Developer/avtosh"
SOURCE_CHECKED_AT = "2026-09-24"   # Owner decision: date the supplied dataset was checked
SOURCE_SNAPSHOT_DATE = "UNKNOWN"  # original VehiclesDB snapshot date not establishable
SRC = f"{ROOT}/data/catalog/o15-source"
OUT = f"{ROOT}/research/o15-work"


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s or "x"


def load_rows():
    car, moto = [], []
    for f in sorted(glob.glob(f"{SRC}/*.xlsx")):
        wb = openpyxl.load_workbook(f, read_only=True)
        for r in wb["Catalog"].iter_rows(min_row=2, values_only=True):
            if r[0] == "Car":
                car.append(r)
            elif r[0] == "Motorcycle":
                moto.append(r)
    return car, moto


def build_brand_master(car_rows, moto_rows):
    """One decision row per (source_brand, vehicle_type)."""
    rows = []
    canon = {}  # canonical_slug -> canonical_name (collision guard)

    def canonical(name, slug, ctx):
        prior = canon.get(slug)
        if prior is not None and prior != name:
            raise SystemExit(f"canonical slug collision: {slug} = {prior!r} vs {name!r} ({ctx})")
        canon[slug] = name

    def decide(source, vtype):
        inc = CAR_INCLUDE_OVERRIDES if vtype == "Car" else MOTO_INCLUDE_OVERRIDES
        nor = CAR_NORMALIZE if vtype == "Car" else MOTO_NORMALIZE
        exc = CAR_EXCLUDE if vtype == "Car" else MOTO_EXCLUDE
        # A marque shared across categories keeps ONE canonical identity.
        if source in SHARED_MARQUES and source not in inc and source not in nor and source not in exc:
            name, slug = source, slugify(source)
            canonical(name, slug, source)
            return ("INCLUDE", name, slug, "", "SHARED_MARQUE",
                    "Same marque in CAR and MOTORCYCLE — one canonical brand identity.",
                    "SHARED_MARQUE_RULE")
        if vtype == "Motorcycle" and source in MOTO_REVIEW:
            return ("REVIEW", "", "", "", "UNRESOLVED_IDENTITY", MOTO_REVIEW[source],
                    "CURATED_REVIEW_TABLE")
        if source in exc:
            reason, notes = exc[source]
            return ("EXCLUDE", "", "", "", reason, notes or "", "CURATED_EXCLUDE_TABLE")
        if source in nor:
            target, reason, notes = nor[source]
            return ("NORMALIZE", "", "", target, reason, notes or "", "CURATED_NORMALIZE_TABLE")
        if source in inc:
            name, slug, reason, notes = inc[source]
            canonical(name, slug, source)
            return ("INCLUDE", name, slug, "", reason, notes or "", "CURATED_INCLUDE_OVERRIDE")
        name, slug = source, slugify(source)
        canonical(name, slug, source)
        return ("INCLUDE", name, slug, "", "DEFAULT_INCLUDE", "", "DEFAULT_INCLUDE_RULE")

    for vtype, brand_counter in (("Car", Counter(r[1] for r in car_rows)),
                                 ("Motorcycle", Counter(r[1] for r in moto_rows))):
        for source in sorted(brand_counter):
            decision, name, slug, target, reason, notes, rule_ref = decide(source, vtype)
            rows.append({
                "source_brand": source,
                "vehicle_type": vtype,
                "source_model_rows": brand_counter[source],
                "decision": decision,
                "canonical_brand_name": name,
                "canonical_brand_slug": slug,
                "normalize_to_slug": target,
                "reason_code": reason or "",
                "rule_ref": rule_ref,
                "notes": notes,
                "source": "VehiclesDB (data/catalog/o15-source, CC BY 4.0)",
                "source_checked_at": SOURCE_CHECKED_AT,
                "source_snapshot_date": SOURCE_SNAPSHOT_DATE,
            })
    # Marques materialized purely through model-level reassignment.
    for name, slug, note in [
        ("DKW", "dkw", "Materialized from Auto Union 'Dkw' rows — absent as a CAR source brand."),
        ("HYPTEC", "hyptec", "Sealed marque; materialized from the Aion 'Hyptec ...' row."),
    ]:
        canonical(name, slug, name)
        rows.append({
            "source_brand": "", "vehicle_type": "Car", "source_model_rows": 0,
            "decision": "INCLUDE", "canonical_brand_name": name,
            "canonical_brand_slug": slug, "normalize_to_slug": "",
            "reason_code": "MATERIALIZED_MARQUE", "rule_ref": "MATERIALIZED_MARQUE_RULE",
            "notes": note,
            "source": "VehiclesDB rows + sealed AVTOSH decisions",
            "source_checked_at": SOURCE_CHECKED_AT,
            "source_snapshot_date": SOURCE_SNAPSHOT_DATE,
        })
    return rows, canon


def brand_lookup(brand_rows):
    """(source_brand, vehicle_type) -> (decision, canonical_slug_or_target, canonical_name)."""
    out = {}
    by_slug = {r["canonical_brand_slug"]: r["canonical_brand_name"]
               for r in brand_rows if r["decision"] == "INCLUDE"}
    for r in brand_rows:
        if r["source_brand"] == "":
            continue
        key = (r["source_brand"], r["vehicle_type"])
        if r["decision"] == "INCLUDE":
            out[key] = ("INCLUDE", r["canonical_brand_slug"], r["canonical_brand_name"])
        elif r["decision"] == "NORMALIZE":
            target = r["normalize_to_slug"]
            out[key] = ("NORMALIZE", target, by_slug.get(target, ""))
        else:
            out[key] = (r["decision"], "", "")
    return out, by_slug


def classify_car_models(car_rows, lookup, by_slug):
    out = []
    for r in car_rows:
        brand, model, source = r[1], r[2], r[7] or "VehiclesDB"
        bdecision, bslug, _ = lookup[(brand, "Car")]
        row = {
            "source_brand": brand, "source_model": model,
            "canonical_brand_slug": "", "decision": "", "canonical_model_name": "",
            "canonical_model_slug": "", "reason_code": "", "rule_ref": "",
            "notes": "", "source": source,
            "source_checked_at": SOURCE_CHECKED_AT,
            "source_snapshot_date": SOURCE_SNAPSHOT_DATE,
        }
        rule = EXACT.get((brand, model))
        if bdecision == "EXCLUDE" and rule is None:
            row.update(decision="EXCLUDE", reason_code="BRAND_EXCLUDED", rule_ref="BRAND_EXCLUDED_RULE")
            out.append(row)
            continue
        if bdecision == "REVIEW":
            row.update(decision="REVIEW", reason_code="BRAND_UNRESOLVED", rule_ref="BRAND_REVIEW_RULE")
            out.append(row)
            continue
        if rule is not None:
            target_slug = rule["to_brand"] or (bslug if bdecision in ("INCLUDE", "NORMALIZE") else "")
            family = rule["family"]
            row.update(
                canonical_brand_slug=target_slug if rule["decision"] != "EXCLUDE" else "",
                decision=rule["decision"],
                canonical_model_name=family or "",
                canonical_model_slug=slugify(family) if family else "",
                reason_code=rule["reason"] or "CURATED_MODEL_DECISION",
                rule_ref="EXACT_TABLE",
                notes=rule["notes"] or "",
            )
            out.append(row)
            continue
        if brand == "Mercedes-Benz":
            hit = mercedes_numeric_rule(model)
            if hit is not None:
                decision, family, reason, notes = hit
                row.update(
                    canonical_brand_slug=bslug if decision != "EXCLUDE" else "",
                    decision=decision,
                    canonical_model_name=family or "",
                    canonical_model_slug=slugify(family) if family else "",
                    reason_code=reason or "MB_NUMERIC_CLASSIFIED",
                    rule_ref="MB_NUMERIC_RULE_V" + (os.environ.get("O15_MB_RULE_VERSION") or "2"),
                    notes=notes or "",
                )
                out.append(row)
                continue
        # default: keep the family under the (possibly normalized) brand
        decision = "KEEP_FAMILY" if bdecision == "INCLUDE" else "REASSIGN_BRAND"
        row.update(
            canonical_brand_slug=bslug, decision=decision,
            canonical_model_name=model, canonical_model_slug=slugify(model),
            reason_code="SOURCE_FAMILY_ACCEPTED" if decision == "KEEP_FAMILY" else "BRAND_NORMALIZED",
            rule_ref="DEFAULT_KEEP_FAMILY" if decision == "KEEP_FAMILY" else "BRAND_NORMALIZE_REASSIGN",
        )
        out.append(row)
    return out


def classify_moto_models(moto_rows, lookup):
    out = []
    for r in moto_rows:
        brand, model, source = r[1], r[2], r[7] or "VehiclesDB"
        bdecision, bslug, _ = lookup[(brand, "Motorcycle")]
        row = {
            "source_brand": brand, "source_model": model,
            "canonical_brand_slug": "", "decision": "", "canonical_model_name": "",
            "canonical_model_slug": "", "reason_code": "", "rule_ref": "",
            "notes": "", "source": source,
            "source_checked_at": SOURCE_CHECKED_AT,
            "source_snapshot_date": SOURCE_SNAPSHOT_DATE,
        }
        if bdecision == "EXCLUDE":
            row.update(decision="EXCLUDE", reason_code="BRAND_EXCLUDED", rule_ref="BRAND_EXCLUDED_RULE")
        elif bdecision == "REVIEW":
            row.update(decision="REVIEW", reason_code="BRAND_UNRESOLVED", rule_ref="BRAND_REVIEW_RULE")
        elif model in ("Can Am", "Can-Am") and bslug == "can-am":
            row.update(decision="EXCLUDE", reason_code="MARQUE_ROW", rule_ref="INLINE_MARQUE_ROW_RULE")
        else:
            decision = "KEEP_FAMILY" if bdecision == "INCLUDE" else "REASSIGN_BRAND"
            row.update(
                canonical_brand_slug=bslug, decision=decision,
                canonical_model_name=model, canonical_model_slug=slugify(model),
                reason_code="SOURCE_FAMILY_ACCEPTED" if decision == "KEEP_FAMILY" else "BRAND_NORMALIZED",
                rule_ref="DEFAULT_KEEP_FAMILY" if decision == "KEEP_FAMILY" else "BRAND_NORMALIZE_REASSIGN",
            )
        out.append(row)
    return out


def write_csv(path, rows, fields):
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def main():
    os.makedirs(OUT, exist_ok=True)
    car_rows, moto_rows = load_rows()
    brand_rows, canon = build_brand_master(car_rows, moto_rows)
    lookup, by_slug = brand_lookup(brand_rows)
    car_models = classify_car_models(car_rows, lookup, by_slug)
    moto_models = classify_moto_models(moto_rows, lookup)

    # ---- variant backlog: every included CAR family starts NEEDS_RESEARCH ----
    families = sorted({
        (m["canonical_brand_slug"], m["canonical_model_name"], m["canonical_model_slug"])
        for m in car_models
        if m["decision"] in ("KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "REASSIGN_BRAND")
        and m["canonical_model_name"]
    })
    backlog = [{
        "canonical_brand": by_slug.get(b, b), "canonical_brand_slug": b,
        "canonical_model_family": name, "canonical_model_slug": slug,
        "variant_research_status": "NEEDS_RESEARCH",
        "notes": "Source contains no Alt-model data; absence of data is not VARIANT_NOT_APPLICABLE.",
    } for b, name, slug in families]

    write_csv(f"{OUT}/brand-decision-master.csv", brand_rows,
              ["source_brand", "vehicle_type", "source_model_rows", "decision",
               "canonical_brand_name", "canonical_brand_slug", "normalize_to_slug",
               "reason_code", "rule_ref", "notes", "source",
               "source_checked_at", "source_snapshot_date"])
    model_fields = ["source_brand", "source_model", "canonical_brand_slug", "decision",
                    "canonical_model_name", "canonical_model_slug", "reason_code",
                    "rule_ref", "notes", "source", "source_checked_at", "source_snapshot_date"]
    write_csv(f"{OUT}/car-model-decision-master.csv", car_models, model_fields)
    write_csv(f"{OUT}/moto-model-decision-master.csv", moto_models, model_fields)
    write_csv(f"{OUT}/variant-research-backlog.csv", backlog,
              ["canonical_brand", "canonical_brand_slug", "canonical_model_family",
               "canonical_model_slug", "variant_research_status", "notes"])

    # ---------------- quality report ----------------
    bc = Counter((r["vehicle_type"], r["decision"]) for r in brand_rows if r["source_brand"])
    cm = Counter(m["decision"] for m in car_models)
    mm = Counter(m["decision"] for m in moto_models)
    lower_collisions = defaultdict(list)
    for slug, name in canon.items():
        lower_collisions[name.lower()].append((name, slug))
    collisions = {k: v for k, v in lower_collisions.items() if len({n for n, _ in v}) > 1 or len(v) > 1}
    # family duplicate check: same (brand, family slug) reached from >1 distinct source model is
    # EXPECTED for NORMALIZE_TO_FAMILY; genuine duplicates = same family from two KEEP rows.
    keep_dupes = Counter((m["canonical_brand_slug"], m["canonical_model_slug"])
                         for m in car_models if m["decision"] == "KEEP_FAMILY")
    keep_dupes = {k: v for k, v in keep_dupes.items() if v > 1}
    moto_keep = sum(1 for m in moto_models if m["decision"] in ("KEEP_FAMILY", "REASSIGN_BRAND"))
    broken = [r["normalize_to_slug"] for r in brand_rows
              if r["decision"] == "NORMALIZE" and r["normalize_to_slug"] not in by_slug]
    car_review = [m for m in car_models if m["decision"] == "REVIEW"]
    review_reasons = Counter(m["reason_code"] for m in car_review)

    lines = []
    a = lines.append
    a("# O.15.3A — Normalization Decision Layer: Quality Report\n")
    a("Generated deterministically by `generate.py` from the six read-only source files.\n")
    a("## Brands")
    a(f"- Raw distinct CAR brands: **{len({r[1] for r in car_rows})}**")
    a(f"- Raw distinct MOTO brands: **{len({r[1] for r in moto_rows})}**")
    for vt in ("Car", "Motorcycle"):
        a(f"- {vt}: INCLUDE {bc[(vt, 'INCLUDE')]} / NORMALIZE {bc[(vt, 'NORMALIZE')]} / "
          f"EXCLUDE {bc[(vt, 'EXCLUDE')]} / REVIEW {bc[(vt, 'REVIEW')]}")
    a(f"- Canonical brand universe (INCLUDE, deduplicated across categories): **{len(canon)}**")
    a(f"- Duplicate canonical slugs: **0** (hard-failed at generation time)")
    a(f"- Broken normalization targets: **{len(broken)}** {broken}")
    a(f"- lower(name) canonical collisions: **{len(collisions)}** {dict(collisions) if collisions else ''}")
    a("")
    a("## CAR models")
    a(f"- Raw rows: **{len(car_models)}**")
    for k in ("KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "REASSIGN_BRAND", "EXCLUDE", "REVIEW"):
        a(f"- {k}: **{cm[k]}**")
    a(f"- CAR families after normalization: **{len(families)}**")
    a(f"- Same-family duplicates among KEEP_FAMILY rows: **{len(keep_dupes)}** {list(keep_dupes)[:10]}")
    a(f"- REVIEW reasons: {dict(review_reasons)}")
    a("")
    a("## MOTO models")
    a(f"- Raw rows: **{len(moto_models)}** — kept/reassigned: **{moto_keep}**, "
      f"EXCLUDE: **{mm['EXCLUDE']}**, REVIEW: **{mm['REVIEW']}**")
    a("- MOTO stays two-level; no variants manufactured.")
    a("")
    a("## Variant research backlog")
    a(f"- Families initialized NEEDS_RESEARCH: **{len(backlog)}** (100% — the source contains no")
    a("  Alt-model data; VARIANT_NOT_APPLICABLE requires positive evidence, not absent data).")
    a("")
    a("## Unresolved items (deliberate)")
    a(f"- Brand REVIEW: {[r['source_brand'] for r in brand_rows if r['decision'] == 'REVIEW']}")
    a(f"- CAR model REVIEW rows: {len(car_review)} — each carries a reason_code; they require a")
    a("  genuine taxonomy decision or outside research and were NOT silently resolved.")
    with open(f"{OUT}/o15-3a-quality-report.md", "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
