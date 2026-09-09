# Interactions

## Gallery — desktop
Thumbnail click → selects image, outline moves. ‹ › step ±1; at boundaries arrows disable (40% opacity, no wrap). "+n" tile → jumps to that index (opens fullscreen layer where enabled). Keyboard: gallery focusable, ←/→ navigate, Enter on thumb selects, focus ring 2px green. Fullscreen = front-end layer over existing images; Esc closes.

## Gallery — mobile (390)
Swipe ±1 with momentum; counter + segment progress update; no arrows, no thumb rail; tap hero → fullscreen swipe view. No horizontal page overflow.

## Contact reveal
Tap/click "Nömrəni göstər" → existing reveal endpoint (rate limits unchanged) → button label becomes the number; stays revealed for the session per current contract; subsequent tap = tel: action if currently supported. Sticky bar (390) mirrors the same state.

## Favorite
Existing tri-state hydration-gated contract; anonymous tap follows the existing login-intent flow. Visual toggle per components.md.

## Description / features expanders
In-place expand/collapse, no navigation, no layout jump beyond content height.

## Sticky CTA (390)
Fixed bottom, z-index above content, below modals; safe-area padded; content reserves 72px; persists after reveal (showing the number); hidden entirely for SOLD/EXPIRED.

## SOLD / EXPIRED
No contact CTA anywhere (panel or sticky). Status board replaces the CTA area (see states.md). Gallery, favorite, description remain per current visibility rules.