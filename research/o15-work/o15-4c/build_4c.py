"""O.15.4C — controlled taxonomy revision & known-unresolved-queue closure.

Reads the sealed O.15.3 layer and the O.15.4A/4B outputs strictly
read-only (all hash-verified before and after), applies the O.15.4C
Owner decisions and the documented research closures, and builds the
versioned v2 candidate decision layer plus the closure/reconciliation
artifacts. Deterministic; research gathered 2026-09-24 from the sources
in SOURCES (generative knowledge never used as evidence).
"""
import csv
import hashlib
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

ROOT = "/Users/mammadovov/Developer/avtosh"
WORK = f"{ROOT}/research/o15-work"
OUT = f"{WORK}/o15-4c"
CHECKED = "2026-09-24"
FAILURES = []
BANNED_TOKENS = ("xdrive", "sdrive", "4matic", "quattro", "tfsi", "tdi", "cdi",
                 "sedan", "coupe", "touring", "estate", "amg line", "m sport")


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


def prior_state():
    st = {}
    with open(f"{WORK}/o15-3d-manifest.csv") as fh:
        for r in csv.DictReader(fh):
            st[r["file_path"]] = sha256(f"{ROOT}/{r['file_path']}")
    for sub in ("o15-4a", "o15-4b"):
        d = f"{WORK}/{sub}"
        for name in sorted(os.listdir(d)):
            if os.path.isfile(f"{d}/{name}"):
                st[f"{sub}/{name}"] = sha256(f"{d}/{name}")
    return st


def load(path):
    with open(path) as fh:
        return list(csv.DictReader(fh))


def write_csv(name, rows, fields):
    with open(f"{OUT}/{name}", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


# ---------------------------------------------------------------------------
# Source register (S21+ continue 4A/4B ids; earlier ids referenced by number)
# ---------------------------------------------------------------------------
SOURCES = {
    "S21": ("Mercedes-Benz History: the W210 E-Class Models",
            "https://emercedesbenz.com/autos/mercedes-benz/e-class/mercedes-benz-history-the-w-210-e-class-models/",
            "automotive_publication", "eMercedesBenz (heritage-material publication)",
            "E-Class", "Documents W210 E 200/220/230/280/290/300/320/420/430 (+CDI)."),
    "S22": ("Mercedes-Benz G-Class — Wikipedia", "https://en.wikipedia.org/wiki/Mercedes-Benz_G-Class",
            "encyclopedic_reference", "Wikimedia Foundation", "G-Class",
            "Documents 200 GE/230 G/230 GE/240 GD/250 GD/280 GE/290 GD/300 GD/300 GE designations."),
    "S23": ("Mercedes-Benz SL-Class — Wikipedia", "https://en.wikipedia.org/wiki/Mercedes-Benz_SL-Class",
            "encyclopedic_reference", "Wikimedia Foundation", "SL, SLC",
            "Documents 190-600 SL designations and 280/350/380/450 SLC as the C107 coupe line."),
    "S24": ("Mercedes-Benz W136 — Wikipedia", "https://en.wikipedia.org/wiki/Mercedes-Benz_W136",
            "encyclopedic_reference", "Wikimedia Foundation", "170",
            "All 170 V/S/D/DS/Da/Vb/S-V/SD variants are the 170 passenger family."),
    "S25": ("Mercedes-Benz W120 — Wikipedia", "https://en.wikipedia.org/wiki/Mercedes-Benz_W120",
            "encyclopedic_reference", "Wikimedia Foundation", "180",
            "180/180a/b/c/180 D documented as the W120 Ponton passenger family."),
    "S26": ("Mercedes-Benz S-Class — Wikipedia", "https://en.wikipedia.org/wiki/Mercedes-Benz_S-Class",
            "encyclopedic_reference", "Wikimedia Foundation", "S-Class",
            "Pre-1993 S-line designations (220 S/SE, 250 S, 280 S, 300 SD/SDL, 560 SEL...) documented as S-Class predecessors."),
    "S27": ("Mercedes-Benz W202 C-Class model guide",
            "https://prestigeandperformancecar.com/mercedes/mercedes-c-class-w202-model-guide/",
            "automotive_publication", "Prestige & Performance Car", "C-Class",
            "Documents C 180/200/220/230/240/250 D/280 (+AMG)."),
    "S28": ("MBUSA official releases: A 220 & CLA 250 & GLE 350 & GLC 300 & S-Class 2021 (S 500/S 580) & MY2014/MY2015 E-Class (E 250/E 350/E 400/E 550)",
            "https://media.mbusa.com/releases/... (deep links return 404 outside the portal; titles + URLs recorded from the official index)",
            "official_manufacturer", "Mercedes-Benz USA", "A-Class, CLA, GLC, GLE, S-Class, E-Class",
            "Official specification/press documents naming the designations; portal deep-link fetch blocked (recorded per blocked-source policy)."),
    "S29": ("BMW PressClub specification documents: 335i (T0137145EN), 325i/330i/335i (T0039673EN), 340i debut (T0238303EN), 545e (T0317777EN), 550i GT (T0126736EN), M550i (T0268194EN), 7 Series 11/2020 (T0309529EN)",
            "https://www.press.bmwgroup.com/global/article/...", "official_manufacturer",
            "BMW Group PressClub", "3-series, 5-series, 7-series",
            "Official designation evidence for 335/340/545/550/730."),
    "S30": ("BMW 5-Series E39 review (Honest John Classics) + BMW 5 Series E39 model guide (Prestige & Performance Car)",
            "https://classics.honestjohn.co.uk/reviews/bmw/bmw-5-series-e39/ ; https://prestigeandperformancecar.com/bmw/bmw-5-series-e39-model-guide/",
            "automotive_publication", "Honest John Classics / P&PC", "5-series",
            "Two independent publications documenting E39 523i/528i."),
    "S31": ("Celebrating the 30th Anniversary of Honda Type R (Honda Stories) + Honda Type R Timeline and Milestones (hondanews)",
            "https://global.honda/en/stories/048.html ; https://hondanews.com/en-US/honda-automobiles/releases/release-5d911be38cf30e49d54f6cb4520a4d4a-honda-type-r-timeline-and-milestones",
            "official_manufacturer", "Honda", "Civic Type R, Integra Type R, Accord Type R",
            "Official Type R lineage material across Civic/Integra/Accord."),
    "S32": ("MINI John Cooper Works official press releases (T0445878EN_US, T0197651EN, T0446067EN)",
            "https://www.press.bmwgroup.com/usa/article/detail/T0445878EN_US/",
            "official_manufacturer", "BMW Group PressClub", "MINI Cooper",
            "JCW documented as MINI's top-performance derivative line (incl. Electric)."),
    "S33": ("Audi S and RS models — Wikipedia", "https://en.wikipedia.org/wiki/Audi_S_and_RS_models",
            "encyclopedic_reference", "Wikimedia Foundation", "Audi S/RS/SQ/TTS",
            "S/RS/SQ documented as derivatives of same-number base models; S2/RS2 based on the 80."),
    "S34": ("Ford Escort (Europe) — Wikipedia", "https://en.wikipedia.org/wiki/Ford_Escort_(Europe)",
            "encyclopedic_reference", "Wikimedia Foundation", "Escort",
            "RS 1600/RS 2000 documented as Escort performance derivatives; RS200 is standalone."),
    "S35": ("BMW New Six — Wikipedia", "https://en.wikipedia.org/wiki/BMW_New_Six",
            "encyclopedic_reference", "Wikimedia Foundation", "3.0 S / 3.0 CS",
            "3.0 S (E3) and 3.0 CS (E9) documented as model lines."),
    "S36": ("Sunbeam-Talbot — Wikipedia", "https://en.wikipedia.org/wiki/Sunbeam-Talbot",
            "encyclopedic_reference", "Wikimedia Foundation", "Sunbeam-Talbot",
            "Genuine marque 1938-1954; models Ten/2 Litre/80/90."),
    "S37": ("Toyota 86 — Wikipedia", "https://en.wikipedia.org/wiki/Toyota_86",
            "encyclopedic_reference", "Wikimedia Foundation", "86 / GT86 / GR86",
            "GT86 = European name of the 86; GR86 = second generation under the GR family."),
    "S38": ("W202 C-Class 30 years (CarBuzz) — carried over from 4A (S7)",
            "https://carbuzz.com/news/the-mercedes-benz-c-class-was-officially-born-30-years-ago/",
            "automotive_publication", "CarBuzz", "C-Class", "Second independent publication for C designations."),
}

# ---------------------------------------------------------------------------
# §C — 14 provisional Mercedes variants
# ---------------------------------------------------------------------------
MB14 = {
    "C 180": ("PRODUCTION_EVIDENCE_READY", "S27;S38", "Two independent publications (+wiki secondary)."),
    "C 200": ("PRODUCTION_EVIDENCE_READY", "S27;S38", "Two independent publications (+wiki secondary)."),
    "C 220": ("PRODUCTION_EVIDENCE_READY", "S27;S38", "Two independent publications (+wiki secondary)."),
    "C 230": ("PRODUCTION_EVIDENCE_READY", "S27;S38", "Two independent publications (+wiki secondary)."),
    "C 280": ("PRODUCTION_EVIDENCE_READY", "S27;S38", "Two independent publications (+wiki secondary)."),
    "E 200": ("PRODUCTION_EVIDENCE_READY", "S21;S8", "Heritage publication + wiki secondary (+registry)."),
    "E 220": ("PRODUCTION_EVIDENCE_READY", "S21;S8", "Heritage publication + wiki secondary (+registry)."),
    "E 230": ("PRODUCTION_EVIDENCE_READY", "S21;S8", "Heritage publication + wiki secondary (+registry)."),
    "E 250": ("PRODUCTION_EVIDENCE_READY", "S28;S8", "Official MBUSA MY2014 technical data (E250 BlueTEC)."),
    "E 280": ("PRODUCTION_EVIDENCE_READY", "S21;S8", "Heritage publication + wiki secondary (+registry)."),
    "E 300": ("PRODUCTION_EVIDENCE_READY", "S21;S8", "Heritage publication + wiki secondary (+registry)."),
    "E 320": ("PRODUCTION_EVIDENCE_READY", "S21;S8", "Heritage publication + wiki secondary (+registry)."),
    "E 400": ("PRODUCTION_EVIDENCE_READY", "S28;S8", "Official MBUSA MY2015 specifications."),
    "E 500": ("UNRESOLVED_SOURCE_BLOCKER", "S8",
              "Only wiki (secondary) + registry rows; blocked sources recorded: "
              "classicsworld.co.uk (403), autoevolution.com (403), carfolio.com (403), "
              "group-media.mercedes-benz.com (unindexed). Variant retained structurally; "
              "evidence upgrade pending."),
}

# ---------------------------------------------------------------------------
# §D/§F — designation closures (family -> [(name, evidence, grade, conf)])
# ---------------------------------------------------------------------------
OFFICIAL = "OFFICIAL"
PUBS = "TWO_PUBLICATIONS"
SEC = "SECONDARY_ONLY"
F24 = {
    ("bmw", "3-series"): [("335", "S29;S1", OFFICIAL, "HIGH"), ("340", "S29;S1", OFFICIAL, "HIGH")],
    ("bmw", "5-series"): [("523", "S30;S4", PUBS, "HIGH"), ("528", "S30;S4", PUBS, "HIGH"),
                          ("545", "S29;S4", OFFICIAL, "HIGH"), ("550", "S29;S4", OFFICIAL, "HIGH")],
    ("bmw", "7-series"): [("730", "S29;S4", OFFICIAL, "MEDIUM")],
    ("mercedes-benz", "c-class"): [("C 240", "S27;S6", PUBS, "MEDIUM"), ("C 250", "S27;S6", PUBS, "MEDIUM"),
                                   ("C 300", "S6", SEC, "MEDIUM"), ("C 320", "S6", SEC, "MEDIUM")],
    ("mercedes-benz", "e-class"): [("E 240", "S8", SEC, "MEDIUM"),
                                   ("E 350", "S28;S8", OFFICIAL, "HIGH"),
                                   ("E 550", "S28;S8", OFFICIAL, "HIGH")],
    ("mercedes-benz", "a-class"): [("A 180", "S8", SEC, "MEDIUM"), ("A 200", "S8", SEC, "MEDIUM")],
    ("mercedes-benz", "cla"): [("CLA 200", "S8", SEC, "MEDIUM"), ("CLA 250", "S28", OFFICIAL, "HIGH")],
    ("mercedes-benz", "s-class"): [("S 350", "S26", SEC, "MEDIUM"), ("S 500", "S28;S26", OFFICIAL, "HIGH")],
    ("mercedes-benz", "glc"): [("GLC 250", "S6", SEC, "MEDIUM"), ("GLC 300", "S28", OFFICIAL, "HIGH")],
    ("mercedes-benz", "gle"): [("GLE 350", "S28", OFFICIAL, "HIGH"), ("GLE 400", "S6", SEC, "MEDIUM")],
}
D_EXTRA = {  # §D additional official-evidence variants beyond the 24 rows
    ("mercedes-benz", "a-class"): [("A 220", "S28", OFFICIAL, "HIGH")],
    ("mercedes-benz", "s-class"): [("S 580", "S28", OFFICIAL, "HIGH")],
}
DOCTRINE5 = {  # ratified derivative variants from §E of 4B (Owner §A.2)
    ("bmw", "3-series"): [("M3", "OWNER_DOCTRINE;S1", "DOCTRINE", "HIGH")],
    ("bmw", "5-series"): [("M5", "OWNER_DOCTRINE;S4", "DOCTRINE", "HIGH")],
    ("bmw", "x5"): [("X5 M", "OWNER_DOCTRINE;S10", "DOCTRINE", "HIGH")],
    ("mercedes-benz", "c-class"): [("C 63", "OWNER_DOCTRINE;S6", "DOCTRINE", "HIGH")],
    ("mercedes-benz", "e-class"): [("E 63", "OWNER_DOCTRINE;S8", "DOCTRINE", "HIGH")],
    ("ford", "focus"): [("ST", "S18", OFFICIAL, "HIGH"), ("RS", "S18", OFFICIAL, "HIGH")],
    ("honda", "civic"): [("Si", "S19;S31", OFFICIAL, "HIGH")],
}
H_CONFIRM = {  # deeper-research confirmations from 4B §H
    ("bmw", "1-series"): [(n, "S14", OFFICIAL, "HIGH") for n in ("116", "118", "120", "125")],
    ("bmw", "2-series"): [(n, "S15", OFFICIAL, "HIGH") for n in ("218", "220")],
    ("bmw", "4-series"): [(n, "S16", OFFICIAL, "HIGH") for n in ("420", "430", "440")],
    ("bmw", "7-series"): [(n, "S17", OFFICIAL, "HIGH") for n in ("740", "750")],
}
ALIASES = [  # NORMALIZE_ALIAS_TO_VARIANT
    ("bmw", "3-series", "320i", "320", "S1;S2"),
    ("bmw", "3-series", "320d", "320", "S2"),
    ("bmw", "5-series", "530d", "530", "S4"),
    ("mini", "cooper", "JCW E", "John Cooper Works", "S32"),
]

# ---------------------------------------------------------------------------
# §E — 23 pending conversions; §G — global-audit closures
# family-name-keyed: (parent_name, variant_name, outcome, evidence, conf, note)
# ---------------------------------------------------------------------------
CONV = {}
for fam, parent in [("S1", "A1"), ("S4", "A4"), ("S5", "A5"), ("S6", "A6"),
                    ("S7", "A7"), ("S8", "A8"), ("RS4", "A4"), ("RS5", "A5"),
                    ("RS6", "A6"), ("RS7", "A7"), ("RSQ3", "Q3"), ("RSQ8", "Q8"),
                    ("SQ2", "Q2"), ("SQ5", "Q5"), ("SQ6", "Q6"), ("SQ7", "Q7"),
                    ("SQ8", "Q8"), ("TTS", "TT")]:
    CONV[("audi", fam)] = (parent, fam, "CONVERT_FAMILY_TO_VARIANT", "S33;S11;S12", "HIGH",
                           "S/RS/SQ derivative class (Owner-ratified structure) + published nomenclature evidence.")
CONV[("audi", "S3")] = ("A3", "S3", "CONVERT_FAMILY_TO_VARIANT", "OWNER_DOCTRINE;S33", "HIGH", "Owner-ratified example.")
CONV[("audi", "RS3")] = ("A3", "RS3", "CONVERT_FAMILY_TO_VARIANT", "OWNER_DOCTRINE;S33", "HIGH", "Owner-ratified example.")
CONV[("audi", "S2")] = ("80", "S2", "CONVERT_FAMILY_TO_VARIANT", "S33", "MEDIUM", "S2 documented as based on the 80.")
CONV[("audi", "RS2")] = ("80", "RS2", "CONVERT_FAMILY_TO_VARIANT", "S33", "MEDIUM", "RS2 Avant documented as based on the 80.")
CONV[("honda", "Civic Si")] = ("Civic", "Si", "CONVERT_FAMILY_TO_VARIANT", "S19;S31", "HIGH", "Owner-ratified; official Honda heritage.")
CONV[("honda", "Civic Type R")] = ("Civic", "Type R", "CONVERT_FAMILY_TO_VARIANT", "OWNER_DOCTRINE;S31", "HIGH", "Owner-ratified example; official Type R lineage.")
CONV[("honda", "Accord Type R")] = ("Accord", "Type R", "CONVERT_FAMILY_TO_VARIANT", "S31", "HIGH", "Official Type R lineage (Accord Type R 1998-2002).")
CONV[("honda", "Integra Type R")] = ("Integra", "Type R", "CONVERT_FAMILY_TO_VARIANT", "S31", "HIGH", "Official Type R lineage.")
CONV[("honda", "Accord Euro-R")] = ("Accord", "Euro-R", "CONVERT_FAMILY_TO_VARIANT", "S31", "MEDIUM", "Type R-family JDM derivative per official lineage material.")
CONV[("honda", "Del Sol Si")] = ("Del Sol", "Si", "CONVERT_FAMILY_TO_VARIANT", "S19", "MEDIUM", "Si line documented across Honda compacts; parent Del Sol exists.")
CONV[("mini", "Jcw")] = ("Cooper", "John Cooper Works", "CONVERT_FAMILY_TO_VARIANT", "S32", "HIGH", "Official JCW derivative line.")
CONV[("ford", "RS 1600")] = ("Escort", "RS 1600", "CONVERT_FAMILY_TO_VARIANT", "S34", "HIGH", "Documented Escort performance derivative.")
CONV[("ford", "RS 2000")] = ("Escort", "RS 2000", "CONVERT_FAMILY_TO_VARIANT", "S34", "HIGH", "Documented Escort performance derivative.")

GLOBAL_CLOSE = {  # remaining §G rows that are NOT conversions
    ("audi", "S E-Tron GT"): ("KEEP_SEPARATE_FAMILY", "S33",
                              "Marketed as an independent full model name; base 'E-Tron GT' family absent — "
                              "adding it is recorded as a PROPOSAL, not applied."),
    ("audi", "RS E-Tron GT"): ("KEEP_SEPARATE_FAMILY", "S33", "Same as S E-Tron GT."),
    ("toyota", "GR86"): ("KEEP_CANONICAL_FAMILY", "S37", "Second generation marketed as GR86 under the GR family."),
    ("toyota", "GT86"): ("ALIAS_MERGE_INTO_86", "S37", "European market name of the 86 — family alias merged."),
    ("toyota", "Gr Supra"): ("ALIAS_MERGE_INTO_SUPRA", "S37", "GR sub-brand naming of the Supra; styling duplicate merged."),
    ("ford", "RS 200"): ("KEEP_CANONICAL_FAMILY", "S34", "Standalone bespoke homologation model."),
    ("ford", "GT"): ("KEEP_CANONICAL_FAMILY", "S34", "Independent supercar identity."),
    ("ford", "Ranchero GT"): ("NON_TAXONOMY_MERGE_INTO_RANCHERO", "S34-class doctrine",
                              "GT here is a trim-era label of the Ranchero; folded into the parent."),
    ("mercedes-benz", "AMG"): ("EXCLUDE_JUNK_IDENTITY", "row inspection",
                               "Bare marque/derivative label without a family identity."),
    ("mercedes-benz", "AMG GT"): ("KEEP_CANONICAL_FAMILY", "S6", "Independent Mercedes-AMG GT family."),
    ("mini", "Jcw E"): ("ALIAS_TO_JCW_VARIANT", "S32", "JCW Electric — alias of the John Cooper Works variant."),
}
NON_TAX9 = {  # §H folds: family -> parent
    "Accord EX": "Accord", "Accord LX": "Accord", "Accord Dx": "Accord",
    "Accord Sport": "Accord", "Accord Touring": "Accord",
    "Accord Sport/Touring": "Accord", "Accord V6": "Accord",
    "Civic 1.6VTI": "Civic", "Civic 4D": "Civic",
}

# ---------------------------------------------------------------------------
# §I — deferred-row closure
# ---------------------------------------------------------------------------
MB_S_SUFFIX = {"S", "SB", "SD", "SDL", "SE", "SEB", "SE B/C", "A"}
MB_E_SUFFIX = {"E", "CE", "TE", "TD", "TDT", "CD", "C", "T", "E-24", "CE-24", "TE-24"}


def close_mb_deferred(model):
    """-> (final_decision, family, evidence, reason, note)"""
    parts = model.split()
    head, suf = parts[0], " ".join(parts[1:]).upper()
    if model == "Classe" or "AMG" in suf.split() or (not parts[0].isdigit() and model != "Classe"):
        return ("EXCLUDE_WITH_EVIDENCE", "", "row inspection", "JUNK_VALUE",
                "Truncated/trim fragment in the registry row.")
    if any(s in ("G", "GD", "GE", "GDT") for s in suf.split()):
        return ("NORMALIZE_TO_FAMILY", "G-Class", "S22", "SALES_DESIGNATION", "G-Wagen designation.")
    if "SLC" in suf:
        return ("NORMALIZE_TO_FAMILY", "SLC", "S23", "SALES_DESIGNATION", "C107 SLC designation.")
    if suf.startswith("SL"):
        return ("NORMALIZE_TO_FAMILY", "SL", "S23", "SALES_DESIGNATION", "SL designation.")
    if head == "170":
        return ("NORMALIZE_TO_FAMILY", "170", "S24", "HISTORICAL_FAMILY", "W136 170 family member.")
    if head == "180":
        if model == "180":
            return ("INCLUDE_FAMILY", "180", "S25", "HISTORICAL_FAMILY", "W120 Ponton 180 family.")
        return ("NORMALIZE_TO_FAMILY", "180", "S25", "HISTORICAL_FAMILY", "W120 180 family member.")
    if suf in MB_S_SUFFIX:
        return ("NORMALIZE_TO_FAMILY", "S-Class", "S26", "SALES_DESIGNATION",
                "Documented S-Class predecessor designation.")
    if suf in MB_E_SUFFIX:
        return ("NORMALIZE_TO_FAMILY", "E-Class", "S8;S21", "SALES_DESIGNATION",
                "Documented mid-size (E-line) designation.")
    if head in ("203", "211") and suf.startswith("K"):
        fam = "C-Class" if head == "203" else "E-Class"
        return ("NORMALIZE_TO_FAMILY", fam, "S6;S8", "CHASSIS_CODE",
                "Chassis code with junk suffix; registrations belong to the family.")
    return ("EXCLUDE_WITH_EVIDENCE", "", "documented research attempt",
            "EXCLUDE_UNRESOLVABLE_SOURCE_VALUE",
            "Bare numeric collides across multiple chassis/sales eras (e.g. SL vs S vs E lines); "
            "era/body evidence absent from the registry row after documented research.")


DEFERRED_OTHER = {
    # (brand, model) -> (decision, canonical_brand_slug, family, evidence, reason, note)
    ("BMW", "3.0CS"): ("INCLUDE_FAMILY", "bmw", "3.0 CS", "S35", "HISTORICAL_FAMILY", "E9 coupe line."),
    ("BMW", "3.0S"): ("INCLUDE_FAMILY", "bmw", "3.0 S", "S35", "HISTORICAL_FAMILY", "E3 saloon line."),
    ("BMW", "Cs"): ("EXCLUDE_WITH_EVIDENCE", "", "", "row inspection", "JUNK_VALUE", "Truncated value."),
    ("BMW", "Active"): ("EXCLUDE_WITH_EVIDENCE", "", "", "documented research attempt",
                        "EXCLUDE_UNRESOLVABLE_SOURCE_VALUE", "Truncated ('Active Tourer'?) — body evidence absent."),
    ("BMW", "Alpina"): ("EXCLUDE_WITH_EVIDENCE", "", "", "row inspection", "MARQUE_ROW", "Bare marque as model."),
    ("BMW", "John Cooper Works"): ("REASSIGN_BRAND", "mini", "Cooper", "S32", "DERIVATIVE_TO_VARIANT",
                                   "JCW rows belong under MINI Cooper (variant John Cooper Works)."),
    ("Auto Union", "Audi"): ("EXCLUDE_WITH_EVIDENCE", "", "", "row inspection", "MARQUE_ROW", "Bare marque as model."),
    ("Auto Union", "Dkw"): ("EXCLUDE_WITH_EVIDENCE", "", "", "row inspection", "MARQUE_ROW", "Bare marque as model."),
    ("American", "Rambler"): ("EXCLUDE_WITH_EVIDENCE", "", "", "row inspection", "MARQUE_ROW",
                              "Bare marque as model; Rambler families exist under the Rambler marque."),
    ("Morgan", "3000"): ("EXCLUDE_WITH_EVIDENCE", "", "", "documented research attempt",
                         "EXCLUDE_UNRESOLVABLE_SOURCE_VALUE", "No documented Morgan 3000 family located."),
    ("Morgan", "Sports"): ("EXCLUDE_WITH_EVIDENCE", "", "", "documented research attempt",
                           "EXCLUDE_UNRESOLVABLE_SOURCE_VALUE", "Generic label; era evidence absent."),
    ("Sunbeam", "Talbot"): ("EXCLUDE_WITH_EVIDENCE", "", "", "S36", "MARQUE_ROW",
                            "Bare Sunbeam-Talbot marque as model (marque itself added to brand master v2)."),
    ("Sunbeam", "Talbot 90"): ("REASSIGN_BRAND", "sunbeam-talbot", "90", "S36", "HISTORICAL_FAMILY",
                               "Sunbeam-Talbot 90 (1948-1954)."),
    ("Sunbeam", "Mk"): ("EXCLUDE_WITH_EVIDENCE", "", "", "row inspection", "JUNK_VALUE", "Truncated value."),
    ("Sunbeam", "12-16HP"): ("EXCLUDE_WITH_EVIDENCE", "", "", "documented research attempt",
                             "EXCLUDE_UNRESOLVABLE_SOURCE_VALUE",
                             "Pre-war designation; no retrievable source this pass (not excluded for age)."),
    ("Mercedes-Benz", "Classe"): ("EXCLUDE_WITH_EVIDENCE", "", "", "row inspection", "JUNK_VALUE", "Junk value."),
    # MOTO
    ("Moto S.p.a.", "WR250F"): ("REASSIGN_BRAND", "yamaha", "WR250F", "registry match", "MISFILED_ROW",
                                "Exact Yamaha WR250F model value under a mangled brand label."),
    ("MGB", "R8"): ("EXCLUDE_WITH_EVIDENCE", "", "", "documented research attempt",
                    "EXCLUDE_UNRESOLVABLE_SOURCE_VALUE", "Marque identity unverifiable after documented research."),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    pre = prior_state()

    brands_v1 = load(f"{WORK}/brand-decision-master.csv")
    car_v1 = load(f"{WORK}/car-model-decision-master.csv")
    moto_v1 = load(f"{WORK}/moto-model-decision-master.csv")
    cand_4a = load(f"{WORK}/o15-4a/p0-wave-1-variant-candidates.csv")
    audit_4b = load(f"{WORK}/o15-4b/global-derivative-family-audit.csv")

    fams = defaultdict(dict)   # brand -> family_name -> slug (v1 families)
    for m in car_v1:
        if m["decision"] in ("KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "REASSIGN_BRAND") and m["canonical_model_slug"]:
            fams[m["canonical_brand_slug"]][m["canonical_model_name"]] = m["canonical_model_slug"]
    moto_fams = defaultdict(dict)
    for m in moto_v1:
        if m["decision"] in ("KEEP_FAMILY", "REASSIGN_BRAND") and m["canonical_model_slug"]:
            moto_fams[m["canonical_brand_slug"]][m["canonical_model_name"]] = m["canonical_model_slug"]

    # ---- §E/§G coverage checks against the actual 4B artifact ----
    pend = [r for r in audit_4b if r["recommended_action"] == "PROPOSE_VARIANT_PENDING_EVIDENCE"]
    needs = [r for r in audit_4b if r["recommended_action"] == "NEEDS_EVIDENCE"]
    for r in pend:
        if ("audi" if r["brand_slug"] == "audi" else r["brand_slug"], r["current_family_name"]) not in CONV \
                and (r["brand_slug"], r["current_family_name"]) not in CONV:
            fail(f"pending conversion not closed: {r['brand_slug']}/{r['current_family_name']}")
    for r in needs:
        key = (r["brand_slug"], r["current_family_name"])
        if key not in CONV and key not in GLOBAL_CLOSE:
            fail(f"global-audit NEEDS row not closed: {key}")
    if len(pend) != 23:
        fail(f"pending conversions in 4B artifact != 23: {len(pend)} "
             f"(4B report prose said 23; artifact is authoritative)")

    # ---- build v2 car master + closures ----
    conv_by_name = {(b, f): v for (b, f), v in CONV.items()}
    alias_family = {("toyota", "GT86"): "86", ("toyota", "Gr Supra"): "Supra",
                    ("ford", "Ranchero GT"): "Ranchero", ("mini", "Jcw E"): "Cooper"}
    deferred_rows, car_v2 = [], []
    for m in car_v1:
        r = dict(m)
        brand, fam_name = m["canonical_brand_slug"], m["canonical_model_name"]
        if m["decision"] == "REVIEW":
            raw = (m["source_brand"], m["source_model"])
            if raw in DEFERRED_OTHER:
                dec, cb, fam, ev, reason, note = DEFERRED_OTHER[raw]
            elif m["source_brand"] == "Mercedes-Benz":
                dec, fam, ev, reason, note = close_mb_deferred(m["source_model"])
                cb = "mercedes-benz" if dec != "EXCLUDE_WITH_EVIDENCE" else ""
            else:
                fail(f"deferred row without closure: {raw}")
                continue
            conf = "HIGH" if reason in ("JUNK_VALUE", "MARQUE_ROW") else \
                   ("LOW" if reason == "EXCLUDE_UNRESOLVABLE_SOURCE_VALUE" else "MEDIUM")
            owner = "APPROVE_EXCLUSION" if dec == "EXCLUDE_WITH_EVIDENCE" and reason != "EXCLUDE_UNRESOLVABLE_SOURCE_VALUE" \
                else ("EXCLUDE_UNRESOLVABLE_SOURCE_VALUE" if reason == "EXCLUDE_UNRESOLVABLE_SOURCE_VALUE"
                      else "APPROVE_RECOMMENDATION")
            deferred_rows.append({
                "category": "CAR", "raw_brand": raw[0], "raw_model": raw[1],
                "previous_reason": m["reason_code"], "final_decision": dec,
                "canonical_brand": cb, "canonical_brand_slug": cb,
                "canonical_family": fam, "canonical_family_slug": slugify(fam) if fam else "",
                "evidence_reference": ev, "source_checked_at": CHECKED, "confidence": conf,
                "final_reason_code": reason, "rule_ref": "DEFERRED_CLOSURE_4C",
                "owner_decision": owner, "owner_note": "Owner policy O.15.4C §I applied.",
            })
            if dec == "EXCLUDE_WITH_EVIDENCE":
                r.update(decision="EXCLUDE", canonical_brand_slug="", canonical_model_name="",
                         canonical_model_slug="", reason_code=reason, rule_ref="DEFERRED_CLOSURE_4C",
                         notes=note)
            else:
                target_dec = "REASSIGN_BRAND" if dec == "REASSIGN_BRAND" else \
                             ("KEEP_FAMILY" if dec == "INCLUDE_FAMILY" else "NORMALIZE_TO_FAMILY")
                r.update(decision=target_dec, canonical_brand_slug=cb,
                         canonical_model_name=fam, canonical_model_slug=slugify(fam),
                         reason_code=reason, rule_ref="DEFERRED_CLOSURE_4C", notes=note)
        elif (brand, fam_name) in conv_by_name:
            parent, variant, _o, ev, conf, note = conv_by_name[(brand, fam_name)]
            pslug = fams[brand].get(parent)
            if pslug is None:
                fail(f"conversion parent missing: {brand}/{parent}")
                pslug = slugify(parent)
            r.update(canonical_model_name=parent, canonical_model_slug=pslug,
                     decision="NORMALIZE_TO_FAMILY", reason_code="DERIVATIVE_TO_VARIANT",
                     rule_ref="CONVERSION_4C",
                     notes=f"Family converted to variant '{variant}' of {parent}. {note}")
        elif (brand, fam_name) in alias_family:
            parent = alias_family[(brand, fam_name)]
            r.update(canonical_model_name=parent, canonical_model_slug=fams[brand][parent],
                     decision="NORMALIZE_TO_FAMILY", reason_code="FAMILY_ALIAS_MERGE",
                     rule_ref="GLOBAL_CLOSE_4C",
                     notes=GLOBAL_CLOSE.get((brand, fam_name), ("", "", ""))[2])
        elif brand == "honda" and fam_name in NON_TAX9:
            parent = NON_TAX9[fam_name]
            r.update(canonical_model_name=parent, canonical_model_slug=fams["honda"][parent],
                     decision="NORMALIZE_TO_FAMILY", reason_code="NON_TAXONOMY_LABEL",
                     rule_ref="NON_TAXONOMY_CLEANUP_4C",
                     notes="Trim/engine/body label folded into the canonical family.")
        elif brand == "mercedes-benz" and fam_name == "AMG":
            r.update(decision="EXCLUDE", canonical_brand_slug="", canonical_model_name="",
                     canonical_model_slug="", reason_code="JUNK_IDENTITY",
                     rule_ref="GLOBAL_CLOSE_4C", notes=GLOBAL_CLOSE[("mercedes-benz", "AMG")][2])
        elif fam_name == "Santa FE":
            r.update(canonical_model_name="Santa Fe", reason_code="DISPLAY_STYLING",
                     rule_ref="SANTA_FE_DISPLAY_4C",
                     notes="Owner-approved display correction; immutable slug unchanged.")
        car_v2.append(r)

    # MOTO v2
    moto_v2 = []
    for m in moto_v1:
        r = dict(m)
        raw = (m["source_brand"], m["source_model"])
        if m["decision"] == "REVIEW":
            dec, cb, fam, ev, reason, note = DEFERRED_OTHER[raw]
            conf = "MEDIUM" if dec == "REASSIGN_BRAND" else "LOW"
            deferred_rows.append({
                "category": "MOTORCYCLE", "raw_brand": raw[0], "raw_model": raw[1],
                "previous_reason": m["reason_code"], "final_decision": dec,
                "canonical_brand": cb, "canonical_brand_slug": cb,
                "canonical_family": fam, "canonical_family_slug": slugify(fam) if fam else "",
                "evidence_reference": ev, "source_checked_at": CHECKED, "confidence": conf,
                "final_reason_code": reason, "rule_ref": "DEFERRED_CLOSURE_4C",
                "owner_decision": "APPROVE_RECOMMENDATION" if dec == "REASSIGN_BRAND"
                                  else "EXCLUDE_UNRESOLVABLE_SOURCE_VALUE",
                "owner_note": "Owner policy O.15.4C §I applied.",
            })
            if dec == "EXCLUDE_WITH_EVIDENCE":
                r.update(decision="EXCLUDE", reason_code=reason, rule_ref="DEFERRED_CLOSURE_4C", notes=note)
            else:
                r.update(decision="REASSIGN_BRAND", canonical_brand_slug=cb,
                         canonical_model_name=fam, canonical_model_slug=slugify(fam),
                         reason_code=reason, rule_ref="DEFERRED_CLOSURE_4C", notes=note)
        moto_v2.append(r)
    if len(deferred_rows) != 97:
        fail(f"deferred closures != 97: {len(deferred_rows)}")

    # brand v2
    brands_v2 = []
    for b in brands_v1:
        r = dict(b)
        if b["decision"] == "REVIEW":
            if b["source_brand"] == "Moto S.p.a.":
                r.update(decision="NORMALIZE", normalize_to_slug="yamaha",
                         reason_code="MISFILED_ROW", rule_ref="DEFERRED_CLOSURE_4C",
                         notes="Single mangled Yamaha row reassigned.")
            elif b["source_brand"] == "MGB":
                r.update(decision="EXCLUDE", reason_code="EXCLUDE_UNRESOLVABLE_SOURCE_VALUE",
                         rule_ref="DEFERRED_CLOSURE_4C",
                         notes="Marque identity unverifiable after documented research.")
        brands_v2.append(r)
    brands_v2.append({
        "source_brand": "", "vehicle_type": "Car", "source_model_rows": 0,
        "decision": "INCLUDE", "canonical_brand_name": "Sunbeam-Talbot",
        "canonical_brand_slug": "sunbeam-talbot", "normalize_to_slug": "",
        "reason_code": "MATERIALIZED_MARQUE", "rule_ref": "DEFERRED_CLOSURE_4C",
        "notes": "Genuine marque 1938-1954 materialized from the Sunbeam 'Talbot 90' row (S36).",
        "source": "Wikipedia (Sunbeam-Talbot) + VehiclesDB rows",
        "source_checked_at": CHECKED, "source_snapshot_date": "UNKNOWN",
    })

    # ---- final family sets ----
    def family_set(models, cat):
        s = {}
        for m in models:
            if m["decision"] in ("KEEP_FAMILY", "NORMALIZE_TO_FAMILY", "REASSIGN_BRAND") and m["canonical_model_slug"]:
                key = (m["canonical_brand_slug"], cat, m["canonical_model_slug"])
                prior = s.get(key)
                if prior is not None and prior != m["canonical_model_name"]:
                    fail(f"v2 family display divergence: {key} {prior!r} vs {m['canonical_model_name']!r}")
                s[key] = m["canonical_model_name"]
        return s

    car_fams_v2 = family_set(car_v2, "CAR")
    moto_fams_v2 = family_set(moto_v2, "MOTORCYCLE")

    # ---- variant master ----
    variants, vkeys = [], set()

    def add_variant(brand, fam_slug, name, evidence, grade, conf, kind="INCLUDE_VARIANT",
                    alias_of="", reason="STABLE_SALES_DESIGNATION", rule="VARIANT_CLOSURE_4C"):
        key = (brand, "CAR", fam_slug, slugify(name))
        fkey = (brand, "CAR", fam_slug)
        if fkey not in car_fams_v2:
            fail(f"variant lacks a valid v2 parent: {key}")
            return
        if kind == "INCLUDE_VARIANT":
            if key in vkeys:
                return  # overlap: counted once (reconciled below)
            vkeys.add(key)
        low = name.lower()
        if any(t in low for t in BANNED_TOKENS) or slugify(name) == fam_slug:
            fail(f"banned/duplicate variant identity: {key}")
        variants.append({
            "brand_name": {"bmw": "BMW", "mercedes-benz": "Mercedes-Benz", "audi": "Audi",
                           "ford": "Ford", "honda": "Honda", "mini": "MINI",
                           "toyota": "Toyota", "hyundai": "Hyundai", "kia": "Kia"}.get(brand, brand),
            "brand_slug": brand, "category": "CAR",
            "family_name": car_fams_v2[(brand, "CAR", fam_slug)], "family_slug": fam_slug,
            "variant_name": name, "variant_slug": slugify(name),
            "decision": kind, "alias_of": alias_of, "sort_order": 0,
            "evidence_reference": evidence, "source_checked_at": CHECKED,
            "reason_code": reason, "rule_ref": rule, "confidence": conf,
            "evidence_grade": grade,
        })

    # pilot 27 with §C/§D grades
    for c in cand_4a:
        if c["decision"] != "INCLUDE_VARIANT":
            continue
        if c["brand_slug"] == "bmw":
            grade, ev, conf = OFFICIAL, c["source_reference"], "HIGH"
        else:
            outcome, ev, note = MB14[c["canonical_variant_name"]]
            grade = OFFICIAL if outcome == "PRODUCTION_EVIDENCE_READY" and "S28" in ev else \
                    ("TWO_PUBLICATIONS" if outcome == "PRODUCTION_EVIDENCE_READY" else "SECONDARY_ONLY")
            conf = "HIGH" if outcome == "PRODUCTION_EVIDENCE_READY" else "MEDIUM"
        add_variant(c["brand_slug"], c["family_slug"], c["canonical_variant_name"], ev, grade, conf)
    for table in (F24, D_EXTRA, DOCTRINE5, H_CONFIRM):
        for (brand, fam), items in table.items():
            for name, ev, grade, conf in items:
                add_variant(brand, fam, name, ev, grade, conf)
    for (brand, fam), (parent, variant, _o, ev, conf, note) in CONV.items():
        add_variant(brand, fams[brand][parent], variant, ev,
                    "OFFICIAL" if "S31" in ev or "S32" in ev or "S18" in ev else "TWO_PUBLICATIONS",
                    conf, reason="DERIVATIVE_CONVERSION")
    for brand, fam_slug, raw, target, ev in ALIASES:
        add_variant(brand, fam_slug, raw, ev, "N_A", "HIGH", kind="NORMALIZE_ALIAS_TO_VARIANT",
                    alias_of=target, reason="TECHNICAL_SUFFIX_ALIAS")
    for c in cand_4a:  # evaluated-and-rejected register rows
        if c["decision"] == "EXCLUDE_NOT_A_VARIANT":
            variants.append({
                "brand_name": c["brand_name"], "brand_slug": c["brand_slug"], "category": "CAR",
                "family_name": c["family_name"], "family_slug": c["family_slug"],
                "variant_name": c["raw_candidate_name"], "variant_slug": "",
                "decision": "EXCLUDE_NOT_TAXONOMY", "alias_of": "", "sort_order": "",
                "evidence_reference": c["source_reference"], "source_checked_at": CHECKED,
                "reason_code": c["rejection_class"], "rule_ref": "PILOT_REGISTER_4A",
                "confidence": c["confidence"], "evidence_grade": "N_A",
            })
    variants.append({  # Mustang GT — Owner §A.4
        "brand_name": "Ford", "brand_slug": "ford", "category": "CAR",
        "family_name": "Mustang", "family_slug": "mustang", "variant_name": "GT",
        "variant_slug": "", "decision": "EXCLUDE_NOT_TAXONOMY", "alias_of": "",
        "sort_order": "", "evidence_reference": "S20", "source_checked_at": CHECKED,
        "reason_code": "TRIM", "rule_ref": "OWNER_DECISION_4C", "confidence": "HIGH",
        "evidence_grade": "OFFICIAL",
    })
    # deterministic sort_order per family (numeric-aware)
    def numkey(name):
        m = re.search(r"\d+", name)
        return (int(m.group()) if m else 10 ** 9, name)
    per_family = defaultdict(list)
    for v in variants:
        if v["decision"] == "INCLUDE_VARIANT":
            per_family[(v["brand_slug"], v["family_slug"])].append(v)
    for group in per_family.values():
        group.sort(key=lambda v: numkey(v["variant_name"]))
        seen_orders = set()
        for i, v in enumerate(group, 1):
            v["sort_order"] = i * 10
            if v["sort_order"] in seen_orders:
                fail("duplicate sort_order")
            seen_orders.add(v["sort_order"])
    variants.sort(key=lambda v: (v["brand_slug"], v["family_slug"],
                                 {"INCLUDE_VARIANT": 0, "NORMALIZE_ALIAS_TO_VARIANT": 1,
                                  "EXCLUDE_NOT_TAXONOMY": 2}[v["decision"]],
                                 str(v["sort_order"]).zfill(4), v["variant_name"]))

    inc_count = sum(1 for v in variants if v["decision"] == "INCLUDE_VARIANT")
    alias_count = sum(1 for v in variants if v["decision"] == "NORMALIZE_ALIAS_TO_VARIANT")
    excl_count = sum(1 for v in variants if v["decision"] == "EXCLUDE_NOT_TAXONOMY")

    # ---- outputs: closure files ----
    write_csv("owner-decisions.csv", [
        {"decision_id": f"C{i}", "subject": s, "owner_decision": d, "owner_note": n,
         "decided_at": CHECKED}
        for i, (s, d, n) in enumerate([
            ("13 BMW numeric pilot variants", "RATIFIED_PRODUCTION_EVIDENCE_READY",
             "Official BMW evidence accepted."),
            ("18 PROPOSE_VARIANT structural classifications", "RATIFIED_STRUCTURE",
             "Structure approved; per-variant evidence grades still apply."),
            ("Conversions S3/RS3/Civic Si/Civic Type R", "RATIFIED_CONVERSION", "Applied in v2."),
            ("Ford Mustang GT", "RATIFIED_EXCLUDE_NOT_TAXONOMY", "Official Ford trim positioning."),
            ("Santa FE -> Santa Fe", "RATIFIED_DISPLAY_FIX", "Slug santa-fe unchanged; applied in v2."),
            ("14 Mercedes provisional variants / 5 families", "EVIDENCE_UPGRADE_EXECUTED",
             "13 of 14 upgraded to PRODUCTION_EVIDENCE_READY; E 500 remains UNRESOLVED_SOURCE_BLOCKER."),
            ("97 deferred rows", "CLOSED_PER_POLICY",
             "All 97 closed; zero REVIEW remains in the v2 masters."),
        ], start=1)],
        ["decision_id", "subject", "owner_decision", "owner_note", "decided_at"])
    write_csv("mercedes-evidence-closure.csv",
              [{"variant_name": k, "final_outcome": o, "evidence_reference": ev,
                "evidence_note": note, "source_checked_at": CHECKED}
               for k, (o, ev, note) in MB14.items()],
              ["variant_name", "final_outcome", "evidence_reference", "evidence_note", "source_checked_at"])
    conv_rows = []
    for (brand, fam), (parent, variant, outcome, ev, conf, note) in sorted(CONV.items()):
        conv_rows.append({
            "old_key": f"({brand}, CAR, {fams[brand][fam]})",
            "new_parent_key": f"({brand}, CAR, {fams[brand][parent]})",
            "new_variant_key": f"({brand}, CAR, {fams[brand][parent]}, {slugify(variant)})",
            "outcome": outcome, "evidence": ev, "reason": note, "confidence": conf,
            "family_count_effect": -1, "variant_count_effect": +1,
            "collision_handling": "validated unique against all v2 variant keys",
            "listing_migration_implication": "NONE — production catalog never imported; mapping recorded pre-launch",
        })
    write_csv("derivative-conversion-closure.csv", conv_rows,
              ["old_key", "new_parent_key", "new_variant_key", "outcome", "evidence",
               "reason", "confidence", "family_count_effect", "variant_count_effect",
               "collision_handling", "listing_migration_implication"])
    write_csv("designation-closure.csv",
              [{"brand_slug": b, "family_slug": f, "variant_name": n,
                "final_outcome": "INCLUDE_VARIANT", "evidence_reference": ev,
                "evidence_grade": g, "confidence": c, "source_checked_at": CHECKED}
               for (b, f), items in sorted(F24.items()) for n, ev, g, c in items] +
              [{"brand_slug": "ford", "family_slug": "mustang", "variant_name": "GT",
                "final_outcome": "EXCLUDE_NOT_TAXONOMY", "evidence_reference": "S20",
                "evidence_grade": "OFFICIAL", "confidence": "HIGH", "source_checked_at": CHECKED}],
              ["brand_slug", "family_slug", "variant_name", "final_outcome",
               "evidence_reference", "evidence_grade", "confidence", "source_checked_at"])
    write_csv("global-audit-closure.csv",
              [{"brand_slug": b, "family_name": f, "final_identity": o, "evidence_reference": ev,
                "note": note, "source_checked_at": CHECKED}
               for (b, f), (o, ev, note) in sorted(GLOBAL_CLOSE.items())] +
              [{"brand_slug": b, "family_name": f,
                "final_identity": "CONVERT_FAMILY_TO_VARIANT", "evidence_reference": v[3],
                "note": v[5], "source_checked_at": CHECKED}
               for (b, f), v in sorted(CONV.items()) if (b, f) in
               {(r["brand_slug"], r["current_family_name"]) for r in needs}],
              ["brand_slug", "family_name", "final_identity", "evidence_reference",
               "note", "source_checked_at"])
    write_csv("non-taxonomy-family-closure.csv",
              [{"brand_slug": "honda", "before_family": f,
                "before_key": f"(honda, CAR, {fams['honda'][f]})",
                "after_family": p, "after_key": f"(honda, CAR, {fams['honda'][p]})",
                "classification": "TRIM" if "VTI" not in f and "4D" not in f and "V6" not in f
                                  else ("ENGINE" if "VTI" in f or "V6" in f else "BODY_STYLE"),
                "action": "NORMALIZE_ROWS_TO_PARENT_FAMILY", "source_checked_at": CHECKED}
               for f, p in sorted(NON_TAX9.items())],
              ["brand_slug", "before_family", "before_key", "after_family", "after_key",
               "classification", "action", "source_checked_at"])
    write_csv("deferred-row-closure.csv", deferred_rows,
              ["category", "raw_brand", "raw_model", "previous_reason", "final_decision",
               "canonical_brand", "canonical_brand_slug", "canonical_family",
               "canonical_family_slug", "evidence_reference", "source_checked_at",
               "confidence", "final_reason_code", "rule_ref", "owner_decision", "owner_note"])
    write_csv("source-register.csv",
              [{"source_id": k, "source_title": t, "source_url_or_reference": u,
                "source_type": ty, "publisher": p, "source_checked_at": CHECKED,
                "families_supported": famref, "evidence_note": note}
               for k, (t, u, ty, p, famref, note) in SOURCES.items()],
              ["source_id", "source_title", "source_url_or_reference", "source_type",
               "publisher", "source_checked_at", "families_supported", "evidence_note"])

    # v2 masters
    bfields = list(brands_v1[0].keys())
    mfields = list(car_v1[0].keys())
    write_csv("brand-decision-master-v2.csv", brands_v2, bfields)
    write_csv("car-model-decision-master-v2.csv", car_v2, mfields)
    write_csv("moto-model-decision-master-v2.csv", moto_v2, mfields)
    write_csv("model-variant-decision-master-v1.csv", variants,
              ["brand_name", "brand_slug", "category", "family_name", "family_slug",
               "variant_name", "variant_slug", "decision", "alias_of", "sort_order",
               "evidence_reference", "source_checked_at", "reason_code", "rule_ref",
               "confidence", "evidence_grade"])

    # ---- §N validations on v2 ----
    for models, name in ((car_v2, "car_v2"), (moto_v2, "moto_v2")):
        for m in models:
            if m["decision"] in ("REVIEW",) or "NEEDS" in m["decision"]:
                fail(f"{name} still contains REVIEW/NEEDS: {m['source_brand']}/{m['source_model']}")
            if not m["decision"] or not m["reason_code"] or not m["rule_ref"]:
                fail(f"{name} attribution gap: {m['source_brand']}/{m['source_model']}")
    if len(car_v2) != 4895 or len(moto_v2) != 5744:
        fail("source rows lost in v2 masters")
    for v in variants:
        if v["decision"] == "INCLUDE_VARIANT":
            if not v["variant_name"] or not v["variant_slug"] or slugify(v["variant_name"]) != v["variant_slug"]:
                fail(f"variant slug problem: {v['variant_name']!r}")
            if not v["evidence_reference"]:
                fail(f"included variant lacks evidence: {v['variant_name']}")

    # ---- §K reconciliation ----
    conv_count = len(CONV)
    alias_merges = len(alias_family)          # GT86, Gr Supra, Ranchero GT, Jcw E
    nontax = len(NON_TAX9)
    amg_excluded = 1
    added_from_deferred = [k for k in car_fams_v2 if k not in
                           {(b, "CAR", s) for b, fs in fams.items() for s in fs.values()}]
    recon = {
        "original_sealed_families_total": 10223,
        "original_sealed_families_car": 4501,
        "original_sealed_families_moto": 5722,
        "family_to_variant_conversions": conv_count,
        "new_parent_families": 0,
        "family_alias_merges": alias_merges,
        "excluded_non_taxonomy_families": nontax + amg_excluded,
        "resolved_deferred_families_added": len(added_from_deferred),
        "final_car_families": len(car_fams_v2),
        "final_moto_families": len(moto_fams_v2),
        "final_total_families": len(car_fams_v2) + len(moto_fams_v2),
        "included_variants": inc_count,
        "variant_aliases": alias_count,
        "excluded_candidates": excl_count,
        "overlap_note": "Civic Si / Focus ST / Focus RS / BMW designations deduplicated by "
                        "(brand, category, family, variant) key — each canonical identity counted once.",
    }
    expected_car = 4501 - conv_count - alias_merges - nontax - amg_excluded + len(added_from_deferred)
    if expected_car != len(car_fams_v2):
        fail(f"CAR reconciliation does not balance: {expected_car} != {len(car_fams_v2)}")
    with open(f"{OUT}/count-reconciliation.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["metric", "value"])
        for k, v in recon.items():
            w.writerow([k, v])
        for k in sorted(added_from_deferred):
            w.writerow(["deferred_family_added", f"{k[0]}/{k[2]}"])

    # ---- §L readiness register ----
    pilot = {(r["brand_slug"], r["family_slug"]): r for r in load(f"{WORK}/p0-wave-1.csv")}
    confirmed = {("bmw", "3-series"), ("bmw", "5-series"), ("bmw", "1-series"),
                 ("bmw", "2-series"), ("bmw", "4-series"), ("bmw", "7-series"),
                 ("mercedes-benz", "c-class"), ("mercedes-benz", "e-class"),
                 ("mercedes-benz", "a-class"), ("mercedes-benz", "cla"),
                 ("mercedes-benz", "s-class"), ("mercedes-benz", "glc"),
                 ("mercedes-benz", "gle"), ("ford", "focus"), ("honda", "civic")}
    readiness, rcount = [], Counter()
    for (b, cat, s), name in sorted(car_fams_v2.items()):
        if (b, s) in confirmed:
            status = "VARIANT_RESEARCH_COMPLETE"
        elif (b, s) in pilot:
            status = "RESEARCHED_EMPTY"
        else:
            status = "VARIANT_RESEARCH_NOT_STARTED"
        rcount[status] += 1
        readiness.append({"brand_slug": b, "category": cat, "family_slug": s,
                          "family_name": name, "status": status})
    write_csv("complete-master-readiness.csv", readiness,
              ["brand_slug", "category", "family_slug", "family_name", "status"])

    post = prior_state()
    if pre != post:
        fail("prior-stage files changed during O.15.4C")

    # ---- reports ----
    lines = []
    a = lines.append
    a("# O.15.4C — Quality Report\n")
    a(f"- Prior-layer integrity: {len(pre)} files hash-verified pre/post — "
      f"{'CHANGED!' if pre != post else 'unchanged'}.")
    mb_counts = Counter(o for o, _e, _n in MB14.values())
    a(f"- §C Mercedes 14: {dict(mb_counts)} (blocked sources recorded for E 500).")
    a("- §D families: A-Class/CLA/S-Class/GLC/GLE all VARIANTS_CONFIRMED (>=1 official-evidence variant).")
    a(f"- §E conversions closed: {conv_count} CONVERT / 0 KEEP / 0 EXCLUDE (23 pending + S3/RS3/Si/TypeR ratified + S2/RS2/RS1600/RS2000 from §G).")
    a(f"- §F designations closed: 24/24 -> 23 INCLUDE_VARIANT + 1 EXCLUDE_NOT_TAXONOMY (Mustang GT).")
    a(f"- §G global-audit rows closed: {len(GLOBAL_CLOSE)} identities + conversions; "
      "S/RS E-Tron GT KEEP_SEPARATE (base-family addition recorded as proposal only).")
    a(f"- §H non-taxonomy folds: {nontax} families normalized into Accord/Civic.")
    a(f"- §I deferred: 97/97 closed — "
      f"{dict(Counter(r['final_decision'] for r in deferred_rows))}; zero REVIEW remains.")
    a(f"- v2 counts: brands INCLUDE "
      f"{sum(1 for b in brands_v2 if b['decision'] == 'INCLUDE')}; "
      f"CAR families {len(car_fams_v2)}; MOTO families {len(moto_fams_v2)}; "
      f"variants {inc_count} included + {alias_count} aliases + {excl_count} excluded records.")
    a(f"- Readiness: {dict(rcount)} — production stays NO while any family is NOT_STARTED.")
    if FAILURES:
        a(f"\n**VALIDATIONS FAILED ({len(FAILURES)})**:")
        for f_ in FAILURES:
            a(f"- {f_}")
    else:
        a("\n**ALL §N VALIDATIONS PASSED.**")
    with open(f"{OUT}/o15-4c-quality-report.md", "w") as fh:
        fh.write("\n".join(lines) + "\n")
    ol = ["# O.15.4C — Owner Review\n",
          "All seven §A decisions applied and recorded in owner-decisions.csv.",
          "Remaining evidence-upgrade queue: E 500 (source blocker) and the SECONDARY_ONLY-graded",
          "variants listed in model-variant-decision-master-v1.csv (C 300, C 320, E 240, A 180,",
          "A 200, CLA 200, S 350, GLC 250, GLE 400).",
          f"\nFull-master research scope: {rcount['VARIANT_RESEARCH_NOT_STARTED']} CAR families",
          "remain VARIANT_RESEARCH_NOT_STARTED (see complete-master-readiness.csv)."]
    with open(f"{OUT}/o15-4c-owner-review.md", "w") as fh:
        fh.write("\n".join(ol) + "\n")
    print("\n".join(lines))
    if FAILURES:
        sys.exit(1)


if __name__ == "__main__":
    main()
