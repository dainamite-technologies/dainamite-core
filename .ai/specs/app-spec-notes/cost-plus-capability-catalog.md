# Capability catalog addendum — CPQ Cost-Plus Pricing

Built 2026-11-11 for `.ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md`. It extends
[`capability-catalog.md`](capability-catalog.md); that file's rows still apply. Its CPQ paths now
live under `packages/cpq/src/modules/cpq/` (`P/`).

**Strength:**
- CPQ rows are grounded in repo source.
- Framework rows were read from `@open-mercato/core` 0.9.0 in another local install (`CORE/`),
  because this worktree has no `node_modules`. They are **docs/code-elsewhere**, not verified
  against this app's install.
- No `.ai/agentic.config.json` exists, so there is no `platform.repo` and no upstream check.

| Kind | Name | What it gives the app | Source file | Tier |
|---|---|---|---|---|
| capability / module | Price waterfall (list → rules → standard → manual → offer) | Records the stages a cost-plus list price plugs into | `P/services/cpqPricingService.ts:122-141`, `P/services/types.ts:199-249` | |
| capability / module | Manual price adjustments (`CpqQuotePriceAdjustment`) | Quote-level price inputs, invalid-adjustment handling, carry-over pattern | `P/data/entities.ts:1485-1560`, `P/services/priceAdjustments/*` | |
| capability / module | `withQuotePricingWrite` | Aggregate lock, `pricingRevision`, `409 STALE_REVISION`, post-commit events | `P/services/priceAdjustments/quotePricingWrite.ts:10-50` | |
| capability / module | Pricing tables (`CpqPricingTable` / `CpqPricingTableEntry`) | Dimension + tier lookup, reusable as cost tables via a cost column | `P/data/entities.ts:385-477`, `cpqPricingService.ts:300-467` | |
| capability / module | Charge applicability conditions | eq/neq conditions on line configuration, reusable for cost elements | `cpqPricingService.ts:29-41, 104` | |
| capability / module | ARC frozen mirror lines | `_arcPriceFrozen` / `_arcRepriced`, the basis for the cost price lock | `P/services/arcPriceFreeze.ts:63-165` | |
| capability / module | ARC activation write-back | Patches item charges on `modify` changes; extendable to item costs | `cpqInventoryService.ts:1749-1773`, `cpqOrderService.ts:1068-1110` | |
| capability / module | Conversion / activation copy | Line → order line → subscription item copy points | `cpqOrderService.ts:306-310, 637-639` | |
| capability / module | Feature toggles (`featureTogglesService`) | Package-level boolean switch, per-tenant overrides | `CORE/feature_toggles/data/entities.ts:8,48`, `P/lib/priceAdjustmentDefaults.ts`, `P/di.ts:27` | |
| capability / module | Module configs (`ModuleConfigService`) | Tenant / org scoped JSON settings | `CORE/configs/lib/module-config-service.ts:106-118` | |
| capability / module | Currencies (dated exchange rates) | FX rate snapshot for foreign-currency supplier costs | `.ai/guides/core.currencies.md` | |
| capability / module | Customers companies | Supplier reference (FK string) | `.ai/guides/core.customers.md` | |
| workflow / notification primitive | Workflows: event triggers, `USER_TASK` (formSchema, assignedToRoles, dueDate), `WAIT_FOR_SIGNAL`, `CALL_API`, `CALL_WEBHOOK` | The cost-sourcing process without CPQ code | `CORE/workflows/data/validators.ts:79-92`, `CORE/workflows/data/entities.ts:707+, 919+`, `.ai/guides/core.workflows.md` | |
| extension point | `createModuleEvents` with `clientBroadcast` flag | Non-broadcast events for confidential cost / margin payloads | `P/events.ts` | |
| identity & access primitive | RBAC features | New `cpq.costs.view` / `cpq.costs.manage` | `P/acl.ts`, `P/setup.ts` | |
| UI building block | Quote detail page `ChargeBreakdown`, adjustments panel | Host for the cost lines panel and margin card | `P/backend/cpq/quotes/[id]/page.tsx` | |
| reference-app rule | Public calculator strips cost / margin / vendor metadata | Cost data is already treated as confidential | `src/modules/demo_puffin/lib/public-calculator/catalog-filter.ts:8-38` | |
| (rejected) capability | Catalog `CatalogPriceKind` / `CatalogProductPrice` as cost store | Not read by CPQ pricing, no on-request / index semantics | `CORE/catalog/data/entities.ts:727+, 779+` | |
