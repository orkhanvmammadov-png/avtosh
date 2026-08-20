# Catalog API Contract (v1)

Public, read-only reference data for frontend forms and filtering.
All endpoints return the standard envelope (`{ "data": ... }` /
`{ "error": { code, message, details, request_id } }`) and echo
`X-Request-ID`. Full OpenAPI consolidation will follow once more API
surface exists; this document is the catalog contract until then.

Only **active** catalog data is ever returned. Inactive rows are
invisible to these endpoints.

## Semantics (applies to all endpoints)

| Situation | Response |
| --- | --- |
| Valid query, no matching rows | `200` with `"data": []` |
| Unknown or inactive category code | `400` `CATALOG_INVALID_CATEGORY` |
| Unknown reference group | `400` `CATALOG_INVALID_GROUP` |
| Brand unknown, inactive, or not linked to the requested category | `400` `CATALOG_INVALID_BRAND` |
| Malformed parameter (bad UUID, bad code shape, missing required) | `400` `VALIDATION_ERROR` (details list parameter + message) |

## Endpoints

### GET /api/v1/catalog/categories

No parameters. Active categories, ordered by `sort_order`, then name.

```json
{ "data": [ { "id": "<uuid>", "code": "CAR", "name": "Avtomobillər", "slug": "avtomobiller" } ] }
```

### GET /api/v1/catalog/brands?category=CAR

`category` (required): category code. Active brands linked to that
category via `brand_categories`, ordered by `sort_order`, then name.

```json
{ "data": [ { "id": "<uuid>", "name": "Toyota", "slug": "toyota" } ] }
```

### GET /api/v1/catalog/models?category=CAR&brand_id=<uuid>

`category` (required): category code. `brand_id` (required): brand
UUID. Active models of that brand **within that category** — a brand
in both CAR and MOTORCYCLE never leaks models across categories.

```json
{ "data": [ { "id": "<uuid>", "brandId": "<uuid>", "name": "Corolla", "slug": "corolla" } ] }
```

### GET /api/v1/catalog/cities

No parameters. Active cities, ordered by `sort_order`, then name.

```json
{ "data": [ { "id": "<uuid>", "name": "Bakı", "slug": "baki" } ] }
```

### GET /api/v1/catalog/options?group=FUEL_TYPE[&category=CAR]

`group` (required): reference group code (`FUEL_TYPE`,
`TRANSMISSION`, `BODY_TYPE`, `DRIVE_TYPE`, `MOTORCYCLE_TYPE`,
`COLOR`). `category` (optional): with a category, returns global
options plus options scoped to that category; without it, all active
options of the group. Category-scoped options never leak into other
categories (e.g. `BODY_TYPE` + `MOTORCYCLE` → `[]`).

```json
{ "data": [ { "id": "<uuid>", "code": "PETROL", "name": "Benzin" } ] }
```

### GET /api/v1/catalog/features?[category=CAR]

`category` (optional): same global-plus-scoped semantics as options.

```json
{ "data": [ { "id": "<uuid>", "code": "ABS", "name": "ABS" } ] }
```

## Error codes

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Malformed query parameters |
| `CATALOG_INVALID_CATEGORY` | 400 | Unknown/inactive category code |
| `CATALOG_INVALID_BRAND` | 400 | Brand unknown/inactive/not in category |
| `CATALOG_INVALID_GROUP` | 400 | Unknown reference group |
| `INTERNAL_ERROR` | 500 | Unexpected server error (no internals leaked) |
