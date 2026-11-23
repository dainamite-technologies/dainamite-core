# Migration plan — `src/modules/cpq/` → `@dainamite/cpq`

This document tracks the concrete steps to extract the in-tree CPQ module into
the `@dainamite/cpq` package, per
[SPEC-001 — Module Distribution Architecture](../../.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md).

## Current state (2026-05-04)

- CPQ source lives at [`src/modules/cpq/`](../../src/modules/cpq/).
- Registered as `{ id: 'cpq', from: '@app' }` in
  [`src/modules.ts`](../../src/modules.ts).
- `packages/cpq/` is a structural placeholder only (this directory).
- `dainamite-core` repo is the L3 customer demo per SPEC-001 Q4.
- **Customer demo data does NOT live in `cpq/`** (since XD-276). GIX and
  Puffin Cloud catalog seeds live in `src/modules/demo_gix/` and
  `src/modules/demo_puffin/`, registered as use cases via
  `cpq/lib/seeds/api.ts` and orchestrated by `src/modules/demo_tenants/`.
  When extracting `@dainamite/cpq`, only the registry API ships; the demo
  modules stay in the customer repo.

## Target state

- CPQ source lives at `packages/cpq/src/modules/cpq/`.
- `dainamite-core` consumes it via `peerDependencies` and registers
  `{ id: 'cpq', from: '@dainamite/cpq' }`.
- Package is published to **GitHub Packages** under `@dainamite/cpq`.
- Other customer apps install it the same way.

## Phased migration

### Phase 0 — Scaffold (this commit)

- [x] Copy CPQ module from `open-mercato-cpq-v0` to `src/modules/cpq/`.
- [x] Copy specs (`specs/`), manuals (`manuals/`), and SPEC-001 to `.ai/specs/`.
- [x] Create `packages/cpq/package.json` placeholder with target `@dainamite/cpq`
      identity, peer deps, exports.
- [x] Document plan (this file).

### Phase 1 — Standalone build (XD-270, 2026-05-08)

- [x] Promote root to a Yarn workspace (`workspaces: ["packages/*"]` in root
      `package.json`).
- [x] Add `packages/cpq/tsconfig.json` (extends root) and
      `packages/cpq/tsconfig.build.json`.
- [x] Add `packages/cpq/build.mjs` (esbuild → `dist/`, mirrors
      `@open-mercato/core/build.mjs` — only `.js` emit, no `.d.ts`).
      Per Open Mercato convention, the package ships `src/` for types
      and `dist/` for runtime — exports map `types → ./src/*.ts`,
      `default → ./dist/*.js`.
- [x] Move `src/modules/cpq/` → `packages/cpq/src/modules/cpq/` (single
      `git mv` — history preserved, all 136 source files renamed).
- [x] Update `src/modules.ts` entry to `{ id: 'cpq', from: '@dainamite/cpq' }`.
- [x] Patch `@open-mercato/cli@0.5.0` to allow the `@dainamite/` prefix in
      `GENERATED_MODULE_SPECIFIER_PREFIXES` (the CLI rejects unknown package
      scopes when emitting `.mercato/generated/`). Patch lives at
      `.yarn/patches/@open-mercato-cli-npm-0.5.0-*.patch`. **Will be
      fixed upstream in the next framework release** — patch can be
      removed at that point.
      **Update (0.6.7, 2026-08-25): done.** Upstream now sanitizes any
      npm scope generically, so the patch was deleted along with the
      whole `.yarn/patches/` directory.
- [x] Rewrite cross-module imports in `demo_gix`, `demo_puffin`,
      `demo_tenants`: `'../../cpq/...'` → `'@dainamite/cpq/modules/cpq/...'`
      (26 files). Demo modules now consume CPQ via the public package
      surface — no in-repo coupling left.
- [x] Extend root `jest.config.cjs` `testMatch` to discover tests under
      `packages/*/src/**/__tests__/`. Without this, the 27 CPQ test files
      moved with `git mv` were silently skipped.
- [x] `yarn install && yarn workspace @dainamite/cpq build && yarn generate && yarn typecheck && yarn test` — all green (26 suites, 531 tests).
- [ ] Smoke-test backend: `yarn dev`, list/create offering, run a quote
      wizard, check ARC subscription detail page. **(manual, blocks merge)**

### Phase 2 — Audit & lint cross-package coupling (XD-270, 2026-05-09)

- [x] Grep for `@ManyToOne`, `@OneToMany`, `@ManyToMany`, `@OneToOne` —
      zero violations (CPQ already uses FK string columns).
- [x] Grep for cross-module imports (`@/modules/<x>`, `src/modules/<x>`,
      relative escapes) — zero violations.
- [x] Audit deep imports into `@open-mercato/core/modules/<x>` — found
      `auth` and `directory` usages not declared in `metadata.requires`.
      Fix: extended [`packages/cpq/src/modules/cpq/index.ts`](src/modules/cpq/index.ts)
      `requires` to `['auth', 'directory', 'catalog', 'sales', 'customers', 'dictionaries']`.
- [x] Audit external deps used by package — found `bcryptjs` imported in
      `lib/seeds/tenant-provisioning.ts` but missing from `peerDependencies`.
      Fix: added `bcryptjs ^3.0.0` to `peerDependencies`. Also added
      `lucide-react ^0.400.0` (used by sidebar icons in `backend/**/page.meta.ts`).
- [x] Add guard test:
      [`packages/cpq/src/modules/cpq/__tests__/package-isolation.test.ts`](src/modules/cpq/__tests__/package-isolation.test.ts) —
      static analysis of every `.ts`/`.tsx` in the package, asserting:
      no forbidden cross-module imports; only allowed import prefixes
      (mirroring `peerDependencies`); deep core imports declared in
      `requires`; zero ORM relations; module index loads cleanly. Future
      regressions caught by CI.
- [x] Removed `@open-mercato/core` patch (nav sidebar order tweak) — was
      cosmetic; not worth the upstream-PR cost.

### Phase 3 — Publish (XD-270, 2026-05-09)

- [x] Flip `private: true` → `false` in `packages/cpq/package.json`.
- [x] Install + init `@changesets/cli` — config in `.changeset/config.json`
      with `access: restricted` → later switched to `public`,
      `baseBranch: main`, `dainamite-core` automatically skipped (private workspace).
- [x] First changeset: `.changeset/initial-release.md` for
      `@dainamite/cpq` initial release.
- [x] CI release workflow at `.github/workflows/release.yml` —
      on push to `main`, runs `changesets/action@v1` which either opens a
      "Version Packages" PR (when changesets exist) or runs
      `yarn changeset publish` (when version PR is merged).
- [x] **Switched publish target from GitHub Packages → public npm.js.**
      First publish attempts as `@dainamite/cpq` on GitHub Packages failed
      with `403 Forbidden — installation does not exist`: scope `@dainamite`
      on GitHub belongs to a different (unrelated) "DAInamite" organization
      based in Berlin (dainamite.de). Switching to public npm.js, where the
      `@dainamite` scope is free, lets us keep the brand without renaming
      everything to `@dainamite-technologies/cpq`. Open Mercato itself
      publishes to npm.js (`@open-mercato/core` etc.) so this is also more
      consistent with the upstream ecosystem.
- [ ] **Manual / first-time setup before merge to main:**
      - **npm.js account + org** — sign up at https://www.npmjs.com/signup
        if needed, then create the `dainamite` org at
        https://www.npmjs.com/org/create (Free plan — public packages only,
        which is fine since CPQ is public).
      - **`NPM_TOKEN` secret** — at https://www.npmjs.com/settings/<your-username>/tokens
        click "Generate New Token" → type `Automation` → Add as repo secret
        named `NPM_TOKEN`.
      - **`RELEASE_TOKEN` PAT** — required for "Version Packages" PRs to
        trigger CI automatically. Without it, you must push an empty
        commit to `changeset-release/main` each release to trigger CI
        (the default `GITHUB_TOKEN` cannot trigger workflows on PRs it
        opens, anti-recursion safety). Setup:
        1. Settings → Developer settings → Personal access tokens →
           Tokens (classic) → Generate new (classic)
        2. Scope: `repo` (full)
        3. Expiration: 90+ days, set a calendar reminder to rotate
        4. Repo settings → Secrets and variables → Actions → New
           repository secret → name `RELEASE_TOKEN`, value the PAT
      - **License decision** — `packages/cpq/package.json` still has
        `"license": "UNLICENSED"` from when the package was private.
        For a public npm package pick a real OSI license (MIT recommended
        for ecosystem consistency with `@open-mercato/*`) and update
        before merging.
- [ ] **First publish flow** (after this branch lands on main):
      1. Push to main triggers release workflow.
      2. Workflow sees pending changesets and opens a
         "Version Packages" PR that bumps `@dainamite/cpq` and writes
         `packages/cpq/CHANGELOG.md`.
      3. Merge that PR → release workflow re-runs, this time runs
         `yarn changeset publish` → `@dainamite/cpq` lands on
         https://www.npmjs.com/package/@dainamite/cpq.
- [ ] Update SPEC-001 changelog.

> **Note:** SPEC-001 references a future `dainamite-product/` repo as a
> Phase 4 destination. **That plan is dropped** — `dainamite-core` IS the
> Dainamite product monorepo, and `packages/cpq/` (plus any future
> `@dainamite/*` packages) stay here permanently. Other customer apps
> install from npm.js with no auth setup needed (public package).

## Risks (carried from SPEC-001)

| Risk | Mitigation |
|---|---|
| Cross-package ORM relations leak in | Lint rule + isolation bootstrap test |
| Two CPQ instances in `node_modules` | `peerDependencies` only, narrow ranges |
| Breaking schema migration on customer DB | Migrations ship in package, document upgrade in CHANGELOG |
| Custom @app code drifts from package | Audit every 6 months, promote duplicated features into the package |

## Schema / API changelog (track breaking changes here)

### 2026-11-23 - Devices (assets) on ARC quotes, device and price billing (#126)

**Migration.** None. Device lines use the `_arcMirroredFromAssetId` marker in
the line configuration, like the other `_arcMirrored*` markers.

**API (additive).** ARC quotes mirror the target subscription's live assets
as unpriced lines under their item's line (not on merge renew). `ArcLineChange`
gains `sourceAssetId`. Change log `lineChanges` gain `add_asset` and
`retire_asset` entries, and `modify` entries now carry the new `mrcAmount`.
`cpq.subscription.activated` items include device lines (keyed by asset id);
`cpq.subscription.amended` / `renewed` gain `changedItems` (re-rated recurring
prices), and `amended` lists returned devices in `removedSubscriptionItemIds`.

**Behaviour changes.** A device line cannot be edited (409); remove and add to
swap it. At activation a removed device, the devices of a cancelled item and
those of a terminated subscription become `returned` (`cancelled` when never
delivered) instead of always `cancelled`. Re-activating a subscription no
longer revives cancelled assets. An assetizable offering added on an ARC quote
creates only an asset (it also created a subscription item). The quote's slot
counter ignores lines marked for removal.

### 2026-11-23 - Catalog AI tools and catalog assistant (#128)

**Migration.** None.

**API (additive).** New AI tools `cpq.create_offering`
(`POST /product-offerings`), `cpq.add_bundle_component` and
`cpq.remove_bundle_component` (`POST` / `DELETE /offering-components`), all
mutations flagged destructive and gated by the approval card. New agent
`cpq.catalog_assistant` (requires `cpq.offerings.manage`) is the only one that
allowlists them; `cpq.quoting_assistant` is unchanged. Run `yarn generate` to
register them. `cpq.create_offering` sends `isSellable` (#133).

### 2026-11-23 - Component-only offerings: `isSellable` (#133)

**Migration.** `Migration20261123100000_cpq_offering_is_sellable` adds
`cpq_product_offerings.is_sellable` and
`cpq_product_specifications.default_offering_sellable`, both
`boolean not null default true`, so existing data behaves as before. Rollback
drops both columns. Written by hand in the generator's style
(`yarn mercato db generate` only diffs `@app` modules here); the module
snapshot was updated to match.

**API (additive).** Offerings: `isSellable` on create, update and every
response (also on bundle `components[].childOffering`); `GET` list takes
`isSellable=true|false`. On create, an omitted `isSellable` takes the spec's
`defaultOfferingSellable`. Specifications: `defaultOfferingSellable` on create,
update and responses (pre-fill only, never enforced). `BundleTreeNode` gains
`lifecycleStatus` and `isSellable`. AI tool `cpq.list_offerings` takes
`isSellable`.

**Behaviour changes.** `POST /quotes/{id}/items` returns 422 with
`code: 'V-QLINE-1'` for a top-level line (no `parentLineId`, action `add`)
whose offering has `isSellable: false`. `POST /orders` re-checks it and returns
422 `V-QLINE-1` with `errors`. Only server-set facts exempt a line: a
`sourceSubscriptionItemId` or an `_arcMirrored*` marker; a caller's `action`
does not. `POST /quotes/{id}/items` with a `parentLineId` that is not a line of
the quote now returns 404 on every quote type (it was checked on ARC quotes
only), and conversion treats such an orphan as a top-level line. Bundle default expansion now also
requires the child offering's `lifecycleStatus` to be `active` (before: only
`isActive`). The quote "Add Offering" picker, the wizard offering step and the
Puffin public calculator hide component-only offerings; the bundle component
picker still lists them.

### 2026-11-17 - Bundle setup, default components, slot validation (#122-#125)

**Migration.** `Migration20261117120000_cpq_offering_components_partial_unique`
replaces the `cpq_off_comp_unique` constraint with a partial unique index
(`WHERE deleted_at IS NULL`), so a removed bundle component can be added back.
Rollback **permanently deletes** older soft-deleted copies (keeping the live
row, else the newest) before restoring the full constraint.
Written by hand in the generator's style (no database was available to run
`yarn mercato db generate`); the module snapshot was updated to match.

**API (additive).** `POST /product-offerings`: `offeringType` optional, defaults
to the spec's `specType`. `POST /quotes/{id}/items`: `expandBundleDefaults`.
`ValidationError.type` gains `'charge'` (V-LINE-1) and `'bundle_slot'`
(V-QBUN-1..3, with `slotGroup` / `slotName`). `BundleTreeNode` gains `isActive`.
`offering-components` / `bundle-slots` POST: 404 / 409 instead of 500.

**Behaviour changes.** `POST /orders` returns 422 `BUNDLE_INCOMPLETE` while a
quote has stored bundle-slot errors. Like the adjustment check, conversion
reads the quote's stored (reviewed) validation and does not re-price: a quote
last recalculated before this release is not retro-blocked until its next
write. Slot rules do not run on Cancel quotes, never flag children mirrored
from the subscription, and skip a mirrored bundle whose children the quote
leaves untouched; cardinality counts lines, not quantity. Default component
lines inherit the bundle line's term and dates, and per attribute the bundle
line's value for the same code or the attribute's `defaultValue`. A valid line
whose offering defines no charges is configured; one whose charges exist but
none applies is incomplete with V-LINE-1. Lines without an offering keep the
previous rule (no charges = incomplete). Lines are now decided by one rule in `lib/lineCompleteness.ts`,
run by `recalculateInternal`; `DefaultCpqQuotingService` takes an optional
`cpqBundleService` dependency.

### 2026-11-16 - Date column props are strings; 400 without organization

**Entity typings (consumers reading these props).** Every `type: 'date'`
property is now typed `string | null` (`YYYY-MM-DD`), matching what MikroORM 7
already returned at runtime: `CpqQuoteLineConfiguration.startDate` / `endDate`,
`CpqOrderLineConfiguration.startDate` / `endDate`,
`CpqInventorySubscription.startDate` / `currentTermStart` / `currentTermEnd`,
`CpqInventoryAsset.purchaseDate` / `deliveryDate`,
`CpqQuoteTargetSubscription.newTermStart` / `newTermEnd`,
`CpqQuoteConfiguration.arcMergeNewTermStart` / `arcMergeNewTermEnd`. Code that
called `Date` methods on them was already failing at runtime; wrap reads in
`new Date(value)` and write `YYYY-MM-DD` strings. No migration.

**Routes without an organization** answer `400`
(`cpq.errors.organizationRequired`) instead of `500`. Use `cpqContextError(ctx)`
from `api/context.ts` after `resolveCpqRouteContext` in custom CPQ routes.

### 2026-11-16 - Cross-module writes through sales / catalog commands

No route contract change. Data retention changes for installers:

- `DELETE /api/cpq/quotes/{quoteId}` removes the sales quote with
  `sales.quotes.delete`. In Open Mercato 0.9 that command deletes the quote
  graph (lines, adjustments, addresses, notes, tags) instead of setting
  `deleted_at`. Reports or joins that relied on soft-deleted `sales_quotes`
  rows no longer find them. CPQ rows (`CpqQuoteConfiguration`,
  `CpqQuoteLineConfiguration`) are still soft-deleted.
- Undoing that delete from the audit log restores the sales quote, and the
  CPQ interceptor `cpq.restore-quote-configuration-after-sales-undo`
  (`commands/interceptors.ts`, `afterUndo` on `sales.quotes.delete`) restores
  the CPQ configuration and the lines deleted with it. Lines removed earlier
  on their own stay deleted. Its `afterExecute` soft-deletes the live CPQ
  configuration whenever `sales.quotes.delete` runs elsewhere (redo from the
  audit log, a delete in the sales module), and its `beforeExecute` refuses
  (409) to delete a sales quote whose CPQ quote is accepted, rejected or
  cancelled, the same rule as the CPQ route. Run `yarn generate` after
  upgrading so the interceptor is registered.
- `POST /api/cpq/product-specifications` creates the catalog product with
  `catalog.products.create`, so catalog validation limits apply (title 255,
  description 4000, handle 150 characters) and return 400.
- Errors from those commands (403, 404, 409) keep their status instead of 500.

### 2026-11-16 - AI tools and agent; `@open-mercato/ai-assistant` peer; update schemas

**New required peer (breaking for consumers).** `@open-mercato/ai-assistant`
`^0.9.0`. The package now ships `ai-tools.ts` and `ai-agents.ts`; the
framework generator imports every enabled module's `ai-tools.ts` statically,
and the CPQ tools build on `defineApiBackedAiTool` at load time. An app that
enables `@dainamite/cpq` must also install and enable the AI assistant
(`{ id: 'ai_assistant', from: '@open-mercato/ai-assistant' }` in
`src/modules.ts`). Ships in the same major as the 1.0.0 release. After
upgrading, run `yarn generate`.

**AI surface.** 20 read tools and 4 write tools (`cpq.create_quote`,
`cpq.add_quote_line`, `cpq.update_quote_line`,
`cpq.submit_quote_for_approval`) over the existing routes, plus the
`cpq.quoting_assistant` agent (`mutationPolicy: 'confirm-required'`). Writes
run only after the operator confirms the preview card; over MCP they are
refused. See `manuals/cpq-ai-agent.md`.

**OpenAPI.** Every route exports a typed `OpenApiRouteDoc`. Seven routes
moved from the path-keyed object form (which the generator ignored) to
`methods`, so the generated spec now carries their params and bodies.

### 2026-11-10 — Manual price adjustments and price waterfall (price adjustments, Phase 1)

Spec: `.ai/specs/2026-11-10-cpq-manual-price-adjustments.md`. Manual:
`manuals/cpq-price-adjustments.md`.

**Schema (additive).** Migration `Migration20261110213052` adds
`cpq_quote_price_adjustments` (tenant-scoped, soft-deleted, FK-string ids only)
and `cpq_quote_configurations.pricing_revision int default 0`. Rollback drops
both. No data migration: existing quotes keep their stored charges; list /
standard prices are derived for responses until the next saved recalculation.

**Upgrade steps for existing tenants (required).** The toggle, the reason
dictionary and the role grant are created by `setup.ts` at tenant
initialization only. After `yarn mercato db migrate`, run
`yarn mercato cpq seed-price-adjustments` (idempotent; `--tenant` / `--org`
to target one) and `yarn mercato auth sync-role-acls`. Skipping them leaves the
feature fail-closed: writes `403`, actions hidden, and every reason
`REASON_NOT_FOUND` if the toggle is switched on by hand.

**Write serialization.** Every pricing write (line add / update / remove, ARC
target detach, saved recalculation, clone, status change, adjustment CRUD,
order conversion) runs in
a transaction that locks the quote row (`SELECT … FOR UPDATE`) and bumps
`pricing_revision`. Adjustment writes accept `expectedRevision` and return
`409 STALE_REVISION` on mismatch.

**Response shapes (additive).** See the changeset. `discountTotal` keeps its
old meaning (rule discounts only) for existing consumers; use
`ruleDiscountTotal` / `manualDiscountTotal` for the split.

**Events.** `cpq.quote.pricing_changed` fires after a committed save whose
`snapshotHash` changed; `cpq.quote.status_changed` after every committed status
change (`cause: manual | auto`). Quotes saved before this release have no
stored hash: their first save records a baseline silently. New and ARC quotes
start with an empty-quote hash, so their first priced line is a signal.
`transitionStatus(quoteId, status, scope, actorUserId?)` gained an optional
actor argument.

**Conversion.** A quote whose stored waterfall contains an invalid manual
adjustment can no longer be converted (`422 ADJUSTMENT_INVALID` with
`lineId` / `code`).

### 2026-11-10 — Quote pricing integrity (price adjustments, Phase 1)

Spec: `.ai/specs/2026-11-10-cpq-quote-pricing-integrity.md`. No schema change.

**Recalculate needs `cpq.quotes.manage` (breaking for view-only callers).**
`POST /api/cpq/quotes/{quoteId}/recalculate` required only `cpq.quotes.view`,
so a read-only user or API key could persist re-priced quotes. It now requires
`cpq.quotes.manage`. A saved recalculation (`save: true`) on an `accepted`,
`rejected` or `cancelled` quote returns `409` — an accepted quote's prices are
the basis for order conversion. Dry runs (`save: false`) on terminal quotes
still work for managers.

**Amend mirror lines are frozen (behaviour change).** Engine-priced mirror
lines on Amend quotes were re-priced at today's catalog price on every
recalculation, and activation wrote that price back to the subscription item.
They now carry `_arcPriceFrozen: true` in the line `configuration` and keep the
source item's stored charges until a pricing input of the line changes
(configuration — ARC markers and key order ignored — quantity, `termMonths`,
`startDate`, `endDate`, `usageEstimates`); then the marker is dropped and the
line is re-priced as before. Renew and Cancel quotes are unchanged. Amend
quotes created before this release keep the old behaviour. The marker never
reaches subscription items (stripped at activation) and mirror lines ignore any
stale `_arc*` keys on an item's configuration.

**Mutation guards on quote writes.** The status, items, recalculate and
order-conversion routes now call `runRouteMutationGuards`
(`@open-mercato/shared/lib/crud/route-mutation-guard`) with resource kinds
`cpq.quote` (actions `transition_status`, `recalculate`, `convert_to_order`)
and `cpq.quote_line` (create / update / delete). A guard can block the write or
modify the line payload; after-success hooks run once the write commits.
These routes now export `openApi`.

### 2026-11-03 — Open Mercato 0.9.0 peers; `isQuotingError` / `isOrderError`

**Peer ranges (breaking for consumers).** `@open-mercato/*` `^0.9.0`,
MikroORM `^7.1.14`, `@tanstack/react-table` `^9.0.0` (list pages import
`LegacyColumnDef` from `@tanstack/react-table/legacy`, absent in v8). See
`.changeset/open-mercato-090-peers.md`.

**Do not use `instanceof QuotingError` / `instanceof OrderError` across the
DI boundary.** Next bundles this package once per server layer (page SSR vs
route handler) while the DI container is shared through `globalThis`, so a
route can catch an error built from the other copy of the class and
`instanceof` is `false` — a typed 404/409 becomes a 500. This was already
true before this release; it was just undetected. Both classes now carry a
`Symbol.for` brand, and two guards are exported next to them:

```ts
import { isQuotingError } from '@dainamite/cpq/modules/cpq/services/cpqQuotingService'
import { isOrderError } from '@dainamite/cpq/modules/cpq/services/cpqOrderService'

} catch (err) {
  if (isQuotingError(err)) return NextResponse.json({ error: err.message }, { status: err.status })
```

Consumer code that copied CPQ's old route catch blocks should switch to the
guards. `instanceof` remains fine inside the service layer itself, where the
thrower and the catcher are the same module copy.

### 2026-06-02 — XD-297 Charge model / pricing method split

Splits the conflated `cpq_product_charges.pricing_method` into two orthogonal
axes. **Additive + backfilled; back-compat preserved at runtime.**

**New column** (additive, migration `Migration20260602000000_cpq_charge_model_split`):
- `cpq_product_charges.charge_model` (nullable text) — `flat | per_unit | volume | tiered`.

**Repurposed column** (values migrated):
- `cpq_product_charges.pricing_method` now holds the **pricing source**
  `fixed | table`. The migration backfills existing rows:
  `flat → (flat, fixed)`, `per_unit → (per_unit, table)`,
  `tiered → (tiered, table)`.

**API shape** (`/api/cpq/product-charges`, offering GET): charges now carry a
`chargeModel` field alongside `pricingMethod`. POST/PUT accept **either** the
new split (`chargeModel` + `pricingMethod ∈ {fixed, table}`) **or** a legacy
combined `pricingMethod` (`flat | per_unit | tiered`) and persist the canonical
split shape.

**New capabilities**: `volume` charge model (whole quantity billed at the rate
of the tier containing the total) and `per_unit + fixed` (quantity × a fixed
unit price). Valid combinations: `fixed` → `flat | per_unit`; `table` → all four.

**Backwards compatibility**: `normalizeChargePricing()` (exported from
`data/charge-pricing`) resolves the `{model, source}` from either shape, so rows that
predate the migration — and any client still sending the legacy `pricingMethod`
— price and render correctly without a migration. `ResolvedCharge.pricingMethod`
now carries the charge **model** (adds `'volume'`) for display.

### 2026-05-04 — XD-250 ARC (Amend / Renew / Cancel)

Additive only. Every existing CPQ contract is preserved.

**New entities** (require migration):
- `cpq_quote_target_subscriptions` — junction quote ↔ subscription target
- `cpq_subscription_change_logs` — append-only audit per ARC operation

**New columns on existing entities** (additive, default-safe):
- `cpq_quote_configurations`: `quote_type` (default `'new'`), `arc_reason_*`,
  `arc_etf_*`, `arc_merge_new_term_*`, `arc_merge_new_sub_*`
- `cpq_quote_line_configurations`: `target_subscription_id`,
  `source_subscription_item_id`
- `cpq_inventory_subscriptions`: `current_term_start`,
  `merged_into_subscription_id`, `last_change_log_id`,
  `version` (MikroORM optimistic lock)

**Status enum extensions**:
- `INVENTORY_SUBSCRIPTION_STATUSES` adds `'superseded'` (terminal,
  reachable only via merge-renewal — sources transition there).
- Subscription items mirror parent via the same `'superseded'` status.

**New events** in `cpq.events.ts` (NEW file — first events for the module):
- `cpq.subscription.amended`
- `cpq.subscription.renewed`
- `cpq.subscription.merged`
- `cpq.subscription.cancelled`
- `cpq.subscription.superseded`

All five include a `proration` payload + ChangeLog id, persistent +
`clientBroadcast: true`.

**New API endpoints** (all under `src/modules/cpq/api/`):
- `POST /api/cpq/quotes/from-subscription`
- `GET / POST /api/cpq/quotes/[quoteId]/target-subscriptions`
- `PATCH / DELETE /api/cpq/quotes/[quoteId]/target-subscriptions/[targetId]`
- `POST /api/cpq/quotes/[quoteId]/cancel-meta`
- `POST /api/cpq/quotes/[quoteId]/merge-meta`
- `PATCH /api/cpq/quotes/[quoteId]` — extended to accept `quoteType`
  (one-way `new → amend|renew|cancel`)
- `GET /api/cpq/inventory/subscriptions/[subscriptionId]/change-log`
- `GET /api/cpq/inventory/subscriptions/expiring`

**New ACL features** (in `acl.ts`, granted to admin + employee in `setup.ts`):
- `cpq.arc.amend.manage`
- `cpq.arc.renew.manage`
- `cpq.arc.cancel.manage`
- `cpq.arc.changelog.view`
- `cpq.inventory.expiring.view` (retired since: the expiring filter and
  `GET /api/cpq/inventory/subscriptions/expiring` use `cpq.inventory.view`)

**Service surface additions** (no new top-level services — methods on existing):
- `cpqInventoryService.applyAmendment / applyRenewal / applyMergeRenewal /
  applyCancel` — idempotent on `(sourceOrderId, subscriptionId)`.
- `cpqInventoryService.findExpiringSubscriptions / listChangeLog`.
- `cpqQuotingService.createQuoteFromSubscription / setQuoteType /
  attachTargetSubscription / detachTargetSubscription /
  updateTargetSubscription / setCancelMeta / setMergeMeta /
  validateArcQuote`.
- `cpqOrderService.activateOrder` — extended to branch on `quoteType` and
  invoke the right `apply*` per attached target. Events emit AFTER commit.

**Backwards compatibility**: existing `quote_type='new'` quotes flow through
the unchanged path. `autoRenew` column on subscriptions is preserved but no
longer consulted (no scheduler).

## Open decisions (per SPEC-001 §Open Questions)

- Q3 — Monorepo tooling: yarn workspaces alone vs Nx/Turborepo. Default to
  workspaces; revisit at >15 packages.
- Q5 — Licensing model (per-package vs per-tenant). **Deferred.**
- Q6 — Customer repo commit access (us only vs customer too). **Deferred.**
