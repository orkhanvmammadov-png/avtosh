# Section states (semantics fixed — do not reinterpret)
| State | Visual | Meaning |
| --- | --- | --- |
| UPCOMING | ○ + 55% opacity row, non-interactive | not yet reached; NEVER shows ✓ even if all its fields are optional |
| CURRENT | ● open card, 2px #147A4E border | the stage the seller is on |
| VISITED | ✓ (green check) collapsed row + one-line summary + Dəyiş | stage visited / acknowledged — NOT "all optional data entered". Detallar visited fully empty is a valid ✓ state |
| NEEDS ATTENTION | red ● + 1px #B3261E border + inline message + "Düzəlt" | visited AND required data invalid (Satış missing price; Şəkillər <3 confirmed; Əlaqə invalid phone/name) |
VISITED ≠ VALIDATED COMPLETE — implementation docs must not infer completion from the checkmark. Needs-attention never appears on untouched optional data or unvisited stages. All states carry icon + text (never color-only).