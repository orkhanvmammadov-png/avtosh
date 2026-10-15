"""O.15.3C §B — machine-generated count reconciliation.

Replays the deterministic classifier in three configurations:
  3A: styling fixes OFF, Mercedes rule v1
  3B: styling fixes ON,  Mercedes rule v1
  3C: styling fixes ON,  Mercedes rule v2  (current layer)

and diffs (a) the unique CAR family sets and (b) per-row decisions between
consecutive configs, writing car-family-count-reconciliation.csv plus the
MOTO row-to-family reconciliation. Fails if any equation does not balance.
"""
import csv
import json
import os
import subprocess
import sys
from collections import Counter, defaultdict

OUT = "/Users/mammadovov/Developer/avtosh/research/o15-work"
PY = sys.executable

SNIPPET = r"""
import json, sys
sys.path.insert(0, "/Users/mammadovov/Developer/avtosh/research/o15-work")
import generate as g
car_rows, moto_rows = g.load_rows()
brand_rows, canon = g.build_brand_master(car_rows, moto_rows)
lookup, by_slug = g.brand_lookup(brand_rows)
car = g.classify_car_models(car_rows, lookup, by_slug)
moto = g.classify_moto_models(moto_rows, lookup)
def fams(models):
    return sorted({(m["canonical_brand_slug"], m["canonical_model_name"], m["canonical_model_slug"])
                   for m in models
                   if m["decision"] in ("KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "REASSIGN_BRAND")
                   and m["canonical_model_name"]})
rows = [{"b": m["source_brand"], "m": m["source_model"], "d": m["decision"],
         "cb": m["canonical_brand_slug"], "cf": m["canonical_model_name"],
         "cs": m["canonical_model_slug"]} for m in car]
moto_summary = {
    "raw": len(moto),
    "kept": sum(1 for m in moto if m["decision"] in ("KEEP_FAMILY", "REASSIGN_BRAND")),
    "excluded": sum(1 for m in moto if m["decision"] == "EXCLUDE"),
    "review": sum(1 for m in moto if m["decision"] == "REVIEW"),
    "unique_families": len(fams(moto)),
    "kept_keys": [[m["canonical_brand_slug"], m["canonical_model_slug"], m["source_brand"], m["source_model"]]
                  for m in moto if m["decision"] in ("KEEP_FAMILY", "REASSIGN_BRAND")],
}
print(json.dumps({"car_families": fams(car), "car_rows": rows, "moto": moto_summary}))
"""


def run_config(env_extra):
    env = dict(os.environ, **env_extra)
    r = subprocess.run([PY, "-c", SNIPPET], capture_output=True, text=True, env=env)
    if r.returncode != 0:
        raise SystemExit(f"config {env_extra} failed:\n{r.stderr}")
    return json.loads(r.stdout)


def family_set(data):
    return {tuple(f) for f in data["car_families"]}


def rows_by_key(data):
    return {(r["b"], r["m"]): r for r in data["car_rows"]}


def diff_stage(prev, cur, stage, recon_rows):
    fp, fc = family_set(prev), family_set(cur)
    added, removed = fc - fp, fp - fc
    rp, rc = rows_by_key(prev), rows_by_key(cur)
    changed = [(k, rp[k], rc[k]) for k in rp if (rp[k]["d"], rp[k]["cb"], rp[k]["cf"]) != (rc[k]["d"], rc[k]["cb"], rc[k]["cf"])]
    # classify removed families as MERGED (target family still exists / rows moved
    # to another family) or REMOVED (rows left the family universe: EXCLUDE/REVIEW)
    merged, removed_only = [], []
    for fam in sorted(removed):
        movers = [c for _, p, c in changed if (p["cb"], p["cf"], p["cs"]) == fam]
        if movers and any(m["d"] in ("KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "REASSIGN_BRAND") for m in movers):
            merged.append((fam, movers))
        else:
            removed_only.append((fam, movers))
    for fam, movers in merged:
        tgt = next(m for m in movers if m["d"] in ("KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "REASSIGN_BRAND"))
        recon_rows.append({
            "change_type": f"{stage}_FAMILY_MERGED", "brand_slug": fam[0], "category": "CAR",
            "raw_model": " | ".join(sorted({k[1] for k, p, c in changed if (p["cb"], p["cf"], p["cs"]) == fam})),
            "previous_family_name": fam[1], "previous_family_slug": fam[2],
            "current_family_name": tgt["cf"], "current_family_slug": tgt["cs"],
            "affected_source_row_count": len(movers),
            "reason_code": "STYLING" if stage == "3A_TO_3B" else "REOPENED_QA_CORRECTION",
            "rule_ref": "EXACT_TABLE" if stage == "3A_TO_3B" else "MB_NUMERIC_RULE_V2",
            "note": "Display-style convergence" if stage == "3A_TO_3B" else "Mercedes reopened-QA correction",
        })
    for fam, movers in removed_only:
        moved_rows = [(k, p, c) for k, p, c in changed if (p["cb"], p["cf"], p["cs"]) == fam]
        dests = sorted({c["d"] for _, _, c in moved_rows})
        recon_rows.append({
            "change_type": f"{stage}_FAMILY_REMOVED", "brand_slug": fam[0], "category": "CAR",
            "raw_model": " | ".join(sorted({k[1] for k, _, _ in moved_rows})),
            "previous_family_name": fam[1], "previous_family_slug": fam[2],
            "current_family_name": "", "current_family_slug": "",
            "affected_source_row_count": len(moved_rows),
            "reason_code": "REOPENED_QA_CORRECTION",
            "rule_ref": "MB_NUMERIC_RULE_V2",
            "note": f"All member rows left the family universe -> {dests}",
        })
    for fam in sorted(added):
        movers = [(k, p, c) for k, p, c in changed if (c["cb"], c["cf"], c["cs"]) == fam]
        recon_rows.append({
            "change_type": f"{stage}_FAMILY_ADDED", "brand_slug": fam[0], "category": "CAR",
            "raw_model": " | ".join(sorted({k[1] for k, _, _ in movers})),
            "previous_family_name": "", "previous_family_slug": "",
            "current_family_name": fam[1], "current_family_slug": fam[2],
            "affected_source_row_count": len(movers),
            "reason_code": "REOPENED_QA_CORRECTION",
            "rule_ref": "MB_NUMERIC_RULE_V2",
            "note": "Family materialized by reopened-QA correction",
        })
    # row-level decision changes that did not change the family universe
    fam_changed = {f for f, _ in merged} | {f for f, _ in removed_only} | added
    for k, p, c in sorted(changed):
        pfam, cfam = (p["cb"], p["cf"], p["cs"]), (c["cb"], c["cf"], c["cs"])
        if pfam in fam_changed or cfam in fam_changed:
            continue
        recon_rows.append({
            "change_type": f"{stage}_ROW_RECLASSIFIED", "brand_slug": c["cb"] or p["cb"],
            "category": "CAR", "raw_model": k[1],
            "previous_family_name": p["cf"], "previous_family_slug": p["cs"],
            "current_family_name": c["cf"], "current_family_slug": c["cs"],
            "affected_source_row_count": 1,
            "reason_code": "REOPENED_QA_CORRECTION", "rule_ref": "MB_NUMERIC_RULE_V2",
            "note": f"{p['d']} -> {c['d']} (membership move, family universe unchanged)",
        })
    return len(fp), len(added), len(merged), len(removed_only), len(fc)


def main():
    cfg_3a = run_config({"O15_DISABLE_STYLING_FIXES": "1", "O15_MB_RULE_VERSION": "1"})
    cfg_3b = run_config({"O15_MB_RULE_VERSION": "1"})
    cfg_3c = run_config({})
    recon = []
    p1, a1, m1, r1, c1 = diff_stage(cfg_3a, cfg_3b, "3A_TO_3B", recon)
    p2, a2, m2, r2, c2 = diff_stage(cfg_3b, cfg_3c, "3B_TO_3C", recon)
    assert p1 + a1 - m1 - r1 == c1, "3A->3B equation does not balance"
    assert p2 + a2 - m2 - r2 == c2, "3B->3C equation does not balance"
    assert p2 == c1
    with open(f"{OUT}/car-family-count-reconciliation.csv", "w", newline="") as fh:
        fields = ["change_type", "brand_slug", "category", "raw_model",
                  "previous_family_name", "previous_family_slug",
                  "current_family_name", "current_family_slug",
                  "affected_source_row_count", "reason_code", "rule_ref", "note"]
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in recon:
            w.writerow(r)
    moto = cfg_3c["moto"]
    kept_keys = Counter((b, s) for b, s, _, _ in moto["kept_keys"])
    collapses = {k: v for k, v in kept_keys.items() if v > 1}
    collapse_detail = defaultdict(list)
    for b, s, sb, sm in moto["kept_keys"]:
        if (b, s) in collapses:
            collapse_detail[(b, s)].append(f"{sb}/{sm}")
    eq = {
        "car_3a_previous_unique_families": p1,
        "car_3a_to_3b": {"added": a1, "merged": m1, "removed": r1, "result": c1},
        "car_3b_to_3c": {"added": a2, "merged": m2, "removed": r2, "result": c2},
        "moto": {**{k: v for k, v in moto.items() if k != "kept_keys"},
                 "collapsed_keys": {f"{b}/{s}": v for (b, s), v in sorted(collapse_detail.items())}},
        "moto_equation_ok": moto["raw"] == moto["kept"] + moto["excluded"] + moto["review"],
        "moto_collapse_ok": moto["kept"] - sum(len(v) - 1 for v in collapse_detail.values()) == moto["unique_families"],
    }
    print(json.dumps(eq, indent=2))
    if not (eq["moto_equation_ok"] and eq["moto_collapse_ok"]):
        raise SystemExit("MOTO reconciliation does not balance")


if __name__ == "__main__":
    main()
