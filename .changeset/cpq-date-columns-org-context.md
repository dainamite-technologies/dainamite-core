---
'@dainamite/cpq': patch
---

- **Date columns everywhere in CPQ are handled as the `YYYY-MM-DD` strings MikroORM returns.** After the quote line fix, the same change covers subscriptions (`startDate`, `currentTermStart`, `currentTermEnd`), assets (`purchaseDate`, `deliveryDate`), order lines, ARC target subscriptions (`newTermStart`, `newTermEnd`) and merge renewals. Writes go through one helper, so renewals, amendments and edits of these dates store a valid date column value. No migration.
- **400 instead of 500 without an organization.** Every CPQ route now answers `400 Organization context is required` when the caller has no selected organization (an API key created without one, a superadmin viewing all organizations). Before, the request reached the database with an empty organization id and failed with 500.
- **Customer data is decrypted when a quote is created.** `POST /api/cpq/quotes` returned the customer name encrypted, and the quote's customer snapshot and `customer_domain` context were built from encrypted values. The customer is now read through the decryption helper.
