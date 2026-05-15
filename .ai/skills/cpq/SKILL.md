---
name: cpq
description: Top-level orientation for the Dainamite CPQ module (Configure, Price, Quote). Load whenever a task touches anything under `src/modules/cpq/` — products/specifications/offerings/bundles, pricing tables and rules, quotes and wizards, customer inventory, or quote-to-order conversion. Routes to the right sub-skill and lists the canonical files.
---

# CPQ — Module Overview

The Dainamite CPQ module is an in-tree custom module today (`src/modules/cpq/`,
registered as `from: '@app'`) that is **destined to ship as `@dainamite/cpq`**
on GitHub Packages. Read [`packages/cpq/MIGRATION.md`](../../../packages/cpq/MIGRATION.md)
and [`.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md`](../../specs/SPEC-001-2026-04-23-module-distribution-architecture.md)
before doing anything that affects the public surface.

## Authority — what this skill does NOT restate

These OM skills (and `AGENTS.md`, which is always loaded) are the authority on
cross-cutting concerns. **Do not re-derive them from CPQ docs** — if a CPQ
rule looks the same as one of these, the OM source wins.

| Concern | Authority |
|---|---|
| Tenant scoping, organization_id, standard columns, no cross-module ORM, FK strings, DI, openApi export, useT, lucide icons, `pageSize ≤ 100` | [`../../../AGENTS.md`](../../../AGENTS.md) "Architecture Rules" + "Naming Conventions" |
| Generic components, decomposition / file-size ceilings, scale-first (100k+, no N+1, paginate, indexes), extracted utilities | [`../engineering-principles/SKILL.md`](../engineering-principles/SKILL.md) |
| Review workflow, CI/CD gate (`yarn generate / typecheck / test / build`), severity classification, output format | [`../code-review/SKILL.md`](../code-review/SKILL.md) |
| Mock-EM patterns, error-throw forms, `getBaseCurrencyCode` gotcha, what-to-test matrix | [`../unit-tests/SKILL.md`](../unit-tests/SKILL.md) |
| Entity design, relationships, migration lifecycle, jsonb, cross-module references | [`../data-model-design/SKILL.md`](../data-model-design/SKILL.md) |
| `CrudForm` / `DataTable` / `FormHeader` / `Page` layout, list+detail page pattern, keyboard shortcuts | [`../backend-ui-design/SKILL.md`](../backend-ui-design/SKILL.md) |
| L1 / L2 / L3 placement, `@app` vs `@dainamite/*` promotion, when to eject | [`../dainamite-layering/SKILL.md`](../dainamite-layering/SKILL.md) |
| UMES extension primitives — enrichers, interceptors, widgets, mutation guards, component replacement | [`../system-extension/SKILL.md`](../system-extension/SKILL.md) |
| Spec writing, spec implementation across phases | [`../spec-writing/SKILL.md`](../spec-writing/SKILL.md), [`../implement-spec/SKILL.md`](../implement-spec/SKILL.md) |
| MikroORM v6→v7, Knex→Kysely, decorator imports | [`../migrate-mikro-orm/SKILL.md`](../migrate-mikro-orm/SKILL.md) |

The rest of this document is **CPQ-specific** — invariants, domain
vocabulary, file layout, sub-skill routing — that the OM skills cannot
know about.

## Engineering bar — CPQ-specific lens

You are working at a **senior Open Mercato engineer / architect** level. That
is the bar for every change that lands in CPQ. Concretely:

### 0. Open Mercato specialist (foundational)

Before "senior engineer" comes "knows the framework." CPQ is built on top of
Open Mercato, and 80% of what looks like a CPQ design choice is actually a
framework convention. Get this wrong and the code won't even hot-reload.

- **Default to framework primitives.** Need to react to a write? Subscriber
  + event, not a service hook. Need to extend another module's response?
  Response enricher, not a runtime join in your route. Need a UI add-on?
  Widget injection or component replacement, not a fork.
- **Read the relevant `@open-mercato/*/AGENTS.md` first.** When in doubt
  about modules / DI / events / RBAC / encryption / cache / queue / search /
  custom fields — the framework's own docs are in `node_modules/@open-mercato/`.
  Never guess from generic Next.js / MikroORM knowledge.
- **Respect auto-discovery file layout.** Filenames and locations *are* the
  contract — `events.ts`, `acl.ts`, `setup.ts`, `ce.ts`, `data/entities.ts`,
  `data/validators.ts`, `data/enrichers.ts`, `subscribers/*.ts`,
  `workers/*.ts`, `widgets/injection-table.ts`. Run `yarn generate` after
  any structural change, every time.
- **Cross-module = FK string + framework primitive.** Direct imports of
  another module's services / entities are a code smell; ORM relations
  across modules are a hard fail.
- **Commands for writes.** Mutations go through commands (`execute` +
  `undo`); side-effect emitters live OUTSIDE `withAtomicFlush`.
- See [`../../CLAUDE.md`](../../../CLAUDE.md) → "Framework reference map"
  for the per-package doc index.

### 1. Senior engineer mindset — CPQ-specific invariants

Generic "read before write / no half-finished work / idempotent workers"
guidance lives in [`../../../AGENTS.md`](../../../AGENTS.md) and
[`../engineering-principles/SKILL.md`](../engineering-principles/SKILL.md).
CPQ adds these non-obvious invariants you must know before touching code:

- **CPQ is a ~6KLOC service layer** with hidden coupling — charge uniqueness
  per offering, `withAtomicFlush` around mutate-then-query on the same EM,
  status state-machines, FK-only cross-module references. Open the relevant
  service / manual / spec before guessing.
- **Status changes propagate through state-machines, not raw property
  writes.** All four live in `services/types.ts` — see §4 below.
- **Push back on requests that break a documented CPQ invariant** —
  FK-string-only, charge-uniqueness, no-direct-sales-mutation. Call it out
  and propose the alternative.

### 2. API-first

**Every new feature starts with the REST contract, not the UI.** That means:

1. Write the OpenAPI block (`openApi` export from the route file) **before**
   wiring backend pages. Use `createCrudOpenApiFactory` for CRUD routes.
2. The backend UI is a **consumer** of that API. Pages must call the same
   endpoints external integrators would — no shortcut DAL access from the
   page-level loader.
3. Contracts are **versioned and stable**. Any breaking change to a CPQ API
   shape is a major bump in `packages/cpq/MIGRATION.md` + an entry in
   `CHANGELOG.md`. Even before extraction, treat them like that.
4. Custom (non-CRUD) write routes MUST call `validateCrudMutationGuard`
   before mutation and `runCrudMutationGuardAfterSuccess` after success.
5. Every route file MUST `export const openApi`. No exceptions; the OpenAPI
   bundle generation will fail otherwise.

### 3. Every entity has a detail page — CPQ surface conventions

The generic list + detail pattern (`FormHeader` in `detail` mode, loading /
404 / error states, `CrudForm` composition, breadcrumb / `navHidden` /
`pageGroupKey` wiring) lives in
[`../backend-ui-design/SKILL.md`](../backend-ui-design/SKILL.md). CPQ-specific
additions:

- File layout: `backend/cpq/<entity>/page.tsx` (list) +
  `backend/cpq/<entity>/[id]/page.tsx` (detail) +
  `[id]/page.meta.ts`.
- Injection slots: `crud-form:cpq.<entity>:fields` and `data-table:*`
  MUST be exposed so cross-module add-ons can extend without forking CPQ.
- RBAC: list uses `cpq.<domain>.view`, detail edit gate uses
  `cpq.<domain>.manage` (see "ACL features" below for the exact prefixes).

### 4. Unit tests are obligatory

Every PR that adds or changes behavior in `src/modules/cpq/` MUST land tests
on the changed layer (services / validators / state-machines / seeds /
non-trivial routes / new entities).

For the full WHAT-to-test matrix, mock-EM patterns, error-throw forms per
service (`QuotingError` / `OrderError` are Error subclasses; inventory
service throws plain `{ status, error }` objects), and the CPQ-specific
gotchas (`getBaseCurrencyCode` consuming a hidden `findOne`,
`buildQuoteResult` recomputing aggregates from line configs), load
[`.ai/skills/unit-tests/SKILL.md`](../unit-tests/SKILL.md) **before writing
any tests**.

CPQ-specific notes on top of the generic unit-tests skill:

- All four CPQ state machines live in `services/types.ts` —
  `ALLOWED_TRANSITIONS` (quote), `INVENTORY_SUBSCRIPTION_TRANSITIONS`,
  `INVENTORY_ASSET_TRANSITIONS`, `CPQ_ORDER_TRANSITIONS`. Each gets its own
  `describe` block in `services/__tests__/types.test.ts`.
- Pricing-rule application has 5 `ruleType` variants
  (`discount_percent`, `discount_absolute`, `surcharge_percent`,
  `surcharge_absolute`, `price_override`); cover all five and assert the
  delta sign in `result.adjustments[]`.
- Bundle slot/component creation is the most validation-heavy surface —
  every V-SLOT-1..7 and V-COMP-1..5 rule has a dedicated negative test in
  `cpqBundleService.test.ts` and is the template for similar rule-coded
  domains.

For end-to-end flows (sidebar, full quote-to-order journey) use the
Playwright suite — see [`.ai/skills/integration-tests/SKILL.md`](../integration-tests/SKILL.md).
Unit and integration tests are **complementary, not substitutes**.

### Definition of Done — CPQ-specific additions

The OM CI/CD gate (`yarn generate / typecheck / test / build`) and the
framework baseline (FK strings, `useT`, `openApi` export, tenant scope, ACL
features) are enforced by [`../code-review/SKILL.md`](../code-review/SKILL.md)
and [`../../../AGENTS.md`](../../../AGENTS.md). Don't restate them in PR
descriptions. On top of that, every CPQ change ships with:

- [ ] Relevant manual + spec + sub-skill read BEFORE coding (see "Reference
      reading order" below)
- [ ] Service-layer changes have unit tests for happy path + each edge
      (see [`../unit-tests/SKILL.md`](../unit-tests/SKILL.md) + §4 below)
- [ ] `withAtomicFlush` wraps any "mutate scalars then query on same EM"
      sequence
- [ ] ACL features added to `acl.ts` AND wired in `setup.ts`
      `defaultRoleFeatures` (the CPQ-specific wiring step)
- [ ] Status enums extended in `services/types.ts`, never inline
- [ ] Manuals (`manuals/xd-*.md`) updated if behavior changed
- [ ] `packages/cpq/MIGRATION.md` updated if a public contract changed

## When to load which sub-skill

| Task touches | Load |
|---|---|
| Pricing tables, charges, price rules, calculate-price API | [`pricing/SKILL.md`](pricing/SKILL.md) |
| Quotes, quote items, wizards, configurator | [`quoting/SKILL.md`](quoting/SKILL.md) |
| Specifications, offerings, attributes, bundles, components, relationships | [`products/SKILL.md`](products/SKILL.md) |
| Customer inventory: subscriptions, subscription items, assets | [`inventory/SKILL.md`](inventory/SKILL.md) |
| Quote → Order conversion, order activation, order status | [`orders/SKILL.md`](orders/SKILL.md) |
| Amend / Renew / Cancel a live subscription via quote (ARC, XD-250) | [`arc/SKILL.md`](arc/SKILL.md) |
| Extracting CPQ to `@dainamite/cpq` package (mechanical) | [`packaging/SKILL.md`](packaging/SKILL.md) |
| Deciding where new code lives (L1/L2/L3, `@dainamite` vs `@app`) | [`../dainamite-layering/SKILL.md`](../dainamite-layering/SKILL.md) |

## Module anatomy (recap)

```
src/modules/cpq/
├── index.ts              metadata: requires ['catalog', 'sales', 'customers', 'dictionaries']
├── acl.ts                14 features (cpq.{quotes,pricing,products,specifications,offerings,wizards,orders}.{view,manage})
├── ce.ts                 18 custom entity registrations for customisable fields
├── cli.ts                CLI commands
├── di.ts                 8 services registered (closure-resolution pattern — see note)
├── setup.ts              tenant init + 43KB of seed data
├── data/
│   ├── entities.ts       19 MikroORM entities (~1.2KLOC)
│   └── validators.ts     Zod schemas
├── api/                  Next.js-style `<resource>/route.ts` (NOT framework's `<method>/<path>.ts`)
├── backend/cpq/          admin UI: offerings, pricing, price-rules, quotes, specifications, wizards, orders, inventory
├── services/             8 services: pricing, quoting, validation, product, wizard, inventory, order, bundle
│   └── types.ts          shared service-level types (CreateQuoteInput, QuoteResult, RuleAdjustment, …)
├── widgets/injection/    customer-inventory, order-cpq-tab, quote-configurator
├── workflows/            wizard runner & step types
├── lib/seeds.ts          GIX wizard seed
└── migrations/           14 MikroORM migrations
```

## DI quirk — closure resolution

`src/modules/cpq/di.ts` resolves dependencies via `container.resolve(...)` inside
each factory rather than via destructured factory parameters. Reason documented
in the file: Awilix uses `InjectionMode.CLASSIC` and Turbopack rewrites
destructured arrows in a way that breaks the parameter-name parser. **Match
this style** when adding new CPQ services. Core modules (in `node_modules/`)
ship pre-compiled and don't have this problem.

## Routing convention

CPQ uses `api/<resource>/route.ts` (Next.js style). The framework default for
new modules is `api/<method>/<path>.ts`. **For CPQ, follow CPQ.** For any new
sibling module under `src/modules/`, follow the framework default.

## Hard rules — CPQ-specific only

Framework-wide hard rules (tenant scoping, `organization_id` + standard
columns, no cross-module ORM, FK strings, `yarn generate` after structural
edits, `yarn mercato db generate` for entity changes, `useT()` for strings,
`lucide-react` icons only) are in
[`../../../AGENTS.md`](../../../AGENTS.md) and apply to every module.
CPQ adds:

- **Status enums live in `services/types.ts`** (`CPQ_STATUSES`,
  `INVENTORY_SUBSCRIPTION_STATUSES`, `INVENTORY_ASSET_STATUSES`,
  `CPQ_ORDER_STATUSES`) — extend there, not inline. Transition tables
  (`ALLOWED_TRANSITIONS`, `INVENTORY_SUBSCRIPTION_TRANSITIONS`, etc.) sit
  alongside.
- **Charges are unique per offering** (migration
  `Migration20260331000000_cpq_charge_unique_per_offering.ts`) — guard
  this invariant before persisting a `CpqProductCharge`.
- **CPQ does not own the sales quote / order header** — never mutate
  `sales_*` rows directly; go through `salesQuoteService` /
  `salesOrderService` or emit a domain event.
- **CPQ uses `api/<resource>/route.ts`** (Next.js style), not the framework
  default `api/<method>/<path>.ts`. See "Routing convention" below.
- **CPQ DI uses closure resolution** (`container.resolve(...)` inside each
  factory). See "DI quirk" below.

## ACL features (don't invent new prefixes)

```
cpq.quotes.{view,manage}
cpq.pricing.{view,manage}
cpq.products.{view,manage}
cpq.specifications.{view,manage}
cpq.offerings.{view,manage}
cpq.wizards.{view,manage}
cpq.orders.{view,manage}
cpq.arc.{amend,renew,cancel}.manage
cpq.arc.changelog.view
cpq.inventory.expiring.view
```

When evaluating raw granted features in runtime code, use `hasFeature` /
`hasAllFeatures` from `@open-mercato/shared/lib/auth/featureMatch` — never
`.includes()` (wildcard grants like `cpq.*` will silently fail).

## Reference reading order for new contributors

1. [`manuals/cpq-quote-to-order-conversion.md`](../../../manuals/cpq-quote-to-order-conversion.md) — end-to-end happy path
2. [`manuals/xd-186-pricing-tables.md`](../../../manuals/xd-186-pricing-tables.md) + [`manuals/xd-188-price-rules.md`](../../../manuals/xd-188-price-rules.md) — money model
3. [`manuals/xd-188-quote-wizard-with-price-rules.md`](../../../manuals/xd-188-quote-wizard-with-price-rules.md) — guided flow UX
4. [`manuals/xd-215-customer-inventory.md`](../../../manuals/xd-215-customer-inventory.md) — what survives after order activation
5. [`manuals/xd-223-bundled-offerings.md`](../../../manuals/xd-223-bundled-offerings.md) — composite offerings
6. [`manuals/xd-250-arc-flow.md`](../../../manuals/xd-250-arc-flow.md) + [`specs/implementation/xd-250-arc-spec.md`](../../../specs/implementation/xd-250-arc-spec.md) — Amend / Renew / Cancel operator flow on live subscriptions
7. [`specs/implementation/`](../../../specs/implementation/) — the long-form specs behind each manual

## Self-review checklist — CPQ-specific only

Framework-wide checks (FK strings, tenant scoping, translations, `yarn
generate`, `yarn mercato db generate`) are covered by
[`../code-review/SKILL.md`](../code-review/SKILL.md) and
[`../../../AGENTS.md`](../../../AGENTS.md). CPQ-specific additions:

- [ ] Touched only files under `src/modules/cpq/` — no leakage into other
      `src/modules/<x>/` (customer tweaks belong in
      `src/modules/@app/<feature>/`).
- [ ] Used the closure-resolution DI pattern for new services.
- [ ] Followed `api/<resource>/route.ts` layout (not the framework default).
- [ ] Status enums updated in `services/types.ts`, not inline.
- [ ] ACL features added to `acl.ts` AND wired in `setup.ts`
      `defaultRoleFeatures`.
- [ ] Documented any breaking change in [`packages/cpq/MIGRATION.md`](../../../packages/cpq/MIGRATION.md)
      so it lands in the eventual `@dainamite/cpq` CHANGELOG.
