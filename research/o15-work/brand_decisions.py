# O.15.3A — curated BRAND decision tables (reviewable source of truth).
# decision: INCLUDE (source name becomes/maps to its own canonical marque),
#           NORMALIZE (source name folds into another canonical marque slug),
#           EXCLUDE (never enters the AVTOSH catalog).
# Unlisted brands default to INCLUDE with a slugified canonical identity —
# every non-default decision is EXPLICIT here.

# --- sealed / canonical overrides (INCLUDE with non-default name/slug) -------
CAR_INCLUDE_OVERRIDES = {
    # source_name: (canonical_name, canonical_slug, reason_code, notes)
    "Alpina": ("BMW ALPINA", "bmw-alpina", "SEALED_DECISION", "Sealed: BMW ALPINA is a separate marque from BMW."),
    "DS": ("DS Automobiles", "ds-automobiles", "SEALED_DECISION", "Sealed: DS -> DS Automobiles."),
    "Deepal": ("DEEPAL", "deepal", "SEALED_DECISION", "Sealed: Deepal/Shenlan -> DEEPAL."),
    "Great Wall": ("GWM", "gwm", "SEALED_DECISION", "Sealed doctrine references GWM as the canonical marque (POER -> GWM)."),
    "De Lorean": ("DeLorean", "delorean", "STYLING", None),
    "De Soto": ("DeSoto", "desoto", "STYLING", None),
    "Vinfast": ("VinFast", "vinfast", "STYLING", None),
    "Škoda": ("Škoda", "skoda", "STYLING", "ASCII slug per slug doctrine."),
    "Citroën": ("Citroën", "citroen", "STYLING", "ASCII slug per slug doctrine."),
    "Lynk & Co": ("Lynk & Co", "lynk-co", "STYLING", None),
    "E.go": ("e.GO", "e-go", "STYLING", "e.GO Mobile — real small-series EV cars (Life)."),
    "Mini": ("MINI", "mini", "SEALED_DECISION", "Sealed: MINI is a separate marque from BMW."),
    "KGM": ("KGM", "kgm", "SEALED_DECISION", "Sealed: KGM and SsangYong remain separate identities."),
    "SsangYong": ("SsangYong", "ssangyong", "SEALED_DECISION", "Sealed: separate historical identity from KGM."),
    "Maybach": ("Maybach", "maybach", "SEALED_DECISION", "Sealed: historical Maybach separate from Mercedes-Maybach (the latter absent from source)."),
    "International": ("International", "international", "CONSUMER_SUV", "International Harvester Scout/Travelall — consumer SUVs."),
    "Panther": ("Panther Westwinds", "panther-westwinds", "NAME_COLLISION_REVIEWED", "CAR marque (Kallista/Lima) is distinct from the Panther motorcycle marque; reviewed same-name pair per O.15.2B doctrine."),
    "PGO": ("PGO Automobiles", "pgo-automobiles", "NAME_COLLISION_REVIEWED", "French PGO (Cevennes) is distinct from Taiwanese PGO scooters; reviewed same-name pair."),
    "Iso Rivolta": ("Iso Rivolta", "iso-rivolta", "CANONICAL", None),
    "Auto Union": ("Auto Union", "auto-union", "CANONICAL", None),
    "EBRO": ("EBRO", "ebro", "MODERN_REVIVAL", "Modern Spanish EBRO SUVs (S400/S700) — not the historical truck line."),
    "Aion": ("Aion", "aion", "CANONICAL", "GAC's Aion marque sold under its own badge."),
    "Bond": ("Bond", "bond", "CANONICAL", "Kept for the four-wheel Equipe; three-wheelers excluded at model level."),
    "Maxus": ("Maxus", "maxus", "CANONICAL", "Consumer MPVs (Euniq, Mifa); van models excluded at model level."),
    "Puch": ("Puch", "puch", "SHARED_MARQUE", "Shared CAR/MOTO marque (Puch G; motorcycles/mopeds)."),
    "Prince": ("Prince", "prince", "HISTORICAL", "Japanese Prince Motor Company."),
    "Princess": ("Princess", "princess", "HISTORICAL", "British Leyland marque."),
}

# --- CAR NORMALIZE: source name -> target canonical slug ---------------------
CAR_NORMALIZE = {
    "Bmw Alpina": ("bmw-alpina", "DUPLICATE_SPELLING", None),
    "Auto-Union": ("auto-union", "DUPLICATE_SPELLING", None),
    "American": ("amc", "HISTORICAL_MERGE", "American Motors rows (AMX); the Rambler row is reassigned to the Rambler marque at model level."),
    "Am General": ("hummer", "BADGE_CONTINUITY", "AM General Hummer became the Hummer marque."),
    "Austin-Morris": ("mini", "BADGE_VARIANT", "Single row: the classic Mini."),
    "Caterham Cars Ltd": ("caterham", "DUPLICATE_SPELLING", None),
    "Chevrolet GMC": ("chevrolet", "DUPLICATE_SPELLING", "Rows are Camaro/Corvette."),
    "Continental": ("lincoln", "BADGE_CONTINUITY", "1956-57 Continental Mark II marque; marketplace identity Lincoln."),
    "Dodge Brothers": ("dodge", "BADGE_CONTINUITY", None),
    "Eunos": ("mazda", "SALES_CHANNEL", "Mazda JDM sales channel."),
    "Gm Daewoo": ("daewoo", "DUPLICATE_SPELLING", None),
    "Iso": ("iso-rivolta", "DUPLICATE_SPELLING", None),
    "Kia Motors": ("kia", "DUPLICATE_SPELLING", None),
    "Leyland": ("mini", "UMBRELLA_BADGE", "Leyland rows are other marques' models (Mini/Moke/MGB/Range Rover/Princess); reassigned per model."),
    "Leyland Cars": ("mini", "UMBRELLA_BADGE", "Single row: Mini."),
    "Mcc": ("smart", "CORPORATE_NAME", "Micro Compact Car AG = Smart."),
    "Micro Compact Car": ("smart", "CORPORATE_NAME", None),
    "Piaggio": ("piaggio", "SHARED_MARQUE", "CAR row is the Ape utility trike (excluded at model level); marque lives in MOTO."),
    "Sachsenring": ("trabant", "CORPORATE_NAME", "Manufacturer of Trabant."),
    "Srt": ("dodge", "BADGE_CONTINUITY", "SRT Viper -> Dodge."),
    "Steyr-Puch": ("puch", "DUPLICATE_SPELLING", "Same marque family; Pinzgauer excluded at model level."),
    "Skyworth": ("skywell", "BADGE_CONTINUITY", "Skyworth Auto exports as Skywell."),
    "Valiant": ("plymouth", "BADGE_CONTINUITY", "Plymouth Valiant rows."),
    "Volga": ("gaz", "MARQUE_AS_MODEL", "Volga is a GAZ model family (21)."),
}

# --- CAR EXCLUDE: source name -> (reason_code, notes) ------------------------
CAR_EXCLUDE = {
    "Ahorn": ("CAMPER_RV", "Camper vans."),
    "Bravia": ("CAMPER_RV", "Swan camper conversions."),
    "Bürstner Gmbh": ("CAMPER_RV", "Motorhomes."),
    "Campereve": ("CAMPER_RV", "Campers."),
    "Fleetwood": ("CAMPER_RV", "Motorhomes."),
    "Font Vendome": ("CAMPER_RV", "Campers."),
    "Julia Camper": ("CAMPER_RV", "Campers."),
    "Westfalia Mobil Gmbh": ("CAMPER_RV", "Camper conversions."),
    "Yucon": ("CAMPER_RV", "Microliner campers."),
    "Vanster": ("CAMPER_RV", "Camper van conversions."),
    "Krismar": ("CAMPER_RV", "Campers."),
    "Binz": ("COACHBUILDER_SPECIAL", "Hearse/ambulance coachbuilder."),
    "Nilsson": ("COACHBUILDER_SPECIAL", "Hearse/limousine coachbuilder."),
    "Superior": ("COACHBUILDER_SPECIAL", "Hearse coachbuilder."),
    "Bedford": ("COMMERCIAL_ONLY", "Vans/trucks."),
    "Barkas": ("COMMERCIAL_ONLY", "Vans."),
    "Commer": ("COMMERCIAL_ONLY", "Vans."),
    "Carbodies": ("COMMERCIAL_ONLY", "London taxis."),
    "LEVC": ("COMMERCIAL_ONLY", "Electric taxi/van."),
    "LDV": ("COMMERCIAL_ONLY", "Vans."),
    "Mitsubishi Fuso": ("COMMERCIAL_ONLY", "Trucks."),
    "Beauford": ("KIT_REPLICA", "Kit wedding cars."),
    "Chamonix": ("KIT_REPLICA", "Spyder replicas."),
    "Marlin": ("KIT_REPLICA", "Kit sports cars."),
    "Spartan": ("KIT_REPLICA", "Kit cars."),
    "Stuart Taylor": ("KIT_REPLICA", "Kit cars."),
    "Sylva": ("KIT_REPLICA", "Kit cars."),
    "Tiger": ("KIT_REPLICA", "Kit racers."),
    "Westfield": ("KIT_REPLICA", "Kit sports cars."),
    "Polaris": ("ATV_UTV", "RZR UTV row."),
    "Aixam": ("LSV_QUADRICYCLE", "License-free quadricycles."),
    "Xev": ("LSV_QUADRICYCLE", "YOYO quadricycle."),
    "Toth Es Fiai": ("MICRO_ONEOFF", "Clever one-off/prototype-class trike."),
}

# --- MOTO overrides ----------------------------------------------------------
MOTO_INCLUDE_OVERRIDES = {
    "Gas Gas": ("GASGAS", "gasgas", "STYLING", None),
    "Cfmoto": ("CFMOTO", "cfmoto", "STYLING", None),
    "Qjmotor": ("QJMotor", "qjmotor", "STYLING", None),
    "Tm Racing": ("TM Racing", "tm-racing", "STYLING", None),
    "Wk Bikes": ("WK Bikes", "wk-bikes", "STYLING", None),
    "ČZ": ("CZ", "cz", "STYLING", "ASCII slug."),
    "Zundapp": ("Zündapp", "zundapp", "STYLING", None),
    "Francis/Barnett": ("Francis-Barnett", "francis-barnett", "STYLING", None),
    "Fantic Motor": ("Fantic", "fantic", "STYLING", None),
    "Kl Service": ("KL Service", "kl-service", "STYLING", None),
    "Chang Jiang": ("Chang Jiang", "chang-jiang", "CANONICAL", None),
    "Zero Motorcycles": ("Zero Motorcycles", "zero-motorcycles", "CANONICAL", None),
    "Can-Am": ("Can-Am", "can-am", "CANONICAL", "On-road Spyder/Ryker trikes (motorcycle-class)."),
    "Panther": ("Panther", "panther", "NAME_COLLISION_REVIEWED", "Phelon & Moore Panther motorcycles; distinct from CAR Panther Westwinds (reviewed pair)."),
    "PGO": ("PGO", "pgo", "NAME_COLLISION_REVIEWED", "Taiwanese PGO scooters; distinct from CAR PGO Automobiles (reviewed pair)."),
    "Boom": ("Boom", "boom", "PRODUCTION_TRIKE", "Production road trikes."),
    "Rewaco": ("Rewaco", "rewaco", "PRODUCTION_TRIKE", "Production road trikes."),
    "Segway": ("Segway", "segway", "CANONICAL", "Road-legal e-moped row."),
    "Livewire": ("LiveWire", "livewire", "STYLING", None),
    "Sur-Ron": ("Sur-Ron", "sur-ron", "CANONICAL", None),
    "Super Soco": ("Super Soco", "super-soco", "CANONICAL", None),
    "Quadro Vehicles": ("Quadro Vehicles", "quadro-vehicles", "CANONICAL", "Three/four-wheel road scooters."),
}

MOTO_NORMALIZE = {
    "Moto-Guzzi": ("moto-guzzi", "DUPLICATE_SPELLING", None),
    "BRP": ("can-am", "CORPORATE_NAME", "Marque row for Can-Am."),
    "Bombardier": ("can-am", "CORPORATE_NAME", "Marque row for Can-Am."),
    "KMZ": ("dnepr", "CORPORATE_NAME", "Kyiv Motorcycle Plant = Dnepr."),
    "Bisan-Lifan": ("lifan", "LICENSED_ASSEMBLY", "Turkish Lifan assembly."),
    "Bluroc Motorcycles": ("bluroc", "DUPLICATE_SPELLING", None),
    "Bullit": ("bluroc", "BADGE_CONTINUITY", "Bullit rebranded to Bluroc."),
    "Bullit Motorcycles": ("bluroc", "BADGE_CONTINUITY", None),
    "Kl": ("kl-service", "DUPLICATE_SPELLING", None),
    "Quadro": ("quadro-vehicles", "DUPLICATE_SPELLING", None),
}

MOTO_EXCLUDE = {
    "E-Tuk Factory": ("UTILITY_TRIKE", "Tuk-tuks."),
    "Tuk Tuk Factory": ("UTILITY_TRIKE", "Tuk-tuks."),
    "Tuktuk": ("UTILITY_TRIKE", "Tuk-tuks."),
    "Quaddy": ("ATV_UTV", "Quad."),
    "Kinroad": ("ATV_UTV", "Buggy."),
    "Carver": ("AUTOCYCLE", "Enclosed tilting three-wheeler."),
    "Peraves": ("AUTOCYCLE", "Cabin motorcycle (Monotracer)."),
    "Secma": ("LSV_QUADRICYCLE", "Fun quadricycle."),
    "Lehman": ("TRIKE_CONVERSION", "Conversion shop."),
    "White Knuckle": ("TRIKE_CONVERSION", "Conversion shop."),
    "Easy Rider": ("TRIKE_CONVERSION", "Conversion kits."),
    "Jzr": ("KIT_REPLICA", "Kit trikes."),
    "Renault": ("LSV_QUADRICYCLE", "Single row: Twizy quadricycle — not a motorcycle."),
    "Reliant": ("MISPLACED_ROW", "Robin is a three-wheel car, not a motorcycle."),
}

MOTO_REVIEW = {
    "Moto S.p.a.": "Single row 'WR250F' — looks like a mangled Yamaha entry; marque unverifiable from source.",
    "MGB": "Single row 'R8' — marque identity unverifiable from source.",
}

# Marques shared between CAR and MOTO that must resolve to ONE canonical slug.
SHARED_MARQUES = {
    "BMW", "Honda", "Suzuki", "KTM", "Peugeot", "Piaggio", "Puch", "NSU",
    "Adler", "IZh", "Sunbeam", "Morgan", "SWM", "Shineray", "Triumph", "Renault",
}
