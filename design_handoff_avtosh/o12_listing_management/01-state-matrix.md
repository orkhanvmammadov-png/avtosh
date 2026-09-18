# Seller-visible state matrix
Format: primary status | secondary chip | actions (priority order) | hidden/disabled | route/outcome.
| State | Primary | Chip | Actions | Hidden | Outcome |
| --- | --- | --- | --- | --- | --- |
| ACTIVE, no edit | Aktiv | — | Elana bax · **Redaktə et** · Deaktiv et (ghost) | — | edit→AXIN edit mode; deactivate→confirm→hidden immediately |
| ACTIVE + EDIT_DRAFT | Aktiv | Redaktə saxlanılıb | Elana bax · **Redaktəyə davam et** · Deaktiv et | second edit | resume same revision |
| ACTIVE + PENDING | Aktiv | Dəyişiklik moderasiyadadır | Elana bax · Redaktəyə bax · Deaktiv et | edit, cancel | read-only revision view; public listing stays live |
| ACTIVE + CORRECTION | Aktiv | Redaktəyə düzəliş tələb olunur (amber) | Elana bax · **Düzəliş et** · Deaktiv et | second edit | fix same revision; public = old approved version |
| DEACTIVATED, no edit | Deaktiv | — | **Aktiv et** · Redaktə et | Elana bax (public URL = not-found; no invented preview) | Aktiv et = instant reactivation, no moderation/fee/new period |
| DEACTIVATED + EDIT_DRAFT | Deaktiv | Redaktə tamamlanmayıb | **Redaktəyə davam et** · Aktiv et | — | Aktiv et NEVER publishes old version → routes to edit flow with context strip |
| DEACTIVATED + PENDING, no request | Deaktiv | Dəyişiklik moderasiyadadır | Aktiv et · Redaktəyə bax | — | Aktiv et records intent, listing stays hidden |
| DEACTIVATED + PENDING, requested | Deaktiv | Dəyişiklik moderasiyadadır + "Moderasiya sonrası aktivləşəcək" | Redaktəyə bax | Aktiv et (would mislead) | approval may complete reactivation |
| DEACTIVATED + CORRECTION | Deaktiv | Düzəliş tələb olunur | **Düzəliş et** | Aktiv et | fix → resubmit → approval may reactivate; intent persists |
| EXPIRED, no edit | Müddəti bitib | — | **Yenilə — 2 AZN** · Redaktə et (secondary) | — | existing renewal behavior |
| EXPIRED + EDIT_DRAFT | Müddəti bitib | Redaktə tamamlanmayıb | **Redaktəyə davam et** | renewal CTA | order: edit → moderation → renewal → active |
| EXPIRED + PENDING | Müddəti bitib | Dəyişiklik moderasiyadadır | Redaktəyə bax | renewal CTA | "Redaktə təsdiqləndikdən sonra yeniləmə mümkün olacaq." |
| EXPIRED + APPROVED edit | Müddəti bitib | Dəyişiklik təsdiqlənib (green) | **Yenilə və aktivləşdir — 2 AZN** · Redaktə et | — | verified payment → new 30-day period → public |
| REJECTED edit | (host status) | Redaktə rədd edilib | Redaktə et (new revision per lifecycle) | — | reactivation intent cleared; approved version unchanged |
| SUSPENDED / SOLD | existing O.10 cards | — | existing actions | O.12 edit/deactivate actions per lifecycle rules | unchanged |
Invariants: max one open edit revision; edits never bypass moderation; deactivation never pauses validity or Premium/Boost clocks; no fee/quota on edit approval; publicId unchanged.