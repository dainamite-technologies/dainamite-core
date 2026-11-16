---
'@dainamite/cpq': patch
---

API fixes:

- **Updates no longer reset fields you did not send.** The update schemas for specifications, offerings, relationships, attributes, charges, price rules, pricing tables, pricing table entries and wizards filled in create-time defaults. A `PUT` with only `{ id, isActive }`, such as the price rule active toggle in the admin UI, reset `sortOrder` to 0. Other partial updates could reset `offeringType`, `lifecycleStatus`, `designTimeValues` and similar fields. Updates now change only the fields in the request.
- **Inventory routes return 404** instead of 500 when a subscription, subscription item or asset does not exist. Subscription and asset status transitions keep their 409 for invalid transitions.
- **`PUT /api/cpq/product-offerings` checks V-OFF-7** when `specId` or `offeringType` changes: the offering type must match the specification type, as on create.
- **`GET /api/cpq/quotes/attributes`** answers 400 for malformed `configuration` JSON instead of 500.
- `POST /api/cpq/offering-components` and `/api/cpq/bundle-slots` no longer return raw internal error messages in 500 responses.
