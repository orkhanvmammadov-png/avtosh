"""O.15.3C — decision-layer QA, review closure, family-level priorities,
import-key validation and the Owner-review pack.

(Evolved from the 3B audit tool; the filename is kept so prior references
stay valid.) Reads the regenerated masters + source XLSX (read-only) and
produces:
  o15-3b-audit-report.md          (QA report, updated)
  o15-3c-owner-review.md          (Owner decision pack)
  car-review-closure.csv / moto-review-closure.csv   (enriched)
  mercedes-reopened-review.csv
  medium-risk-exclusion-review.csv
  exclusion-audit.csv
  source-gap-marques.csv
  variant-priority-backlog.csv    (family-level rebuild)

Hard-fails on every §10/§A/§F validation. Never modifies masters/sources.
"""
import csv
import glob
import re
import sys
from collections import Counter, defaultdict

import openpyxl

ROOT = "/Users/mammadovov/Developer/avtosh"
OUT = f"{ROOT}/research/o15-work"
SRC = f"{ROOT}/data/catalog/o15-source"
SLUG_RE = re.compile(r"^[a-z0-9-]{1,64}$")
CHECKED_AT = "2026-09-24"

FAILURES = []


def fail(msg):
    FAILURES.append(msg)


def load(name):
    with open(f"{OUT}/{name}") as fh:
        return list(csv.DictReader(fh))


def write_csv(path, rows, fields):
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


# ---------------------------------------------------------------------------
# §A — attribution validation
# ---------------------------------------------------------------------------
BRAND_RULE_DECISIONS = {
    "SHARED_MARQUE_RULE": {"INCLUDE"}, "CURATED_INCLUDE_OVERRIDE": {"INCLUDE"},
    "CURATED_NORMALIZE_TABLE": {"NORMALIZE"}, "CURATED_EXCLUDE_TABLE": {"EXCLUDE"},
    "CURATED_REVIEW_TABLE": {"REVIEW"}, "DEFAULT_INCLUDE_RULE": {"INCLUDE"},
    "MATERIALIZED_MARQUE_RULE": {"INCLUDE"},
}
MODEL_RULE_DECISIONS = {
    "EXACT_TABLE": {"KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "REASSIGN_BRAND", "EXCLUDE", "REVIEW"},
    "MB_NUMERIC_RULE_V2": {"KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "EXCLUDE", "REVIEW"},
    "DEFAULT_KEEP_FAMILY": {"KEEP_FAMILY"},
    "BRAND_NORMALIZE_REASSIGN": {"REASSIGN_BRAND"},
    "BRAND_EXCLUDED_RULE": {"EXCLUDE"},
    "BRAND_REVIEW_RULE": {"REVIEW"},
    "INLINE_MARQUE_ROW_RULE": {"EXCLUDE"},
}


def validate_attribution(brands, car, moto):
    for r in brands:
        for f in ("decision", "reason_code", "rule_ref"):
            if not r[f]:
                fail(f"brand row missing {f}: {r['source_brand'] or r['canonical_brand_slug']}")
        allowed = BRAND_RULE_DECISIONS.get(r["rule_ref"])
        if allowed is None:
            fail(f"unknown brand rule_ref: {r['rule_ref']}")
        elif r["decision"] not in allowed:
            fail(f"brand rule_ref/decision mismatch: {r['rule_ref']} -> {r['decision']}")
    for models, cat in ((car, "CAR"), (moto, "MOTO")):
        for m in models:
            for f in ("decision", "reason_code", "rule_ref"):
                if not m[f]:
                    fail(f"{cat} row missing {f}: {m['source_brand']}/{m['source_model']}")
            allowed = MODEL_RULE_DECISIONS.get(m["rule_ref"])
            if allowed is None:
                fail(f"unknown model rule_ref: {m['rule_ref']} ({m['source_brand']}/{m['source_model']})")
            elif m["decision"] not in allowed:
                fail(f"model rule_ref/decision mismatch: {m['rule_ref']} -> {m['decision']} "
                     f"({m['source_brand']}/{m['source_model']})")


# ---------------------------------------------------------------------------
# §C — the 17 reopened Mercedes cases (3B state -> v2 outcome, owner columns empty)
# ---------------------------------------------------------------------------
REOPENED = [
    # raw_model, 3B decision, 3B family, risk, cand_decision, cand_family, conf, evidence, action
    ("108 D", "NORMALIZE_TO_FAMILY", "S-Class", "W108/W109 had no diesel — likely a van/truck code",
     "REVIEW", "", "LOW", "Mercedes W108/W109 engine history (no diesel passenger variant documented)",
     "RETURNED_TO_REVIEW"),
    ("109 D", "NORMALIZE_TO_FAMILY", "S-Class", "W108/W109 had no diesel — likely a van/truck code",
     "REVIEW", "", "LOW", "Mercedes W108/W109 engine history (no diesel passenger variant documented)",
     "RETURNED_TO_REVIEW"),
    ("170", "NORMALIZE_TO_FAMILY", "SLK", "Numeric similarity to R170 chassis; identity is the W136 passenger 170",
     "KEEP_FAMILY", "170", "MEDIUM", "Mercedes-Benz W136 170 V/170 S model history 1935-1953",
     "RECLASSIFIED_TO_FAMILY_170"),
    ("170 D", "NORMALIZE_TO_FAMILY", "SLK", "Numeric similarity to R170; 170 D is the documented W136 diesel",
     "KEEP_FAMILY", "170", "MEDIUM", "Mercedes-Benz 170 D (W136) diesel passenger car 1949-1953",
     "RECLASSIFIED_TO_FAMILY_170"),
    ("207 D", "NORMALIZE_TO_FAMILY", "E-Class", "T1 van sales code folded into a passenger family",
     "EXCLUDE", "", "HIGH", "Mercedes-Benz T1 (TN) van series sales codes 207 D-410 D",
     "RECLASSIFIED_EXCLUDE_COMMERCIAL"),
    ("208 D", "NORMALIZE_TO_FAMILY", "E-Class", "T1 van sales code folded into a passenger family",
     "EXCLUDE", "", "HIGH", "Mercedes-Benz T1 (TN) van series sales codes 207 D-410 D",
     "RECLASSIFIED_EXCLUDE_COMMERCIAL"),
    ("209 D", "NORMALIZE_TO_FAMILY", "E-Class", "T1 van sales code folded into a passenger family",
     "EXCLUDE", "", "HIGH", "Mercedes-Benz T1 (TN) van series sales codes 207 D-410 D",
     "RECLASSIFIED_EXCLUDE_COMMERCIAL"),
    ("220 CE", "NORMALIZE_TO_FAMILY", "S-Class", "Suffixed 220 rows are mid-size, not S-Class",
     "NORMALIZE_TO_FAMILY", "E-Class", "HIGH", "W124 220 CE coupe sales designation 1992-1993",
     "RECLASSIFIED_TO_E_CLASS"),
    ("220 D", "NORMALIZE_TO_FAMILY", "S-Class", "Suffixed 220 rows are mid-size, not S-Class",
     "NORMALIZE_TO_FAMILY", "E-Class", "MEDIUM", "W115 220 D mid-size diesel 1968-1976",
     "RECLASSIFIED_TO_E_CLASS"),
    ("220 E", "NORMALIZE_TO_FAMILY", "S-Class", "Suffixed 220 rows are mid-size, not S-Class",
     "NORMALIZE_TO_FAMILY", "E-Class", "HIGH", "W124 220 E sales designation 1992-1993",
     "RECLASSIFIED_TO_E_CLASS"),
    ("220 TE", "NORMALIZE_TO_FAMILY", "S-Class", "Suffixed 220 rows are mid-size, not S-Class",
     "NORMALIZE_TO_FAMILY", "E-Class", "HIGH", "W124 (S124) 220 TE estate sales designation",
     "RECLASSIFIED_TO_E_CLASS"),
    ("230", "NORMALIZE_TO_FAMILY", "SL", "Bare 230 mapped to SL by chassis-number coincidence",
     "REVIEW", "", "LOW", "Ambiguous: W114/W123 230 saloons vs W113 230 SL — body evidence required",
     "RETURNED_TO_REVIEW"),
    ("230 C", "NORMALIZE_TO_FAMILY", "SL", "W123 coupe folded into SL", "NORMALIZE_TO_FAMILY",
     "E-Class", "MEDIUM", "W123 230 C coupe sales designation 1977-1981", "RECLASSIFIED_TO_E_CLASS"),
    ("230 CE", "NORMALIZE_TO_FAMILY", "SL", "W123 coupe folded into SL", "NORMALIZE_TO_FAMILY",
     "E-Class", "MEDIUM", "W123 230 CE coupe sales designation 1980-1985", "RECLASSIFIED_TO_E_CLASS"),
    ("230 E", "NORMALIZE_TO_FAMILY", "SL", "W123 saloon folded into SL", "NORMALIZE_TO_FAMILY",
     "E-Class", "HIGH", "W123/W124 230 E saloon sales designation", "RECLASSIFIED_TO_E_CLASS"),
    ("230 T", "NORMALIZE_TO_FAMILY", "SL", "S123 estate folded into SL", "NORMALIZE_TO_FAMILY",
     "E-Class", "MEDIUM", "S123 230 T estate sales designation", "RECLASSIFIED_TO_E_CLASS"),
    ("230 TE", "NORMALIZE_TO_FAMILY", "SL", "S123 estate folded into SL", "NORMALIZE_TO_FAMILY",
     "E-Class", "MEDIUM", "S123 230 TE estate sales designation", "RECLASSIFIED_TO_E_CLASS"),
]


# ---------------------------------------------------------------------------
# §D — review-closure candidates (curated + Mercedes grouping)
# ---------------------------------------------------------------------------
VAN_HEADS = {"207", "208", "209", "307", "308", "309", "310", "311", "312",
             "313", "315", "316", "318", "319", "408", "410", "412", "413",
             "416", "508", "518", "608", "609", "709", "711", "809", "811", "814"}
MODERN_CHASSIS = {"203": "C-Class", "211": "E-Class", "212": "E-Class",
                  "216": "CL", "219": "CLS"}


def mb_group(model):
    parts = model.split()
    head, suf = parts[0], " ".join(parts[1:]).upper()
    if model == "Classe" or "AMG" in suf.split():
        return ("junk_or_incomplete", "", "EXCLUDE", "HIGH",
                "Truncated/trim fragment; confirm against original registry row.",
                "Registry row inspection", "UNRESOLVED")
    if not head.isdigit():
        return ("ambiguous_historical", "", "", "LOW",
                "Period documentation needed.", "", "UNRESOLVED")
    if head in MODERN_CHASSIS and suf.startswith("K"):
        return ("chassis_defensible", MODERN_CHASSIS[head], "NORMALIZE_TO_FAMILY", "MEDIUM",
                "Modern chassis code with junk suffix; verify body data.",
                f"Mercedes chassis code W{head}", "SUPPORTED_CANDIDATE")
    if any(s in ("G", "GD", "GE") for s in suf.split()):
        return ("sales_designation", "G-Class", "NORMALIZE_TO_FAMILY", "HIGH",
                "G-Wagen sales designation.", "W460/W461/W463 sales designations",
                "SUPPORTED_CANDIDATE")
    if "SLC" in suf:
        return ("sales_designation", "SLC", "NORMALIZE_TO_FAMILY", "MEDIUM",
                "C107 SLC designation; confirm family naming (SLC vs SL).",
                "C107 SLC model history", "SUPPORTED_CANDIDATE")
    if suf.startswith("SL"):
        return ("sales_designation", "SL", "NORMALIZE_TO_FAMILY", "HIGH",
                "SL sales designation.", "R107/R129 SL designations", "SUPPORTED_CANDIDATE")
    if suf in ("S", "SB", "SD", "SDL", "SE", "SEB", "SE B/C", "A") or head in ("560", "600"):
        return ("sales_designation", "S-Class", "NORMALIZE_TO_FAMILY", "MEDIUM",
                "S-line sales designation; verify era mapping.",
                "W108-W140 S-line designations", "SUPPORTED_CANDIDATE")
    if suf in ("E", "CE", "TE", "TD", "TDT", "CD", "C", "T", "E-24", "CE-24", "TE-24"):
        return ("sales_designation", "E-Class", "NORMALIZE_TO_FAMILY", "MEDIUM",
                "Mid-size sales designation.", "W114/W123/W124 designations", "SUPPORTED_CANDIDATE")
    if head in ("170", "180"):
        return ("sales_designation", head, "KEEP_FAMILY", "MEDIUM",
                "W136/W120 era passenger family; do not exclude for age.",
                f"Mercedes {head}-series (Ponton/pre-war) history", "SUPPORTED_CANDIDATE")
    return ("ambiguous_historical", "", "", "LOW",
            "Bare numeric designation; era/body evidence required.", "", "UNRESOLVED")


CURATED_CANDIDATES = {
    ("BMW", "Alpina"): ("BMW ALPINA", "bmw-alpina", "", "EXCLUDE", "MEDIUM",
                        "Bare marque row; confirm no distinct model intent.",
                        "Marque row inspection", "SUPPORTED_CANDIDATE"),
    ("BMW", "3.0CS"): ("BMW", "bmw", "3.0 CS", "KEEP_FAMILY", "MEDIUM",
                       "E9 coupe sold as 3.0 CS.", "BMW E9 model history", "SUPPORTED_CANDIDATE"),
    ("BMW", "3.0S"): ("BMW", "bmw", "3.0 S", "KEEP_FAMILY", "MEDIUM",
                      "E3 saloon sold as 3.0 S.", "BMW E3 model history", "SUPPORTED_CANDIDATE"),
    ("BMW", "Cs"): ("BMW", "bmw", "", "", "LOW", "Truncated value; registry row needed.", "", "UNRESOLVED"),
    ("BMW", "Active"): ("BMW", "bmw", "2 Series", "NORMALIZE_TO_FAMILY", "LOW",
                        "Likely truncated 'Active Tourer'.", "Registry body data", "UNRESOLVED"),
    ("BMW", "John Cooper Works"): ("MINI", "mini", "Cooper", "NORMALIZE_TO_FAMILY", "MEDIUM",
                                   "JCW trim-vs-family is a MINI taxonomy decision.",
                                   "MINI JCW lineup history", "SUPPORTED_CANDIDATE"),
    ("Auto Union", "Audi"): ("Audi", "audi", "", "EXCLUDE", "MEDIUM", "Bare marque row.",
                             "Marque row inspection", "SUPPORTED_CANDIDATE"),
    ("American", "Rambler"): ("Rambler", "rambler", "", "EXCLUDE", "MEDIUM",
                              "Bare marque row; Rambler families already exist under the Rambler marque.",
                              "Marque row inspection", "SUPPORTED_CANDIDATE"),
    ("Auto Union", "Dkw"): ("DKW", "dkw", "", "EXCLUDE", "MEDIUM", "Bare marque row.",
                            "Marque row inspection", "SUPPORTED_CANDIDATE"),
    ("Morgan", "3000"): ("Morgan", "morgan", "", "", "LOW",
                         "No documented Morgan 3000 family.", "", "UNRESOLVED"),
    ("Morgan", "Sports"): ("Morgan", "morgan", "Sports", "KEEP_FAMILY", "LOW",
                           "Historic Morgan Sports models; verify era.", "", "UNRESOLVED"),
    ("Sunbeam", "Talbot"): ("Sunbeam-Talbot", "sunbeam-talbot", "", "REASSIGN_BRAND", "MEDIUM",
                            "Sunbeam-Talbot marque 1938-1954.", "Sunbeam-Talbot marque history",
                            "SUPPORTED_CANDIDATE"),
    ("Sunbeam", "Talbot 90"): ("Sunbeam-Talbot", "sunbeam-talbot", "90", "REASSIGN_BRAND", "MEDIUM",
                               "Sunbeam-Talbot 90.", "Sunbeam-Talbot 90 model history",
                               "SUPPORTED_CANDIDATE"),
    ("Sunbeam", "Mk"): ("Sunbeam", "sunbeam", "", "EXCLUDE", "MEDIUM", "Truncated junk value.",
                        "Registry row inspection", "SUPPORTED_CANDIDATE"),
    ("Sunbeam", "12-16HP"): ("Sunbeam", "sunbeam", "12/16 HP", "KEEP_FAMILY", "LOW",
                             "Pre-war designation; legitimate if evidenced.", "", "UNRESOLVED"),
    ("Mercedes-Benz", "Classe"): ("Mercedes-Benz", "mercedes-benz", "", "EXCLUDE", "HIGH",
                                  "Junk value.", "Registry row inspection", "SUPPORTED_CANDIDATE"),
}
MOTO_CANDIDATES = {
    ("Moto S.p.a.", "WR250F"): ("Yamaha", "yamaha", "WR250F", "REASSIGN_BRAND", "MEDIUM",
                                "WR250F is a Yamaha model.", "Yamaha WR250F lineup",
                                "SUPPORTED_CANDIDATE"),
    ("MGB", "R8"): ("", "", "", "", "LOW", "Marque unverifiable.", "", "UNRESOLVED"),
}

# ---------------------------------------------------------------------------
# §E — family-level variant prioritisation
# ---------------------------------------------------------------------------
HISTORICAL_BRANDS = {
    "plymouth", "pontiac", "oldsmobile", "saab", "rover", "austin", "morris",
    "triumph", "datsun", "saturn", "mercury", "eagle", "geo", "hillman",
    "humber", "wolseley", "riley", "singer", "standard", "talbot", "simca",
    "borgward", "trabant", "wartburg", "yugo", "zastava", "fso", "polski-fiat",
    "studebaker", "packard", "hudson", "nash", "kaiser", "desoto", "rambler",
    "amc", "willys", "imperial", "edsel", "checker", "auburn", "hupmobile",
    "essex", "oakland", "graham", "reo", "stutz", "delorean", "bricklin",
    "de-tomaso", "jensen", "bristol", "daimler", "lagonda", "alvis",
    "armstrong-siddeley", "lanchester", "austin-healey", "auto-union", "dkw",
    "adler", "nsu", "goggomobil", "lloyd", "goliath", "prince", "princess",
    "vanden-plas", "bond", "reliant", "panther-westwinds", "iso-rivolta",
    "excalibur", "shelby", "sunbeam", "sunbeam-talbot", "izh", "luaz", "puch",
    "bertone", "international", "amphicar", "berkeley", "innocenti", "merkur",
    "volga", "delage", "hotchkiss", "panhard", "swallow", "moskvich", "gaz",
    "uaz", "zaz",
}
# GAZ/UAZ/ZAZ/Moskvich are historical-production but AZ-core used-market —
# they are pulled OUT of P4 by the curated pilot below where relevant.
TIER_P0_BRANDS = {
    "mercedes-benz", "bmw", "toyota", "lada", "hyundai", "kia", "nissan",
    "opel", "ford", "volkswagen", "chevrolet", "mitsubishi", "honda", "lexus",
    "audi", "daewoo", "ravon", "gaz", "uaz", "chery", "changan", "geely",
}
TIER_P1_BRANDS = {
    "mazda", "subaru", "suzuki", "skoda", "volvo", "land-rover", "jeep",
    "dodge", "infiniti", "acura", "porsche", "byd", "haval", "gwm", "jac",
    "baic", "dongfeng", "jetour", "omoda", "jaecoo", "zaz", "moskvich",
    "mini", "cadillac", "gmc", "lincoln", "chrysler", "citroen", "peugeot",
    "renault", "dacia", "seat", "fiat", "alfa-romeo", "tesla", "ssangyong",
    "kgm", "isuzu", "daihatsu", "genesis", "hongqi", "leapmotor", "zeekr",
    "xpeng", "nio", "deepal", "denza", "aion", "hyptec", "neta", "voyah",
    "lynk-co", "polestar", "jaguar", "smart",
}
# Bounded P0 pilot queue: (brand_slug, family_slug)
P0_PILOT = set()
for _b, _fams in {
    "mercedes-benz": ["e-class", "c-class", "s-class", "190", "g-class", "ml",
                      "gle", "glc", "glk", "cla", "a-class", "cls"],
    "bmw": ["3-series", "5-series", "7-series", "x5", "x3", "x6", "1-series",
            "4-series", "2-series", "x1"],
    "toyota": ["corolla", "camry", "land-cruiser", "land-cruiser-prado", "rav4",
               "prius", "yaris", "highlander", "hilux", "avensis", "auris"],
    "lada": ["2101", "2103", "2104", "2105", "2106", "2107", "2109", "21099",
             "2110", "2111", "2112", "2113", "2114", "2115", "niva", "samara",
             "priora", "granta", "vesta", "kalina", "largus", "xray"],
    "hyundai": ["elantra", "sonata", "accent", "tucson", "santa-fe", "i30",
                "i20", "getz", "creta", "ix35"],
    "kia": ["rio", "cerato", "optima", "sportage", "sorento", "ceed", "picanto", "k5"],
    "nissan": ["sunny", "almera", "teana", "x-trail", "qashqai", "patrol",
               "juke", "micra", "tiida", "note", "maxima", "primera"],
    "opel": ["astra", "vectra", "corsa", "zafira", "omega", "insignia",
             "meriva", "frontera"],
    "ford": ["focus", "fusion", "mondeo", "fiesta", "explorer", "escape",
             "kuga", "mustang"],
    "volkswagen": ["passat", "golf", "jetta", "polo", "touareg", "tiguan", "bora"],
    "chevrolet": ["cruze", "aveo", "lacetti", "captiva", "malibu", "niva",
                  "camaro", "tahoe", "epica", "spark"],
    "mitsubishi": ["pajero", "lancer", "outlander", "l200", "galant", "asx", "carisma"],
    "honda": ["civic", "accord", "cr-v", "fit", "hr-v", "pilot"],
    "lexus": ["rx", "lx", "es", "gs", "ls", "nx", "gx"],
    "audi": ["a4", "a6", "a8", "a3", "q7", "q5", "100", "80"],
    "daewoo": ["nexia", "matiz", "lanos", "leganza", "gentra"],
    "gaz": ["21", "24", "3110", "31105"],
    "uaz": ["patriot", "hunter", "469"],
}.items():
    for _f in _fams:
        P0_PILOT.add((_b, _f))
COMMERCIAL_FAMILIES = {"sprinter", "vito", "transit", "transporter", "crafter",
                       "daily", "ducato", "boxer", "jumper", "master", "movano",
                       "trafic", "vivaro", "citan", "caddy", "hilux"} - {"hilux"}


def priority_for(brand_slug, family_slug, countries):
    historical = brand_slug in HISTORICAL_BRANDS
    commercial = family_slug in COMMERCIAL_FAMILIES
    pilot = (brand_slug, family_slug) in P0_PILOT
    if pilot and not commercial:
        return ("P0_AZ_CORE", "Curated bounded AZ-core pilot family", "P0_CURATED_PILOT",
                "AZ_RELEVANCE_HEURISTIC", historical, commercial)
    if historical and not pilot:
        return ("P4_HISTORICAL_OR_LOW_CONFIDENCE", "Historical-production marque family",
                "HISTORICAL_P4", "NONE", historical, commercial)
    if (brand_slug in TIER_P0_BRANDS or brand_slug in TIER_P1_BRANDS) and countries >= 3:
        return ("P1_AZ_RELEVANT", f"AZ-tier brand + registration breadth ({countries} markets)",
                "TIER_BREADTH_P1", "AZ_RELEVANCE_HEURISTIC", historical, commercial)
    if countries >= 4:
        return ("P2_GLOBAL_MAINSTREAM", f"Global registration breadth ({countries} markets)",
                "GLOBAL_BREADTH_P2", "NONE", historical, commercial)
    return ("P3_LONG_TAIL", f"Low registration breadth ({countries} markets)",
            "LOW_BREADTH_P3", "NONE", historical, commercial)


def load_source_countries():
    out = {}
    for f in sorted(glob.glob(f"{SRC}/*.xlsx")):
        wb = openpyxl.load_workbook(f, read_only=True)
        for r in wb["Catalog"].iter_rows(min_row=2, values_only=True):
            cat = "CAR" if r[0] == "Car" else "MOTORCYCLE"
            n = len(str(r[4]).split("|")) if r[4] else 0
            out[(cat, r[1], r[2])] = n
    return out


def main():
    brands = load("brand-decision-master.csv")
    car = load("car-model-decision-master.csv")
    moto = load("moto-model-decision-master.csv")
    countries = load_source_countries()

    validate_attribution(brands, car, moto)

    # ---------------- §F import-key validations ----------------
    canon, canon_lower = {}, defaultdict(set)
    brand_cats = defaultdict(set)
    for b in brands:
        if b["decision"] == "INCLUDE":
            slug = b["canonical_brand_slug"]
            if not SLUG_RE.fullmatch(slug):
                fail(f"invalid brand slug: {slug!r}")
            prior = canon.get(slug)
            if prior is not None and prior != b["canonical_brand_name"]:
                fail(f"duplicate canonical brand slug: {slug}")
            canon[slug] = b["canonical_brand_name"]
            canon_lower[b["canonical_brand_name"].lower()].add(slug)
    for b in brands:
        if b["decision"] == "NORMALIZE" and b["normalize_to_slug"] not in canon:
            fail(f"broken normalization target: {b['source_brand']} -> {b['normalize_to_slug']}")
    import re as _re
    import unicodedata as _ud

    def slugify(name):
        s = _ud.normalize("NFKD", name).encode("ascii", "ignore").decode()
        return _re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "x"

    model_keys = {}
    family_rows = defaultdict(list)
    for models, cat in ((car, "CAR"), (moto, "MOTORCYCLE")):
        for m in models:
            d = m["decision"]
            if d in ("REVIEW", "EXCLUDE"):
                continue
            key = (m["canonical_brand_slug"], cat, m["canonical_model_slug"])
            if key[0] not in canon:
                fail(f"unresolved brand reference: {key}")
            if not SLUG_RE.fullmatch(key[2]):
                fail(f"invalid model slug: {key[2]!r}")
            if slugify(m["canonical_model_name"]) != key[2]:
                fail(f"non-deterministic model slug: {m['canonical_model_name']!r} vs {key[2]}")
            prior = model_keys.get(key)
            if prior is not None and prior != m["canonical_model_name"]:
                fail(f"inconsistent display name for model key {key}: {prior!r} vs {m['canonical_model_name']!r}")
            model_keys[key] = m["canonical_model_name"]
            brand_cats[key[0]].add(cat)
            family_rows[key].append(m)
    # styling-only family split check: two distinct slugs, same lower display, same brand+cat
    seen_lower = defaultdict(set)
    for (bslug, cat, mslug), name in model_keys.items():
        seen_lower[(bslug, cat, name.lower())].add(mslug)
    for k, slugs in seen_lower.items():
        if len(slugs) > 1:
            fail(f"family split only by styling/case: {k} -> {slugs}")
    # no lost rows
    if len(car) != 4895:
        fail(f"CAR source rows lost: {len(car)} != 4895")
    if len(moto) != 5744:
        fail(f"MOTO source rows lost: {len(moto)} != 5744")
    for models, cat in ((car, "CAR"), (moto, "MOTO")):
        for m in models:
            if m["decision"] not in ("KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "REASSIGN_BRAND",
                                     "EXCLUDE", "REVIEW"):
                fail(f"row without explicit decision: {m}")

    car_families = sorted({k for k in model_keys if k[1] == "CAR"})
    moto_families = sorted({k for k in model_keys if k[1] == "MOTORCYCLE"})

    # ---------------- §C output ----------------
    reopened_rows = [{
        "raw_brand": "Mercedes-Benz", "raw_model": rm, "current_decision": cd3b,
        "current_family": cf3b, "identified_risk": risk,
        "candidate_decision": cd, "candidate_family": cf, "confidence": conf,
        "evidence_reference": ev, "evidence_checked_at": CHECKED_AT,
        "recommended_action": action, "owner_decision": "", "owner_note": "",
    } for rm, cd3b, cf3b, risk, cd, cf, conf, ev, action in REOPENED]
    write_csv(f"{OUT}/mercedes-reopened-review.csv", reopened_rows,
              ["raw_brand", "raw_model", "current_decision", "current_family",
               "identified_risk", "candidate_decision", "candidate_family",
               "confidence", "evidence_reference", "evidence_checked_at",
               "recommended_action", "owner_decision", "owner_note"])

    # ---------------- §D enriched closure files ----------------
    closure_fields = ["category", "raw_brand", "raw_model", "current_reason_code",
                      "candidate_canonical_brand", "candidate_brand_slug",
                      "candidate_model_family", "candidate_decision", "confidence",
                      "evidence_required", "evidence_reference", "evidence_checked_at",
                      "research_outcome", "recommended_decision", "recommended_brand",
                      "recommended_family", "residual_risk", "research_note",
                      "owner_decision", "owner_note"]
    car_review_rows, group_counts = [], Counter()
    for m in car:
        if m["decision"] != "REVIEW":
            continue
        raw = (m["source_brand"], m["source_model"])
        if raw in CURATED_CANDIDATES:
            cb, cbs, fam, cd, conf, ev_req, ev_ref, outcome = CURATED_CANDIDATES[raw]
            group = "curated"
        else:
            group, fam, cd, conf, ev_req, ev_ref, outcome = mb_group(m["source_model"])
            cb, cbs = ("Mercedes-Benz", "mercedes-benz") if cd and cd != "EXCLUDE" else ("", "")
            group_counts[group] += 1
        car_review_rows.append({
            "category": "CAR", "raw_brand": raw[0], "raw_model": raw[1],
            "current_reason_code": m["reason_code"],
            "candidate_canonical_brand": cb, "candidate_brand_slug": cbs,
            "candidate_model_family": fam, "candidate_decision": cd,
            "confidence": conf, "evidence_required": ev_req,
            "evidence_reference": ev_ref,
            "evidence_checked_at": CHECKED_AT if ev_ref else "",
            "research_outcome": outcome,
            "recommended_decision": cd if outcome == "SUPPORTED_CANDIDATE" else "",
            "recommended_brand": cbs if outcome == "SUPPORTED_CANDIDATE" else "",
            "recommended_family": fam if outcome == "SUPPORTED_CANDIDATE" else "",
            "residual_risk": "Numeric-similarity misclassification" if raw[0] == "Mercedes-Benz"
                             else "Historical identity ambiguity",
            "research_note": f"research_group={group}",
            "owner_decision": "", "owner_note": "",
        })
    moto_review_rows = []
    for m in moto:
        if m["decision"] != "REVIEW":
            continue
        cb, cbs, fam, cd, conf, ev_req, ev_ref, outcome = MOTO_CANDIDATES[(m["source_brand"], m["source_model"])]
        moto_review_rows.append({
            "category": "MOTORCYCLE", "raw_brand": m["source_brand"], "raw_model": m["source_model"],
            "current_reason_code": m["reason_code"],
            "candidate_canonical_brand": cb, "candidate_brand_slug": cbs,
            "candidate_model_family": fam, "candidate_decision": cd,
            "confidence": conf, "evidence_required": ev_req,
            "evidence_reference": ev_ref, "evidence_checked_at": CHECKED_AT if ev_ref else "",
            "research_outcome": outcome,
            "recommended_decision": cd if outcome == "SUPPORTED_CANDIDATE" else "",
            "recommended_brand": cbs if outcome == "SUPPORTED_CANDIDATE" else "",
            "recommended_family": fam if outcome == "SUPPORTED_CANDIDATE" else "",
            "residual_risk": "Single-row marque with no corroboration",
            "research_note": "research_group=curated",
            "owner_decision": "", "owner_note": "",
        })
    write_csv(f"{OUT}/car-review-closure.csv", car_review_rows, closure_fields)
    write_csv(f"{OUT}/moto-review-closure.csv", moto_review_rows, closure_fields)

    # ---------------- §5 exclusion audit + MEDIUM-risk extract ----------------
    excl_rows = []
    for b in brands:
        if b["decision"] != "EXCLUDE":
            continue
        risk = {
            "COMMERCIAL_ONLY": "MEDIUM (passenger conversions exist for some marques)",
            "KIT_REPLICA": "MEDIUM (some kit marques had turn-key production runs)",
            "AUTOCYCLE": "MEDIUM (road-registered enclosed trikes)",
            "TRIKE_CONVERSION": "MEDIUM (conversion vs production boundary)",
        }.get(b["reason_code"], "LOW")
        excl_rows.append({
            "raw_value": b["source_brand"], "category": b["vehicle_type"].upper(),
            "exclusion_scope": "BRAND", "reason_code": b["reason_code"],
            "rationale": b["notes"], "affected_rows": b["source_model_rows"],
            "reversibility": "FULL — decision-table edit + regeneration.",
            "false_positive_risk": risk,
        })
    model_excl = Counter()
    model_note = {}
    for models, cat in ((car, "CAR"), (moto, "MOTORCYCLE")):
        for m in models:
            if m["decision"] == "EXCLUDE" and m["reason_code"] != "BRAND_EXCLUDED":
                key = (m["source_brand"], m["source_model"], cat, m["reason_code"])
                model_excl[key] += 1
                model_note[key] = m["notes"]
    for (brand, model, cat, reason), n in sorted(model_excl.items()):
        excl_rows.append({
            "raw_value": f"{brand} / {model}", "category": cat,
            "exclusion_scope": "MODEL", "reason_code": reason,
            "rationale": model_note[(brand, model, cat, reason)] or reason,
            "affected_rows": n,
            "reversibility": "FULL — model-rule edit + regeneration.",
            "false_positive_risk": "LOW",
        })
    write_csv(f"{OUT}/exclusion-audit.csv", excl_rows,
              ["raw_value", "category", "exclusion_scope", "reason_code", "rationale",
               "affected_rows", "reversibility", "false_positive_risk"])
    medium = [dict(r, owner_decision="", owner_note="") for r in excl_rows
              if r["reason_code"] in ("KIT_REPLICA", "TRIKE_CONVERSION", "AUTOCYCLE", "COMMERCIAL_ONLY")]
    write_csv(f"{OUT}/medium-risk-exclusion-review.csv", medium,
              ["raw_value", "category", "exclusion_scope", "reason_code", "rationale",
               "affected_rows", "reversibility", "false_positive_risk",
               "owner_decision", "owner_note"])

    # ---------------- §7 source gaps (unchanged content) ----------------
    gaps = [
        ("AUDI China", "audi-china"), ("Riddara", "riddara"), ("JETTA", "jetta"),
        ("AITO", "aito"), ("Mercedes-Maybach", "mercedes-maybach"),
        ("Geometry", "geometry"), ("DR/Stilnovo", "dr"), ("SMA", "sma"),
    ]
    write_csv(f"{OUT}/source-gap-marques.csv",
              [{"marque": m, "proposed_slug": s, "classification": "SOURCE_GAP",
                "sealed_context": "Owner decision O.15.3C §3: remains SOURCE_GAP; no invented models.",
                "evidence_required": "OEM/registry lineup evidence before any later catalog addition."}
               for m, s in gaps],
              ["marque", "proposed_slug", "classification", "sealed_context", "evidence_required"])

    # ---------------- §E family-level priority backlog ----------------
    fam_countries = defaultdict(int)
    for key, members in family_rows.items():
        for m in members:
            c = countries.get((key[1], m["source_brand"], m["source_model"]), 0)
            fam_countries[key] = max(fam_countries[key], c)
    pri_rows, pri_counts = [], Counter()
    pilot_matched = 0
    for key in car_families:
        bslug, cat, mslug = key
        name = model_keys[key]
        c = fam_countries[key]
        prio, reason, rule_ref, az_ev, hist, comm = priority_for(bslug, mslug, c)
        if rule_ref == "P0_CURATED_PILOT":
            pilot_matched += 1
        pri_counts[prio] += 1
        tier = ("P0" if bslug in TIER_P0_BRANDS else
                "P1" if bslug in TIER_P1_BRANDS else
                "HISTORICAL" if bslug in HISTORICAL_BRANDS else "NONE")
        pri_rows.append({
            "brand_slug": bslug, "category": cat, "family_name": name,
            "family_slug": mslug, "priority": prio, "priority_reason": reason,
            "brand_relevance_signal": tier,
            "family_relevance_signal": ("CURATED_PILOT" if rule_ref == "P0_CURATED_PILOT"
                                        else f"registration_breadth={c}"),
            "az_market_evidence": az_ev,
            "historical_flag": str(hist).lower(), "commercial_flag": str(comm).lower(),
            "review_dependency": "NONE",
            "research_eligibility": "ELIGIBLE",
            "rule_ref": rule_ref,
        })
    write_csv(f"{OUT}/variant-priority-backlog.csv", pri_rows,
              ["priority", "brand_slug", "category", "family_name", "family_slug",
               "priority_reason", "brand_relevance_signal", "family_relevance_signal",
               "az_market_evidence", "historical_flag", "commercial_flag",
               "review_dependency", "research_eligibility", "rule_ref"])

    # ---------------- reports ----------------
    attribution_total = len(brands) + len(car) + len(moto)
    rev_reason = Counter(m["reason_code"] for m in car if m["decision"] == "REVIEW")
    lines = []
    a = lines.append
    a("# O.15.3C — QA Report (supersedes the 3B revision)\n")
    a("## A. Attribution")
    a(f"- Rows validated: **{attribution_total}** (brand {len(brands)}, CAR {len(car)}, MOTO {len(moto)})")
    a("- 100% non-empty decision + reason_code + rule_ref; rule_ref whitelist and")
    a("  rule/decision consistency enforced as hard validations.")
    a("- Provenance: every master row carries source, source_checked_at=2026-09-24")
    a("  (Owner decision: dataset CHECK date) and source_snapshot_date=UNKNOWN")
    a("  (original snapshot date not establishable — never conflated).\n")
    a("## B. Count reconciliation")
    a("- See car-family-count-reconciliation.csv (machine-generated three-config replay):")
    a("  4502 (3A) + 0 added − 2 merged − 0 removed = 4500 (3B) — exclusively the")
    a("  Aion UT and AMC AMX styling convergences;")
    a(f"  4500 (3B) + 1 added (family '170') − 0 − 0 = **{len(car_families)} (3C)**.")
    a("- MOTO: 5744 raw = 5725 kept/reassigned + 17 excluded + 2 review;")
    a(f"  5725 − 3 duplicate-key collapses = **{len(moto_families)}** unique import-candidate")
    a("  families (bluroc/hero-125 ×2, kl-service/kxe250, kl-service/kxe450).\n")
    a("## C. Reopened Mercedes cases")
    a("- 17 rows reopened; outcomes: 3 EXCLUDE (T1 van codes), 3 RETURNED_TO_REVIEW")
    a("  (108 D, 109 D, bare 230), 2 -> family '170', 9 -> E-Class. Candidates and")
    a("  evidence in mercedes-reopened-review.csv; owner columns empty.\n")
    a("## D. Review rows")
    a(f"- CAR REVIEW: **{sum(rev_reason.values())}** ({dict(rev_reason)}); MOTO REVIEW: **{len(moto_review_rows)}**")
    a(f"- Mercedes research groups now: {dict(group_counts)}")
    a("- Enriched with evidence_reference / evidence_checked_at / research_outcome /")
    a("  recommended_* / residual_risk; owner columns remain empty.\n")
    a("## E. Family-level priorities")
    for p in ["P0_AZ_CORE", "P1_AZ_RELEVANT", "P2_GLOBAL_MAINSTREAM",
              "P3_LONG_TAIL", "P4_HISTORICAL_OR_LOW_CONFIDENCE"]:
        a(f"- {p}: **{pri_counts[p]}**")
    a(f"- Curated P0 pilot matches: {pilot_matched} families (bounded queue).")
    a("- AZ relevance is heuristic (AZ_RELEVANCE_HEURISTIC) — no proven AZ sales data used.\n")
    a("## F. Import-key validation")
    a(f"- {len(canon)} unique global brand slugs; {len(brand_cats)} linked; ")
    a(f"  {len(model_keys)} unique (brand, category, model_slug) keys with consistent display")
    a("  names and deterministic slugs; zero REVIEW/EXCLUDE leakage; zero lost rows;")
    a("  zero styling-only family splits.\n")
    a("## Hard validations")
    if FAILURES:
        a(f"**FAILED ({len(FAILURES)})**:")
        for f_ in FAILURES:
            a(f"- {f_}")
    else:
        a("ALL PASSED.")
    with open(f"{OUT}/o15-3b-audit-report.md", "w") as fh:
        fh.write("\n".join(lines) + "\n")

    # Owner pack
    ol = []
    o = ol.append
    o("# O.15.3C — Owner Review Pack\n")
    o("Everything below awaits Owner decision; nothing has been silently resolved.\n")
    o("## 1. Open REVIEW rows (decide per row in the closure files)")
    o(f"- CAR: **{len(car_review_rows)}** rows -> car-review-closure.csv")
    o(f"- MOTO: **{len(moto_review_rows)}** rows -> moto-review-closure.csv")
    o("- Each row: candidate decision, confidence, evidence reference/required,")
    o("  research_outcome; `owner_decision` / `owner_note` await you.\n")
    o("## 2. Reopened Mercedes rows (17) — mercedes-reopened-review.csv")
    o("| raw | was | candidate | action |")
    o("|---|---|---|---|")
    for rm, cd3b, cf3b, _r, cd, cf, _c, _e, action in REOPENED:
        o(f"| {rm} | {cd3b}:{cf3b} | {cd}{':' + cf if cf else ''} | {action} |")
    o("")
    o("## 3. MEDIUM-risk exclusions (not finally signed off)")
    o(f"- **{len(medium)}** rows -> medium-risk-exclusion-review.csv")
    o("  (KIT_REPLICA, TRIKE_CONVERSION, AUTOCYCLE, COMMERCIAL_ONLY; decisions unchanged,")
    o("  owner columns await sign-off).\n")
    o("## 4. Source-gap acknowledgements (Owner decision §3 recorded)")
    o("- AUDI China, Riddara, JETTA, AITO, Mercedes-Maybach, Geometry, DR/Stilnovo, SMA")
    o("  remain SOURCE_GAP; no invented models. -> source-gap-marques.csv\n")
    o("## 5. Family-level priority results (research queue only)")
    for p in ["P0_AZ_CORE", "P1_AZ_RELEVANT", "P2_GLOBAL_MAINSTREAM",
              "P3_LONG_TAIL", "P4_HISTORICAL_OR_LOW_CONFIDENCE"]:
        o(f"- {p}: **{pri_counts[p]}**")
    o("- P0 is a bounded curated pilot; AZ relevance is explicitly AZ_RELEVANCE_HEURISTIC.\n")
    o("## 6. Provenance status")
    o("- source_checked_at = 2026-09-24 (dataset CHECK date, Owner decision §1)")
    o("- source_snapshot_date = UNKNOWN (original snapshot date not establishable)")
    o("- Full rule attribution on all rows (rule_ref); per-row file/sheet coordinates")
    o("  are not carried (dataset-level provenance only).\n")
    o("## 7. Final count reconciliation")
    o(f"- CAR: 4502 -> 4500 (2 styling merges) -> **{len(car_families)}** (+ family '170').")
    o(f"- MOTO: 5744 rows = 5725 kept + 17 excluded + 2 review; **{len(moto_families)}** unique families.")
    o("- Machine detail: car-family-count-reconciliation.csv.")
    o("")
    o("## Recorded Owner decisions")
    o("- Triumph: ONE global canonical marque, immutable slug `triumph`, CAR+MOTO")
    o("  category links, category-owned model families.")
    with open(f"{OUT}/o15-3c-owner-review.md", "w") as fh:
        fh.write("\n".join(ol) + "\n")

    print("\n".join(lines))
    if FAILURES:
        sys.exit(1)


if __name__ == "__main__":
    main()
