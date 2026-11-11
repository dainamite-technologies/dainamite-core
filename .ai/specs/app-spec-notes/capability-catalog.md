# Capability catalog — CPQ Quote Price Adjustments

Built 2026-11-10 for `.ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md`.

**Catalog strength: thin / docs-only.** `node_modules/@open-mercato/*` is not installed in this
worktree, so the framework's own `AGENTS.md` files could not be read. Framework entries below
come from the repo-local copies in `.ai/guides/*.md`. CPQ / billing entries come from source
code in `packages/*` and are therefore grounded in this repository. No `.ai/agentic.config.json`
→ no `knowledge.sources`, no `platform.repo`, no upstream check. No license tiers declared.

| Kind | Name | What it gives the app | Source file | Tier |
|---|---|---|---|---|
| capability / module | CPQ pricing engine — `resolveProductCharges` | Resolves charges (NRC/MRC/usage) per offering from fixed price or pricing table (flat / per_unit / volume / tiered), then applies price rules in `sortOrder`, recording `adjustments[]` per charge | `packages/cpq/src/modules/cpq/services/cpqPricingService.ts:75-238` | |
| capability / module | CPQ price rules (`CpqPriceRule`) | Catalog-level, engine-granted adjustments: `discount_percent`, `discount_absolute` (on total), `surcharge_percent`, `surcharge_absolute` (on total), `price_override` (on unit); global or offering-scoped; charge-code / charge-type filter; single `eq`/`neq` applicability condition | `packages/cpq/src/modules/cpq/data/entities.ts:567-624`, `manuals/xd-188-price-rules.md` | |
| capability / module | CPQ quote line configuration (`CpqQuoteLineConfiguration`) | Per-line `charges` jsonb (output of the engine, overwritten on each recalculation), `nrcTotal`, `mrcTotal`, `startDate`, `termMonths`, `endDate`, `quantity` | `entities.ts:780-874`, `cpqQuotingService.ts:752-927` | |
| capability / module | CPQ quote configuration (`CpqQuoteConfiguration`) | Quote-level `pricingSummary` jsonb (`nrcTotal`, `mrcTotal`, `discountTotal`, `surchargeTotal`), `cpqStatus`, `quoteType` (new / amend / renew / cancel), `quoteContext` | `entities.ts:628-718`, `services/types.ts:140-178` | |
| capability / module | CPQ quote status machine | 10 statuses incl. `in_approval`, `pre_approved`, `approved`, `with_customer`; operator-driven any→any; auto-managed `new/incomplete/ready` on recalc | `services/types.ts:40-65`, `cpqQuotingService.ts:703-748, 890-902` | |
| capability / module | CPQ quote → order → inventory | Order line copies quote line `charges`; subscription item stores `charges` + `mrcAmount` / `nrcAmount` (line totals) | `cpqOrderService.ts:314, 645-646, 1086-1114` | |
| capability / module | CPQ ARC (amend / renew / cancel) | ARC quotes mirror subscription items as lines (action `modify`, or `cancel` on cancel quotes). Mirror lines that carry `offeringId` / `productId` are **re-priced by the engine**; free-form items keep copied charges. Amend / renew events carry only `add` / `cancel` changes — `modify` updates CPQ inventory only | `cpqQuotingService.ts:812-831, 2480-2540`, `cpqOrderService.ts:1220-1302`, `.ai/skills/cpq/arc/SKILL.md` | |
| capability / module | `ArcLineDiff` before / after | Shows Before = `arcSource.mrcAmount` (subscription item offer) vs After on ARC lines | `backend/cpq/quotes/[id]/page.tsx:1313-1329` | |
| capability / module | Billing negative `one_time` discount pattern | Spec-sanctioned way to model a discount as a negative one-time item | `xd-249-billing-spec.md:194-196`, `billing/data/validators.ts:91-95` | |
| capability / module | Billing cycle + anchor | Accounts bill monthly / quarterly / annually / weekly on an anchor day; recurring items count only for full cycles | `billing/data/entities.ts:65-72`, `billing/lib/itemSelector.ts:104-118` | |
| capability / module | Connector cancel / amend end-dating | Cancel end-dates every item; amend removal end-dates removed items (both would move an earlier end date later) | `cpq-subscription-cancelled.ts:54-63`, `cpq-subscription-amended.ts:156-167` | |
| seed / init command | Per-tenant dictionary seeding (`ensureDictionary`, `ensureDictionaryEntries`) | Proven pattern for seeding tenant dictionaries | `packages/billing/src/modules/billing/setup.ts:74-107` | |
| capability / module | Sales module quote / line header | Sales quote + lines own header totals; CPQ writes `unitPriceNet`, `totalNetAmount`; `discountAmount` / `discountPercent` always `'0'` today | `cpqQuotingService.ts:244-275, 863-875`; `.ai/guides/core.sales.md` | |
| capability / module | Sales adjustments (`AdjustmentKind`) | Native sales discounts/surcharges on quotes/orders; must use a registered adjustment kind | `.ai/guides/core.sales.md:45` (docs-only) | |
| capability / module | Billing items (`@dainamite/billing`) | One billing item per charge with `rate_json`, `bill_start_date`, **`bill_end_date` (nullable)**, unique `source_ref`; rates must be non-negative | `packages/billing/src/modules/billing/data/entities.ts:154-220`, `specs/implementation/xd-249-billing-spec.md:~195` | |
| capability / module | CPQ → billing connector | Maps `cpq.subscription.activated/amended/...` payload charges (`recurring` / `one_time`) to billing items; `sourceRef = cpq-<sub>-<item>-<type>`; start date only | `packages/cpq-billing-connector/src/modules/cpq_billing_connector/lib/chargeMapper.ts` | |
| extension point | Domain events (`createModuleEvents`) | Typed module events; persistent subscribers; workflow triggers listen to non-internal events | `.ai/guides/core.md:100-124`, `.ai/guides/events.md`, `packages/cpq/src/modules/cpq/events.ts` | |
| extension point | Response enrichers | Add fields to another module's API response (e.g. sales quote line) without coupling | `.ai/guides/core.md:154-174` | |
| extension point | API interceptors | Before/after hooks on routes | `.ai/guides/core.md:175-189` | |
| extension point | Mutation guards | `validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess` on custom writes — lets a project block a write (e.g. status change) | `.ai/guides/core.md:75-80` | |
| extension point | Widget injection | Inject UI into other modules' pages / CPQ slots | `.ai/guides/core.md:125-153` | |
| extension point | Command pattern | Writes as commands with `execute` + `undo` | `.ai/guides/core.md:242-252` | |
| identity & access primitive | RBAC features (`acl.ts` + `setup.ts defaultRoleFeatures`) | Immutable feature IDs; API routes guard with `requireFeatures`; wildcard-aware `hasFeature` | `.ai/guides/core.md:190-202`, `AGENTS.md` (Architecture Rules), `packages/cpq/src/modules/cpq/acl.ts` | |
| surface (internal) | Backend admin (`/backend/cpq/...`) | CPQ quote detail page with line tree, charge breakdown, rule-adjustment drill-down | `packages/cpq/src/modules/cpq/backend/cpq/quotes/[id]/page.tsx:1407-1540` | |
| surface (external) | Customer portal (`portal`, `customer_accounts`) | Portal pages for customer users | `.ai/guides/core.md:253-480` | |
| UI building block | `CrudForm`, `DataTable`, `FormHeader`, dialogs (Cmd+Enter / Esc) | Standard backend forms / tables | `.ai/guides/ui.md`, `AGENTS.md` | |
| workflow / notification primitive | Workflows — event triggers, `USER_TASK` (human approval), signals, `EMIT_EVENT` | Project-level approval routing from CPQ domain events | `.ai/guides/core.workflows.md:35-101` | |
| workflow / notification primitive | Notifications | Notification types per module | `.ai/guides/core.md` (Notifications), AGENTS.md task map | |
| seed / init command | `yarn initialize` / `mercato init`; demo tenants (`demo_gix`, `demo_puffin`) | Seeded price rules, offerings, quotes | `AGENTS.md` Key Commands, `specs/implementation/xd-276-cpq-data-seed.md` | |
| reference-app rule | CPQ ships as `@dainamite/cpq` (L2) | No imports from other `src/modules`, FK-string only, own migrations, contract changes logged in `packages/cpq/MIGRATION.md` | `CLAUDE.md`, `.ai/skills/cpq/SKILL.md` | |
| reference-app rule | Calculate-price API is a public contract | Additive changes only without a major bump | `.ai/skills/cpq/pricing/SKILL.md:39-41` | |
