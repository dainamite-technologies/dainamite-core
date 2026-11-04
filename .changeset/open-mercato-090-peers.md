---
"@dainamite/cpq": minor
"@dainamite/billing": minor
"@dainamite/cpq-billing-connector": minor
---

Require Open Mercato `0.9.0`. Peer ranges move from `^0.6.7` to `^0.9.0` for
`@open-mercato/core`, `shared`, `ui`, `events` and `queue`, and the MikroORM
peers from `^7.1.5` to `^7.1.14`. Consumers on Open Mercato `0.6.x`–`0.8.x`
must upgrade before taking these versions.

`@dainamite/cpq` and `@dainamite/billing` now peer on `@tanstack/react-table`
`^9.0.0` (was `^8.0.0 || ^9.0.0`): Open Mercato 0.7 moved its `DataTable` to
TanStack Table v9, and list pages now import `LegacyColumnDef` from
`@tanstack/react-table/legacy`, which v8 does not have.

`@dainamite/cpq` also fixes CPQ quote and order API routes answering `500`
instead of the service's typed status (e.g. `404 Quote not found`). Next
bundles the package once per server layer and the DI container is shared, so
the route could catch a `QuotingError` / `OrderError` from the other copy of
the class and `instanceof` failed. Both classes now carry a `Symbol.for`
brand; new `isQuotingError` / `isOrderError` guards are exported alongside
them and should be used instead of `instanceof` in route handlers.
