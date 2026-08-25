# Favorites API (Phase 4.10)

Buyer favorites for the authenticated session user. All endpoints
require the session cookie (`401 AUTH_REQUIRED` otherwise); mutations
additionally pass the same-origin guard (`403 FORBIDDEN_ORIGIN`).
Responses use the standard envelope and are `Cache-Control: no-store`.
The contract speaks public listing ids only — internal UUIDs never
appear.

## GET /api/v1/me/favorites

Saved listings, most recently favorited first.

```json
{
  "data": {
    "items": [
      {
        "publicId": "10023",
        "category": "CAR",
        "brand": "Toyota",
        "model": "Corolla",
        "year": 2021,
        "priceMinor": 1500000,
        "currency": "AZN",
        "mileage": 42000,
        "city": "Bakı",
        "primaryImageUrl": "https://…signed…",
        "publishedAt": "2026-08-20T09:00:00.000Z",
        "favoritedAt": "2026-08-25T10:00:00.000Z",
        "isActive": true
      }
    ]
  }
}
```

A favorited listing that is no longer publicly visible stays in the
list with `isActive: false` and `primaryImageUrl: null` — the list
never silently shrinks, and hidden listings never get fresh signed
images.

## GET /api/v1/me/favorites/ids

`{ "data": { "publicIds": ["10023", "10057"] } }` — lightweight
bootstrap for heart-button state.

## PUT /api/v1/me/favorites/{publicId}

Adds a favorite. Idempotent (`200 { "favorited": true }` every time).
Returns `404 LISTING_NOT_FOUND` unless the listing is currently
publicly visible (`ACTIVE` and unexpired) — the same answer for
nonexistent, hidden, and malformed ids, so favoriting cannot be used
to probe hidden listings.

## DELETE /api/v1/me/favorites/{publicId}

Removes a favorite. Idempotent (`200 { "favorited": false }`), always
allowed regardless of the listing's current visibility.
