# @dainamite/cpq

## 1.3.0

### Minor Changes

- aa79996: Devices on ARC quotes (#126). Amend, Renew and Cancel quotes show the subscription's devices (assets) as unpriced lines under their bundle, so they can be kept, returned or swapped; removed devices are returned at activation. A device added on an ARC quote creates only an asset, like a new sale. Billing now receives a device's own charges (new sale and ARC add), stops billing returned devices, and re-rates items whose recurring price changed on an Amend or Renew (`changedItems`).
- b80fcbd: Catalog AI tools (#128): `cpq.create_offering`, `cpq.add_bundle_component` and `cpq.remove_bundle_component`, available only to the new `cpq.catalog_assistant` agent for catalog admins (`cpq.offerings.manage`). Every write goes through the approval card; the quoting assistant cannot change the catalog. Run `yarn generate` after upgrading.
- feea38b: Component-only offerings (#133). Offerings get `isSellable` (TMF620): when false, the offering can only be quoted as a bundle component. Adding it as a top-level quote line returns 422 `V-QLINE-1`, and conversion to an order re-checks it. Specifications get `defaultOfferingSellable`, which pre-fills the flag on new offerings. The quote "Add Offering" picker, the wizard offering step and `cpq.list_offerings` can filter on it. Bundle default expansion now skips child offerings that are not lifecycle-active. Run `yarn mercato db migrate` after upgrading.
- 28daa65: The CPQ Quoting Assistant can now find the customer of a quote: the read-only core tools `customers.list_companies`, `customers.get_company`, `customers.list_people`, `customers.get_person`, `customers.list_deals` and `customers.get_deal` are on its allowlist, and the prompt tells it to use them for the `customerId` and `dealId` of `cpq.create_quote`. Before, drafting a quote from the chat needed a built search index. New starter suggestion "Draft a quote". Run `yarn generate` after upgrading.

  Fix: `GET /api/cpq/quotes?search=` answered 500 for every search (it ran `ilike` on uuid columns). It now matches the quote number (case-insensitive substring) or an exact quote, sales quote or customer id, so the agent can find "QUOTE-20261123-00003".

### Patch Changes

- a4df5a5: Renewal billing: `cpq.subscription.renewed` now carries `removedSubscriptionItemIds`, and the billing connector ends the Billing Items of those items (and devices) the day before the new term starts. Before, items dropped at renewal kept billing. The renewal term extension now moves `bill_end_date` only for items that run to the old term end, so items ended earlier by an amendment, a cancellation or an operator are no longer revived.
- b3916fd: CPQ Quoting and Catalog assistants propose one write at a time. Two approval cards for the same quote shared one record version, so after the first was confirmed the second was refused as stale (412) and the chat showed the card again with no error.

  They also re-read the saved quote when the operator continues after a confirmed card. The chat history holds only message text, so the agent used to call its own earlier prices unverified and try to create the quote again.

- 6e7e95c: Merge renewal keeps the bundle hierarchy: carried-over components stay under their cloned bundle item instead of becoming top-level items. Before, later Amend and Renew quotes on the merged subscription saw the components as standalone items.

## 1.2.0

### Minor Changes

- a09cdee: Bundles can be set up and quoted end to end (#122, #123, #124, #125).

  - `POST /api/cpq/product-offerings`: `offeringType` is optional and defaults to the specification's `specType`. Sending a type that does not match still returns 400 `V-OFF-7`. The admin create forms show the type read-only.
  - A bundle component that was removed can be added again. Migration `Migration20261117120000_cpq_offering_components_partial_unique` turns `cpq_off_comp_unique` into a partial unique index over live rows; run `yarn mercato db migrate`. `POST /api/cpq/offering-components` and `POST /api/cpq/bundle-slots` return 404 for an unknown offering, slot or specification and 409 `V-COMP-5` for a concurrent duplicate, instead of 500.
  - `POST /api/cpq/quotes/{quoteId}/items` accepts `expandBundleDefaults: true`. For a bundle offering it adds each active default component as a child line (recursively, capped at each slot group's maximum), with the bundle's term and dates and, per attribute, the bundle line's value for the same code or the attribute's default. Without the flag nothing changes. The admin quote page, the wizard steps and the `cpq.add_quote_line` AI tool send it; the tool now also requires `cpq.offerings.view`.
  - Quote-time bundle rules V-QBUN-1..3: a bundle line whose required slot group is short (or over its maximum) is incomplete and its error names the slot; a child line that is not a component of its bundle (and not a `parent_child` add-on) is flagged. `validationResult.errors` may contain `type: 'bundle_slot'` entries with `slotGroup` / `slotName`.
  - **Behaviour change:** `POST /api/cpq/orders` returns 422 `BUNDLE_INCOMPLETE` (with the V-QBUN `errors`) for a quote whose stored validation has bundle-slot errors. Other invalid states convert as before. Slot rules skip Cancel quotes and bundles mirrored unchanged from a subscription.
  - A valid line for an offering with no charge definitions (e.g. included equipment) is now configured. When an offering has charges but none applies, the line stays incomplete with `V-LINE-1` (`type: 'charge'`) instead of an unexplained "incomplete".

## 1.1.0

### Minor Changes

- dc9a79d: `POST /api/cpq/orders/:orderId/activate` now runs the framework mutation guards before activating (resource kind `cpq.order`, operation `update`, payload `{ action: 'activate', orderId }`). A blocking guard's status and body are returned as-is (typically 422). After-success callbacks run once the activation commits. The route now exports `openApi`. `POST /api/cpq/orders/:orderId/status` runs the same guards: a transition to `active` carries `{ action: 'activate', orderId, targetStatus }`, so it cannot bypass an activation rule, and other transitions carry `action: 'transition'`. This is a new extension hook (minor). With no guard registered, behaviour is unchanged.

## 1.0.1

### Patch Changes

- ca49e24: CPQ now writes sales and catalog records through the owning module instead of editing them directly.

  - Deleting a CPQ quote (`DELETE /api/cpq/quotes/{quoteId}`) removes the underlying sales quote and its lines with the sales module's `sales.quotes.delete` command. Sales events, the audit log entry (with undo) and search/index cleanup now run. The sales quote is removed the way the sales module removes quotes (not just flagged as deleted); the CPQ quote and its line configurations are still soft-deleted. The response is unchanged.
  - Creating a product specification without a `productId` (`POST /api/cpq/product-specifications`) creates the catalog product with the catalog module's `catalog.products.create` command, so catalog events, audit log and indexing run. Reusing an existing product by handle or SKU works as before.
  - Undoing the delete from the audit log restores the whole CPQ quote: the sales quote comes back through the sales undo, and a CPQ command interceptor restores the CPQ configuration and the lines deleted with it. A redo of the delete, or deleting the quote in the sales module, now also soft-deletes the CPQ quote instead of leaving it pointing at a missing sales quote. Deleting a sales quote whose CPQ quote is accepted, rejected or cancelled is refused with 409 everywhere, as the CPQ route already did, so an accepted amend or cancel quote can no longer lose its CPQ configuration before its order is activated. Run `yarn generate` after upgrading.
  - Errors raised by those commands (for example 403 scope, 409 duplicate) are returned with their own status instead of a generic 500.

- 86c3ed4: - **Date columns everywhere in CPQ are handled as the `YYYY-MM-DD` strings MikroORM returns.** After the quote line fix, the same change covers subscriptions (`startDate`, `currentTermStart`, `currentTermEnd`), assets (`purchaseDate`, `deliveryDate`), order lines, ARC target subscriptions (`newTermStart`, `newTermEnd`) and merge renewals. Writes go through one helper, so renewals, amendments and edits of these dates store a valid date column value. No migration.
  - **400 instead of 500 without an organization.** Every CPQ route now answers `400 Organization context is required` when the caller has no selected organization (an API key created without one, a superadmin viewing all organizations). Before, the request reached the database with an empty organization id and failed with 500.
  - **Customer data is decrypted when a quote is created.** `POST /api/cpq/quotes` returned the customer name encrypted, and the quote's customer snapshot and `customer_domain` context were built from encrypted values. The customer is now read through the decryption helper.

## 1.0.0

### Major Changes

- 478c144: First stable release: `1.0.0`. No code or API changes against `@dainamite/billing@0.22.0` and `@dainamite/cpq@0.8.0`.

  From now on the packages follow semver in the 1.x line: new features bump the minor version, fixes bump the patch version, and only breaking changes bump the major version. Upgrade by changing your range to `^1.0.0`.

### Minor Changes

- 9370e52: CPQ now works with the Open Mercato AI assistant, in the in-app AI chat and for MCP clients.

  - **24 AI tools** (`ai-tools.ts`), each a thin wrapper over an existing CPQ REST route, so they use the same permissions, tenant scoping and validation as the API. Read tools: offerings, specifications and their attributes, bundle trees, configurable attributes for an offering, price calculation (`cpq.calculate_price`), offering combination validation, price rules, quotes with lines and totals, subscriptions, assets, a customer's installed base, expiring subscriptions, subscription change log, and orders.
  - **4 write tools**: create a draft quote, add a configured line, update a line, submit a quote for approval. They run only after the operator confirms the preview card in the AI chat. A direct call, for example from an MCP client, is refused and nothing is written.
  - **CPQ Quoting Assistant** agent (`cpq.quoting_assistant`, needs `cpq.quotes.view`). It knows the CPQ concepts, always prices through the calculate-price API instead of guessing, and asks before any write. A tenant can lock it to read-only in `/backend/config/ai-assistant/agents`.
  - **New required peer dependency (breaking)**: `@open-mercato/ai-assistant` `^0.9.0`, and the `ai_assistant` module must be enabled. It ships in the 1.0.0 major. See `MIGRATION.md`.

  No new permissions and no migrations. After upgrading, run `yarn generate` and restart the app. Try it at `/backend/config/ai-assistant/playground`. Details: `manuals/cpq-ai-agent.md`.

### Patch Changes

- d31e4fa: Declare the customer inventory features in `acl.ts`: `cpq.inventory.view` and `cpq.inventory.manage`. Routes and the admin and employee roles already used them, but they were never declared, so they could not be assigned to other roles in the RBAC UI.

  `GET /api/cpq/inventory/subscriptions/expiring` now requires `cpq.inventory.view`. It used to require `cpq.inventory.expiring.view`, a feature that was retired, so no role could call the endpoint.

  For existing tenants, run `yarn mercato auth sync-role-acls --tenant <id>` after the upgrade.

- c49d3f6: API fixes:

  - **Quote lines with a start date no longer fail.** `CpqQuoteLineConfiguration.startDate` / `endDate` are `type: 'date'` columns, which MikroORM reads back as `YYYY-MM-DD` strings. Code called `.toISOString()` on them and assigned `Date` objects, so recalculating or reading a quote with a dated line returned 500, and editing a dated line (term, start or end) failed. Order activation also created the subscription without the quote line's start date. The properties are now typed as strings and all reads go through one helper. No migration.

  - **Updates no longer reset fields you did not send.** The update schemas for specifications, offerings, relationships, attributes, charges, price rules, pricing tables, pricing table entries and wizards filled in create-time defaults. A `PUT` with only `{ id, isActive }`, such as the price rule active toggle in the admin UI, reset `sortOrder` to 0. Other partial updates could reset `offeringType`, `lifecycleStatus`, `designTimeValues` and similar fields. Updates now change only the fields in the request.
  - **Inventory routes return 404** instead of 500 when a subscription, subscription item or asset does not exist. Subscription and asset status transitions keep their 409 for invalid transitions.
  - **`PUT /api/cpq/product-offerings` checks V-OFF-7** when `specId` or `offeringType` changes: the offering type must match the specification type, as on create.
  - **`GET /api/cpq/quotes/attributes`** answers 400 for malformed `configuration` JSON instead of 500.
  - `POST /api/cpq/offering-components` and `/api/cpq/bundle-slots` no longer return raw internal error messages in 500 responses.

## 0.8.0

### Minor Changes

- a4fb34b: Billing setup on the CPQ order: choose the billing account and set the bill start per line before activation.

  **`@dainamite/cpq`**

  - **New injection spot `cpq.order.detail:tabs`** on the CPQ order detail page. Widgets with `kind: 'tab'` become tabs next to "Line items". With nothing injected the page renders exactly as before. Context: `{ orderId, salesOrderId, cpqStatus, customerId, currencyCode, quoteType }`; `data` is the order API result.
  - **Richer `cpq.subscription.activated` payload** (additive, all optional): `customerName`, `customerKind`, `invoiceEmail` and `invoiceAddress` from the sales order snapshot (decrypted), plus `items[].orderLineId` and `items[].startDate`. Declared in `events.ts` `payloadSchema`.
  - **`cpqOrderService.getOrderCustomerFields(orderId, scope)`**: the same customer fields, for add-ons that need them before activation.
  - **ARC events** (`cpq.subscription.amended` / `renewed`): `addedItems[].orderLineId` and `addedItems[].startDate` (additive), matched from the change log's quote line to the order line built from it.

  **`@dainamite/cpq-billing-connector`**

  - **Billing tab on CPQ orders.** Use an existing billing account (only active accounts of the customer in the order's currency) or create a new one prefilled from the customer, with every field editable. One default bill start for the order ("on activation" by default), changeable per line.
  - **No more junk accounts.** A new account takes the customer's name, email and billing address instead of `Customer <uuid>`, `billing+<id>@invalid.local` and `TBD`. Placeholders are only a last resort.
  - **Bill start per line:** line override → CPQ service start → order default → activation date. A new account's first bill date is the earliest bill start.
  - **Amend / renew orders:** the Billing tab sets the bill start of the **added** lines only (fallback: the effective date for amend, the new term start for renew). They always bill to the subscription's existing account. `renewed` / `amended` lock the setup once applied. Cancel orders show "nothing to bill". Multi-subscription (merge) renewals are not covered: `cpq.subscription.merged` carries no added items.
  - **Fix:** activation never reuses an inactive account or one in another currency (it used to take the customer's first account). `cpq.subscription.amended` adds items to the subscription's own account.
  - **API:** `GET` / `PUT /api/cpq_billing_connector/order-setups/:orderId` (undoable command `cpq_billing_connector.order_setup.save`). **ACL:** `cpq_billing_connector.order_setup.view` / `.manage` (admin: both; employee: view).
  - **Migration** `Migration20261115000000_cpq_billing_connector_order_setups` (the connector's first table). Run `yarn mercato db migrate`, then `yarn generate`.
  - New peer dependencies: `@open-mercato/ui`, `next`, `react`, `react-dom` (the connector now ships UI).

## 0.7.0

### Minor Changes

- d86651d: CPQ UI in English, Spanish, German and Polish.

  - **Dictionaries.** New `i18n/{en,es,de,pl}.json` (1218 keys). CPQ previously shipped no dictionaries, so every screen rendered English in every locale.
  - **Every UI string is translatable.** Hard-coded labels in quotes, orders, the quote wizard, specifications, offerings, inventory, price rules, pricing tables, wizard definitions, shared components and the injected widgets now go through `t()`. English text is unchanged.
  - **Own generic labels.** `cpq.common.*` replaces borrowed `common.*` keys that only some unrelated modules shipped (`common.inactive` existed nowhere).
  - **Sales tabs translated.** The quote / order tabs on sales documents use i18n keys as `groupLabel`. The customer "Inventory" tab stays English (legacy customer pages render `groupLabel` verbatim).
  - **Row-action messages are noun-free** (`Delete selected items ({count})?`), because a spliced entity noun can't be grammatical in ES / DE / PL. `useCpqRowActions({ entityName })` is now optional and deprecated.
  - **API change for direct importers:** `parsePricingTableXlsx` / `commitImportDiff` take a required `t` argument, and `StatusPath`'s `ariaLabel` is optional.
  - **Guardrails:** tests fail on a missing or orphaned key, a dropped `{placeholder}`, or a new hard-coded UI string.

  No migration. After upgrading run `yarn generate` so the app picks up the dictionaries.

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
