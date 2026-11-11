# @dainamite/cpq-billing-connector

## 3.0.0

### Patch Changes

- Updated dependencies [adcb50f]
- Updated dependencies [8d57b1b]
  - @dainamite/cpq@0.6.0

## 2.0.0

### Minor Changes

- d7ce539: Require Open Mercato `0.9.0`. Peer ranges move from `^0.6.7` to `^0.9.0` for
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

### Patch Changes

- Updated dependencies [924c8b6]
- Updated dependencies [d7ce539]
  - @dainamite/billing@0.20.0
  - @dainamite/cpq@0.5.0

## 1.0.0

### Minor Changes

- 8834b8b: Require Open Mercato `0.6.7`. Peer ranges move from `^0.6.0` to `^0.6.7` for
  `@open-mercato/core`, `shared`, `ui`, `events` and `queue`, and the MikroORM
  peers from `^7.0.0` to `^7.1.5` (7.1 split the SQL layer into
  `@mikro-orm/sql`, so a shared 7.1 instance is required).

  No package source changes — this only narrows the supported framework range.
  Consumers on Open Mercato `0.6.0`–`0.6.6` must upgrade before taking these
  versions.

  Note for consumers running commands with a system identity (`ctx.auth: null`):
  `0.6.7` hardened `ensureTenantScope` / `ensureOrganizationScope`. Those calls
  are still no-ops with `auth: null`, but an unscoped organization command now
  logs a warning and will throw `403` if `OM_ENFORCE_ORG_SCOPE_STRICT=true`.

### Patch Changes

- Updated dependencies [8834b8b]
  - @dainamite/cpq@0.4.0
  - @dainamite/billing@0.19.0

## 0.1.1

### Patch Changes

- f8210ac: Bump `@dainamite/billing` peer dependency to `^0.18.0` (prepaid billing,
  SPEC-002 / XD-304). No connector code changes — the connector keeps emitting
  the same command-bus calls; this only widens the supported billing range.
- Updated dependencies [f8210ac]
  - @dainamite/billing@0.18.0

## 0.1.0 — Initial release (unreleased)

- 6 subscribers translating CPQ subscription lifecycle events to
  `@dainamite/billing` command-bus calls:
  - `cpq.subscription.activated` _(awaits CPQ upstream PR)_ → create
    Billing Account if missing, bulk-create Billing Items per charge.
  - `cpq.subscription.amended` → bulk-add new items (including the
    proration `one_time` Item the connector computes here), set
    `bill_end_date` on removed items.
  - `cpq.subscription.renewed` → extend `bill_end_date` + bulk-add any
    new items.
  - `cpq.subscription.cancelled` → set `bill_end_date` on every item
    for the cancelled subscription.
  - `cpq.subscription.merged` → re-link items from source
    subscriptions to the merged target.
  - `cpq.subscription.superseded` → set `bill_end_date` on every
    item for the superseded subscription.
- Pure helpers:
  - `lib/prorationHelper.ts` — `unitPrice × quantity × daysRemaining
/ daysInPeriod` with half-up 2dp rounding, matching the spec's
    invoice-amount rounding policy. Proration math lives here (not
    in CPQ) so CPQ stays neutral on billing calendar semantics.
  - `lib/chargeMapper.ts` — CPQ charge → billing item create payload.
- `lib/billingApiClient.ts` — internal commandBus wrapper. Subscribers
  go through the same command IDs that the billing REST routes
  use — `billing.accounts.create`, `billing.items.bulk_create`,
  etc. — so there is only one write path for billing state. Item
  creation always goes through `billing.items.bulk_create` (one
  batched account lookup + idempotency query + flush) rather than a
  per-item loop.
- Module ID: `cpq_billing_connector` (plural-ish-snake-case, matches
  OM's `auth` / `customers` / `dictionaries` convention).
