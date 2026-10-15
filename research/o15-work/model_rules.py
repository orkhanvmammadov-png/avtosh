# O.15.3A — curated CAR model-level rules, applied AFTER brand decisions.
# Exact (source_brand, source_model) overrides win over pattern rules;
# unlisted rows under included brands default to KEEP_FAMILY.
# decision values: KEEP_FAMILY / NORMALIZE_TO_FAMILY / REASSIGN_BRAND /
#                  EXCLUDE / REVIEW

# (source_brand, source_model) -> dict(decision=?, brand=?, family=?, reason=?, notes=?)
EXACT = {}

def _add(brand, model, decision, family=None, to_brand=None, reason=None, notes=None):
    EXACT[(brand, model)] = {
        "decision": decision, "family": family, "to_brand": to_brand,
        "reason": reason, "notes": notes,
    }

# --- BMW: extract foreign marques, fold M/ActiveHybrid derivatives -----------
for m, fam in [("Alpina B3", "B3"), ("Alpina B5", "B5"), ("Alpina B6", "B6"),
               ("Alpina B7", "B7"), ("Alpina B8 Gran", "B8"),
               ("Alpina Roadster S", "Roadster S"), ("Alpina XB7", "XB7")]:
    _add("BMW", m, "REASSIGN_BRAND", family=fam, to_brand="bmw-alpina",
         reason="SEALED_MARQUE_EXTRACTION", notes="BMW ALPINA is a separate marque.")
_add("BMW", "Alpina", "REVIEW", reason="BARE_MARQUE_ROW",
     notes="Marque name without a family; needs research assignment under BMW ALPINA.")
for m, fam in [("Mini", "Mini"), ("Mini Cooper", "Cooper"), ("Mini One", "One"),
               ("Cooper", "Cooper"), ("Cooper S", "Cooper"), ("One", "One"),
               ("Clubman Cooper", "Clubman")]:
    _add("BMW", m, "REASSIGN_BRAND", family=fam, to_brand="mini",
         reason="SEALED_MARQUE_EXTRACTION", notes="MINI is a separate marque.")
_add("BMW", "John Cooper Works", "REVIEW", to_brand="mini", reason="TRIM_OR_FAMILY",
     notes="JCW: trim vs standalone family is a taxonomy decision for MINI.")
for m, fam in [("M2", "2 Series"), ("M3", "3 Series"), ("M4", "4 Series"),
               ("M5", "5 Series"), ("M6", "6 Series"), ("M8", "8 Series"),
               ("M535i", "5 Series"), ("M635CSi", "6 Series"), ("M Roadster", "Z3"),
               ("ActiveHybrid 3", "3 Series"), ("ActiveHybrid 5", "5 Series"),
               ("ActiveHybrid 7", "7 Series"), ("ActiveHybrid X6", "X6"),
               ("Isetta 250", "Isetta"), ("Isetta 300", "Isetta")]:
    _add("BMW", m, "NORMALIZE_TO_FAMILY", family=fam, reason="DERIVATIVE_OF_FAMILY",
         notes="Performance/derivative row folded into its family; variant candidate for O.15 research.")
for m in ["Active", "3.0CS", "3.0S", "Cs"]:
    _add("BMW", m, "REVIEW", reason="HISTORICAL_TAXONOMY",
         notes="Historical coupe/unclear row; family assignment needs research.")

# --- Leyland umbrella rows ---------------------------------------------------
for m, fam in [("Mini", "Mini"), ("Mini 1000", "Mini"), ("Mini 850", "Mini"),
               ("Mini Mk", "Mini"), ("Mini Clubman", "Clubman"), ("Clubman", "Clubman"),
               ("Clubman 1100", "Clubman"), ("1000", "Mini"),
               ("Mini Moke", "Moke"), ("Moke", "Moke")]:
    _add("Leyland", m, "REASSIGN_BRAND", family=fam, to_brand="mini", reason="UMBRELLA_BADGE")
_add("Leyland", "MGB", "REASSIGN_BRAND", family="MGB", to_brand="mg", reason="UMBRELLA_BADGE")
_add("Leyland", "Range Rover", "REASSIGN_BRAND", family="Range Rover", to_brand="land-rover",
     reason="UMBRELLA_BADGE", notes="Sealed: Range Rover is a Land Rover family.")
_add("Leyland", "Princess", "REASSIGN_BRAND", family="Princess", to_brand="princess", reason="UMBRELLA_BADGE")
_add("Leyland", "Sherpa", "EXCLUDE", reason="COMMERCIAL_VAN")
_add("Leyland Cars", "Mini", "REASSIGN_BRAND", family="Mini", to_brand="mini", reason="UMBRELLA_BADGE")
_add("Austin-Morris", "Mini", "REASSIGN_BRAND", family="Mini", to_brand="mini", reason="UMBRELLA_BADGE")

# --- Auto Union / American / other umbrella rows ----------------------------
for b in ["Auto Union", "Auto-Union"]:
    _add(b, "Audi", "REVIEW", to_brand="audi", reason="BARE_MARQUE_ROW")
    _add(b, "Dkw", "REVIEW", to_brand="dkw", reason="BARE_MARQUE_ROW")
_add("Auto Union", "Audi 100GL", "REASSIGN_BRAND", family="100", to_brand="audi", reason="UMBRELLA_BADGE")
_add("Auto Union", "Audi 80", "REASSIGN_BRAND", family="80", to_brand="audi", reason="UMBRELLA_BADGE")
_add("Auto-Union", "Audi 100", "REASSIGN_BRAND", family="100", to_brand="audi", reason="UMBRELLA_BADGE")
_add("Auto-Union", "Audi 60", "REASSIGN_BRAND", family="60", to_brand="audi", reason="UMBRELLA_BADGE")
_add("Auto-Union", "Dkw Munga", "REASSIGN_BRAND", family="Munga", to_brand="dkw", reason="UMBRELLA_BADGE",
     notes="DKW marque materialized from Auto Union rows (absent as a CAR brand in source).")
_add("American", "Amx", "REASSIGN_BRAND", family="AMX", to_brand="amc", reason="UMBRELLA_BADGE")
_add("American", "Rambler", "REVIEW", to_brand="rambler",
     reason="BARE_MARQUE_ROW",
     notes="Marque as model with no family; Rambler families exist under the Rambler "
           "marque (3C QA: a family-less REASSIGN would leak an empty import key).")
_add("Continental", "Mark", "REASSIGN_BRAND", family="Mark", to_brand="lincoln", reason="BADGE_CONTINUITY")
_add("Volga", "Gaz-M21", "REASSIGN_BRAND", family="21", to_brand="gaz", reason="MARQUE_AS_MODEL")
_add("Volga", "M21", "REASSIGN_BRAND", family="21", to_brand="gaz", reason="MARQUE_AS_MODEL")
_add("GAC", "Aion", "EXCLUDE", reason="MARQUE_ROW", notes="Aion is its own marque; bare marque row dropped.")
_add("Aion", "Hyptec Ht 620 Premium", "REASSIGN_BRAND", family="HT", to_brand="hyptec",
     reason="SEALED_MARQUE_EXTRACTION", notes="Sealed: HYPTEC is the canonical marque (trim suffix stripped).")
_add("Aion", "Ut 420 Standard", "NORMALIZE_TO_FAMILY", family="UT", reason="TRIM_SUFFIX")
_add("Aion", "V 602 Luxury", "NORMALIZE_TO_FAMILY", family="V", reason="TRIM_SUFFIX")
import os

if os.environ.get("O15_DISABLE_STYLING_FIXES") != "1":  # 3A-replay switch for reconciliation
    _add("Aion", "Ut", "NORMALIZE_TO_FAMILY", family="UT", reason="STYLING",
         notes="Canonical display styling (3B QA: divergence with 'Ut 420 Standard' fold).")
    _add("AMC", "Amx", "NORMALIZE_TO_FAMILY", family="AMX", reason="STYLING",
         notes="Canonical display styling (3B QA: divergence with reassigned 'American Amx').")

# --- model-level exclusions under included brands ----------------------------
for b, m, why in [
    ("Piaggio", "Ape", "UTILITY_TRIKE"),
    ("Bond", "Bug", "THREE_WHEELER"), ("Bond", "Minicar", "THREE_WHEELER"),
    ("Steyr-Puch", "Pinzgauer 710 M", "MILITARY_UTILITY"),
    ("Maxus", "V80", "COMMERCIAL_VAN"), ("Maxus", "eDeliver 9", "COMMERCIAL_VAN"),
    ("Reliant", "Robin", "THREE_WHEELER"), ("Reliant", "Regal", "THREE_WHEELER"),
    ("Reliant", "Supervan", "COMMERCIAL_VAN"),
]:
    _add(b, m, "EXCLUDE", reason=why)

# --- NSU / Morgan / Sunbeam tidy-ups ----------------------------------------
for m, fam in [("Prinz 1000", "Prinz"), ("Prinz 4", "Prinz"),
               ("R080", "Ro 80"), ("R080 Wankel", "Ro 80")]:
    _add("NSU", m, "NORMALIZE_TO_FAMILY", family=fam, reason="SPELLING_VARIANT")
for m, fam in [("44", "4/4"), ("4/4 Series", "4/4"), ("1600", "4/4"),
               ("Plus 8 Pi", "Plus 8"), ("Plus Eight", "Plus 8"),
               ("Plus Four", "Plus 4"), ("Plus Six", "Plus 6"),
               ("Plus Six Supersport", "Plus 6"), ("Aero", "Aero 8")]:
    _add("Morgan", m, "NORMALIZE_TO_FAMILY", family=fam, reason="SPELLING_VARIANT")
for m in ["3000", "Sports"]:
    _add("Morgan", m, "REVIEW", reason="HISTORICAL_TAXONOMY")
for m, fam in [("Alpine GT", "Alpine"), ("Alpine Roadster", "Alpine"),
               ("Alpine Series", "Alpine"), ("Imp Sport", "Imp")]:
    _add("Sunbeam", m, "NORMALIZE_TO_FAMILY", family=fam, reason="TRIM_SUFFIX")
for m in ["Talbot", "Talbot 90", "Mk", "12-16HP"]:
    _add("Sunbeam", m, "REVIEW", reason="HISTORICAL_TAXONOMY")

# --- Toyota / misc spelling --------------------------------------------------
_add("Toyota", "4-Runner", "NORMALIZE_TO_FAMILY", family="4Runner", reason="SPELLING_VARIANT")
_add("Toyota", "Bb", "NORMALIZE_TO_FAMILY", family="bB", reason="SPELLING_VARIANT")
_add("Toyota", "BZ4X Touring", "NORMALIZE_TO_FAMILY", family="bZ4X", reason="DERIVATIVE_OF_FAMILY")
_add("Mercedes-Benz", "Classe", "REVIEW", reason="JUNK_VALUE")

# --- Lada sales-name -> family map ------------------------------------------
LADA_MAP = {
    "110": "2110", "111": "2111", "112": "2112",
    "1117": "Kalina", "1119": "Kalina",
    "1200": "2101", "1200 S": "2101", "1300": "2101",
    "1300 SL": "2105", "1500": "2103", "1500 S": "2106", "1600": "2106",
}
for m, fam in LADA_MAP.items():
    _add("Lada", m, "NORMALIZE_TO_FAMILY", family=fam, reason="EXPORT_SALES_NAME",
         notes="Export sales designation folded into the VAZ family.")

# --- Datsun sales-suffix folding --------------------------------------------
DATSUN_MAP = {
    "1200 De Luxe": "1200", "120Y Wagon": "120Y", "120 Y": "120Y",
    "1600 De Luxe": "1600", "1600 Sss": "1600", "160J Sss": "160J",
    "180B Wagon": "180B", "240 Z": "240Z", "240 Z Sport": "240Z",
    "260 Z": "260Z", "260Z 2+2": "260Z", "280 Z": "280Z",
    "260 C": "260C", "Coupe 1200": "1200", "Bluebird 1200": "Bluebird",
    "Fairlady 2000": "Fairlady", "180 Sx": "180SX",
}
for m, fam in DATSUN_MAP.items():
    _add("Datsun", m, "NORMALIZE_TO_FAMILY", family=fam, reason="SPELLING_VARIANT")

# --- Mercedes-Benz numeric handling -----------------------------------------
# v2 (O.15.3C reopened-QA corrections):
#  - van/T1/T2/Vario codes are checked FIRST and excluded, never folded into
#    passenger families (207 D / 208 D / 209 D class);
#  - 230-line suffixed rows are W114/W123 mid-size -> E-Class, never SL;
#  - 220-line suffixed rows are W115/W124 mid-size -> E-Class, never S-Class;
#  - 170 is the W136 passenger family "170", never the R170 SLK chassis code;
#  - 108 D / 109 D cannot be evidenced as passenger cars -> REVIEW.
# v1 kept ONLY for deterministic reconciliation replay (O15_MB_RULE_VERSION=1).
MB_VAN_HEADS = {"207", "208", "209", "307", "308", "309", "310", "311", "312",
                "313", "315", "316", "318", "319", "408", "410", "412", "413",
                "416", "508", "518", "608", "609", "709", "711", "809", "811", "814"}
MB_CHASSIS_V2 = {
    "108": "S-Class", "109": "S-Class", "116": "S-Class", "126": "S-Class",
    "140": "S-Class", "221": "S-Class", "222": "S-Class", "223": "S-Class",
    "123": "E-Class", "124": "E-Class", "210": "E-Class", "211": "E-Class",
    "212": "E-Class", "213": "E-Class",
    "202": "C-Class", "203": "C-Class", "204": "C-Class", "205": "C-Class", "206": "C-Class",
    "201": "190", "107": "SL", "113": "SL", "129": "SL",
    "163": "ML", "164": "ML", "166": "ML",
}
MB_CHASSIS_V1 = dict(MB_CHASSIS_V2, **{"220": "S-Class", "230": "SL", "170": "SLK"})


def _mb_v1(model: str):
    parts = model.split()
    head = parts[0]
    if not head.isdigit():
        return None
    if len(head) >= 4:
        return ("EXCLUDE", None, "COMMERCIAL_TRUCK", "Four-digit commercial chassis code.")
    suffix = " ".join(parts[1:]).upper()
    base = MB_CHASSIS_V1.get(head)
    if base is not None and suffix in ("", "C", "T", "D", "E", "CE", "TE", "TD", "CD"):
        return ("NORMALIZE_TO_FAMILY", base, "CHASSIS_CODE",
                "W-chassis code folded into the marketplace family.")
    if suffix in ("SL",):
        return ("NORMALIZE_TO_FAMILY", "SL", "SALES_DESIGNATION", None)
    if suffix in ("SE", "SEL", "SEC"):
        return ("NORMALIZE_TO_FAMILY", "S-Class", "SALES_DESIGNATION", None)
    if head == "190":
        return ("KEEP_FAMILY", "190", None, "Genuine marketplace family (W201 190).")
    if 200 <= int(head) <= 300 and suffix in ("D", "E", "CE", "TE", "TD", "CD", "T"):
        return ("NORMALIZE_TO_FAMILY", "E-Class", "SALES_DESIGNATION",
                "Pre-1994 mid-size sales designation folded into E-Class.")
    return ("REVIEW", None, "NEEDS_TAXONOMY_DECISION",
            "Numeric Mercedes row without a confident family mapping.")


def _mb_v2(model: str):
    parts = model.split()
    head = parts[0]
    if not head.isdigit():
        return None
    if len(head) >= 4:
        return ("EXCLUDE", None, "COMMERCIAL_TRUCK", "Four-digit commercial chassis code.")
    suffix = " ".join(parts[1:]).upper()
    # commercial codes FIRST — numeric similarity never maps a van into a car
    if head in MB_VAN_HEADS and suffix in ("", "D", "NGT", "KA", "D-KA"):
        return ("EXCLUDE", None, "COMMERCIAL_VAN_CODE",
                "T1/T2/Vario/Sprinter van sales code (reopened-QA correction).")
    if head in ("108", "109") and "D" in suffix.split():
        return ("REVIEW", None, "NEEDS_TAXONOMY_DECISION",
                "W108/W109 had no diesel; identity unsupported (reopened-QA).")
    if head == "170":
        return ("KEEP_FAMILY", "170", "HISTORICAL_FAMILY",
                "W136 170 passenger family (170 / 170 D exist as passenger cars).")
    base = MB_CHASSIS_V2.get(head)
    if base is not None and suffix in ("", "C", "T", "D", "E", "CE", "TE", "TD", "CD"):
        return ("NORMALIZE_TO_FAMILY", base, "CHASSIS_CODE",
                "W-chassis code folded into the marketplace family.")
    if suffix in ("SL",):
        return ("NORMALIZE_TO_FAMILY", "SL", "SALES_DESIGNATION", None)
    if suffix in ("SE", "SEL", "SEC"):
        return ("NORMALIZE_TO_FAMILY", "S-Class", "SALES_DESIGNATION", None)
    if head == "190":
        return ("KEEP_FAMILY", "190", "HISTORICAL_FAMILY", "Genuine marketplace family (W201 190).")
    if head in ("220", "230") and suffix in ("D", "E", "CE", "TE", "TD", "CD", "T", "C"):
        return ("NORMALIZE_TO_FAMILY", "E-Class", "SALES_DESIGNATION",
                "W114/W115/W123/W124 mid-size sales designation (reopened-QA correction).")
    if 200 <= int(head) <= 300 and suffix in ("D", "E", "CE", "TE", "TD", "CD", "T"):
        return ("NORMALIZE_TO_FAMILY", "E-Class", "SALES_DESIGNATION",
                "Pre-1994 mid-size sales designation folded into E-Class.")
    return ("REVIEW", None, "NEEDS_TAXONOMY_DECISION",
            "Numeric Mercedes row without a confident family mapping.")


def mercedes_numeric_rule(model: str):
    """Deterministic classification for Mercedes-Benz numeric-style rows.
    Returns (decision, family, reason, notes) or None to fall through."""
    if os.environ.get("O15_MB_RULE_VERSION") == "1":
        return _mb_v1(model)
    return _mb_v2(model)
