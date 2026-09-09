# Design ↔ Functional contract — freeze list
NO CHANGE to: public listing visibility rules · Listing Detail API semantics · Favorite semantics (tri-state, hydration-gated, login intent) · contact reveal endpoint + rate limiting · Premium rules · Boost rules · ACTIVE/SOLD/EXPIRED rules · image storage/serving · Seller flows · Moderator · Admin · Search · DB · payments.
| Design element | Preserved contract |
| --- | --- |
| Gallery / fullscreen | Existing image set + order; fullscreen is presentation-only |
| Contact CTA | Existing reveal endpoint, session persistence, rate limits |
| Favorite | Existing tri-state + anonymous login-intent flow |
| Kredit / Barter chips | Existing boolean listing attributes, display-only |
| Condition claims | Seller-submitted attributes, disclaimer wording only |
| SOLD/EXPIRED boards | Existing status visibility; no renewal for buyers |
| Motorcycle fields | Existing catalog contract decides field set |
| Similar-listings link (SOLD) | Existing search URL, not a recommendation engine |
Deviation policy: if implementation meets a technical constraint, preserve function, implement the closest faithful visual, and report the deviation — never silently redesign.