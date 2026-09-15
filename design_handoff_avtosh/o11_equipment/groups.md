# Groups (CAR — exactly 7, fixed group_code → label, display order fixed)
1 SAFETY → Təhlükəsizlik · 2 DRIVER_ASSISTANCE → Sürücü köməkçiləri · 3 PARKING_CAMERA → Park və kameralar · 4 COMFORT → Komfort · 5 CLIMATE_INTERIOR → Klimat və interyer · 6 MULTIMEDIA → Multimedia və texnologiya · 7 LIGHTING_EXTERIOR → İşıq və eksteryer. "Digər" only after known groups and only when legacy data exists.
- Item order within a group: catalog sort_order — never alphabetical override.
- 58 CAR-visible items total: ABS (existing global UUID, code ABS, group SAFETY) + 57 CAR-scoped. UPPER_SNAKE codes, UUID persistence, features.group_code — implementation constraints, not design decisions.
- MOTORCYCLE: ABS only, under Təhlükəsizlik; the 57 CAR items and their empty groups never render; with a single short group the search field is hidden.
- Legacy/unknown group (null or unrecognized code): fallback group "Digər", rendered last, ONLY when such features exist.
- No additional CAR groups may be invented.