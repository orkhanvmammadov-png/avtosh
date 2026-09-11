# Contracts
## NO CHANGE (frozen)
first 3 NEW listings free lifetime / 4th+ = 2 AZN · quota semantics (delete ≠ restore) · catalog values + UUID semantics · Category→Brand→Model relationships · image min 3 / max 20 (config per product rules) · moderation, correction, resubmission, listing lifecycle · existing payment rules · existing promotion activation rules · Premium meaning (homepage) · Boost meaning (relevant search top).
## AUDIT DEPENDENT (Claude Code must verify before implementing)
1. Seller contact persistence — source of name/phone, draft/autosave coverage.
2. Seller contact editability — per-listing edit vs profile-bound; must never mutate auth phone.
3. Secondary phone — listing/contact DTO + reveal endpoint multi-number support.
4. Promotion intent persistence — where the review-step choice is stored.
5. Promotion payment orchestration after ACTIVE — intent creation timing; no combined checkout.
## Deviation policy
Preserve functional behavior; implement closest faithful visual; report deviations; never silently redesign.