# @dainamite/cpq

## 0.6.0

### Minor Changes

- adcb50f: Negotiated prices on quotes (manual price adjustments) with a price waterfall.

  - New table `cpq_quote_price_adjustments` and column
    `cpq_quote_configurations.pricing_revision` (migration
    `Migration20261110213052`). **Upgrade steps for existing tenants (required):**
    `yarn mercato db migrate`, then `yarn mercato cpq seed-price-adjustments`
    (rollout toggle + reason dictionary) and `yarn mercato auth sync-role-acls`
    (`cpq.quotes.adjust_price` grant). Without them writes return `403` and the
    UI hides the actions. New tenants get all three at initialization.
  - Reps with `cpq.quotes.manage` + `cpq.quotes.adjust_price` can override a
    charge's unit price, take an amount off a charge or give a percentage on a
    charge or line (`/api/cpq/quotes/{quoteId}/price-adjustments`, plus a
    no-write `preview`). Adjustments are permanent, never exceed the standard
    price, never compound, and lock once the quote leaves New / Incomplete /
    Ready. Rollout toggle `cpq.manual_price_adjustments` (seeded on) and reason
    dictionary `cpq.price_adjustment_reason`.
  - Charges gain additive `listUnitPrice`, `listTotalPrice`, `standardUnitPrice`,
    `standardTotalPrice` and `adjustmentErrors`; adjustment entries gain
    `origin: 'rule' | 'manual'`. `pricingSummary` gains list / standard totals,
    rule and manual discount totals, deal value, discount depth and
    `snapshotHash`; `QuoteResult` gains `pricingRevision`. `discountTotal` is
    unchanged.
  - New events `cpq.quote.pricing_changed` and `cpq.quote.status_changed`
    (after commit, with the pricing snapshot) for project approval workflows.
  - Order conversion copies stored prices and returns `422 ADJUSTMENT_INVALID`
    when a stored adjustment is invalid. `POST /api/cpq/quotes/price` accepts
    `includeWaterfall` and never applies negotiated prices.
  - Quote, order and subscription pages show List / Offer prices and the
    waterfall; the quote page adds the adjustment dialog and panel.

- 8d57b1b: Harden quote pricing ahead of manual price adjustments.

  - `POST /api/cpq/quotes/{quoteId}/recalculate` now requires `cpq.quotes.manage`
    (was `cpq.quotes.view`), and a saved recalculation (`save: true`) on an
    accepted, rejected or cancelled quote returns `409`. Integrations that
    recalculate with a view-only API key must be granted `cpq.quotes.manage`.
  - Amend quotes no longer re-price items the operator does not touch: mirror
    lines keep the subscription's stored price until their configuration,
    quantity, term, dates or usage estimates change.
  - Status transitions, line add / update / remove, saved recalculations and
    quote-to-order conversion run every registered mutation guard
    (resource kinds `cpq.quote` and `cpq.quote_line`), so projects can enforce
    approvals. No behaviour change when no guard is registered.

## 0.5.0

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

## 0.4.0

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

## 0.3.0

### Minor Changes

- f111f9d: Add `mercato cpq seed` — a one-command loader for a minimal, neutral CPQ test catalog (a configurable product with a Specification, an Offering, and a fixed monthly charge) into a single tenant.

  - **Idempotent**: every row is matched by a stable `DEMO-CPQ-*` code/sku, so re-running is a no-op rather than a duplicate. The charge find-or-create keys on `(offering_id, code)` to match the DB uniqueness constraint.
  - **Scope**: resolves the primary organization created by `mercato init` when no `--tenant`/`--org` flag is given.
  - **`--reset`**: clears the seed's own rows before re-seeding.

  The seed is intentionally generic so it ships with the package; rich, vertical demo catalogs continue to live in app-level `demo_<x>` modules + `mercato demo_tenants seed`. Pairs with `mercato billing seed` (`@dainamite/billing`) and the consumer-side `yarn dainamite-cpq-test` / `yarn dainamite-test` aliases.

### Patch Changes

- 2261dfa: XD-289: ship `xlsx` as a runtime dependency so the pricing-table detail page works out of the box on fresh `create-mercato-app` scaffolds.

  `xlsx` was previously declared only in `peerDependencies` (alongside the rest of the React / MikroORM / `@open-mercato/*` peer set). That works in this monorepo because the root `package.json` already lists `xlsx`, but it broke for external consumers: installing `@dainamite/cpq` into a vanilla `create-mercato-app` project did not pull `xlsx` into `node_modules`, and the very first `yarn dev` after `yarn add @dainamite/cpq` crashed every page with

  ```
  Module not found: Can't resolve 'xlsx'
  > 1 | import * as XLSX from "xlsx";
      | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  @dainamite/cpq/dist/modules/cpq/backend/cpq/pricing/[id]/xlsxExport.js
  @dainamite/cpq/dist/modules/cpq/backend/cpq/pricing/[id]/xlsxImport.js
  ```

  (The pricing-table `[id]/page.tsx` statically imports both files, so Next.js
  bundles them for Client SSR and Client Browser regardless of which route the
  visitor actually opens — a single broken import takes down `/login` and the
  whole backend.)

  The peer-dependency rule from SPEC-001 ("never `dependencies` for sibling
  `@dainamite/*` / `@open-mercato/*`") exists to keep React, MikroORM, Next.js,
  and the rest of the framework as a single shared instance. `xlsx` is a
  CPQ-internal leaf library (used only by `pricing/[id]/xlsxExport.ts` and
  `xlsxImport.ts`); it has no decorator/context/hook contract that breaks under
  duplication, so promoting it to `dependencies` is safe and matches how leaf
  libs are normally distributed on npm.

  Consumers no longer need to `yarn add xlsx` after installing `@dainamite/cpq`.
  The package-isolation test (`__tests__/package-isolation.test.ts`) was updated
  in the same change so its allow-list comment mentions both `peerDependencies`
  and `dependencies` instead of just peers.

## 0.2.2

### Patch Changes

- 73650dc: Add MIT license for first public release.

  Switching `packages/cpq/package.json` `license` field from `UNLICENSED` (carry-over from the private era) to `MIT`, and shipping a `packages/cpq/LICENSE` file with the full license text. This matches the `@open-mercato/*` ecosystem and removes the "UNLICENSED" badge that public npm shows on packages without a recognized OSI license.

  No code or API changes — purely a licensing/metadata clarification ahead of the first publish to https://www.npmjs.com/package/@dainamite/cpq.

- 7b09790: Switch publish target from GitHub Packages to public npm.js.

  Initial publish attempts as `@dainamite/cpq` on GitHub Packages failed
  with `403 Forbidden — installation does not exist`: scope `@dainamite`
  on GitHub belongs to a different (unrelated) "DAInamite" organization
  based in Berlin. Switching to public npm.js, where the `@dainamite`
  scope is free, lets us keep the brand without renaming everything to
  `@dainamite-technologies/cpq`.

  Open Mercato itself publishes to public npm.js
  (`@open-mercato/core`, etc.), so this is also more consistent with the
  upstream ecosystem and matches the L2 model from SPEC-001.

  For consumers: install with plain `yarn add @dainamite/cpq` — no
  `.npmrc` auth setup needed.

## 0.2.1

### Patch Changes

- e44dfd1: Fix `repository.url` in package.json to point at
  `dainamite-technologies/dainamite-core` (was `dainamite/dainamite-core`).
  GitHub Packages requires the URL to match the publishing repo;
  mismatch returns `403 Forbidden — installation does not exist`.
  This blocked the inaugural publish of 0.2.0.

## 0.2.0

### Minor Changes

- 41c8b6d: Initial release of `@dainamite/cpq` as a standalone package.

  Configure-Price-Quote engine for Open Mercato: configurable product
  attributes, multi-charge pricing tables, guided quoting wizards,
  customer inventory & subscription tracking, ARC (Amend / Renew / Cancel)
  flows, quote → order → activation pipeline.

  This is the first release shipped from the dainamite-core monorepo as
  `@dainamite/cpq` on GitHub Packages. Source previously lived in
  `src/modules/cpq/` (in-tree, `from: '@app'`); now consumed via
  `peerDependencies` and registered as `{ id: 'cpq', from: '@dainamite/cpq' }`.

  Requires (peerDependencies): `@open-mercato/core ^0.5.0`,
  `@open-mercato/events ^0.5.0`, `@open-mercato/shared ^0.5.0`,
  `@open-mercato/ui ^0.5.0`, `@mikro-orm/core ^6.6.0`,
  `@mikro-orm/postgresql ^6.6.0`, `awilix ^12.0.0`, `next ^16.0.0`,
  `react ^19.0.0`, `react-dom ^19.0.0`, `zod ^4.0.0`, `bcryptjs ^3.0.0`,
  `lucide-react ^0.400.0`.

  Required Open Mercato modules (declared in `metadata.requires`):
  `auth`, `directory`, `catalog`, `sales`, `customers`, `dictionaries`.

### Patch Changes

- 8868606: Refresh README to reflect post-extraction state. Removes outdated
  "scaffold only" warning, documents install + register flow, lists
  required Open Mercato modules, and links to the package-isolation
  guard test.
