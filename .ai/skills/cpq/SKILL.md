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

## When to load which sub-skill

| Task touches | Load |
|---|---|
| Pricing tables, charges, price rules, calculate-price API | [`pricing/SKILL.md`](pricing/SKILL.md) |
| Quotes, quote items, wizards, configurator | [`quoting/SKILL.md`](quoting/SKILL.md) |
| Specifications, offerings, attributes, bundles, components, relationships | [`products/SKILL.md`](products/SKILL.md) |
| Customer inventory: subscriptions, subscription items, assets | [`inventory/SKILL.md`](inventory/SKILL.md) |
| Quote → Order conversion, order activation, order status | [`orders/SKILL.md`](orders/SKILL.md) |
| Extracting CPQ to `@dainamite/cpq` package | [`packaging/SKILL.md`](packaging/SKILL.md) |

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

## Hard rules

- Every entity is tenant-scoped: `organization_id` + `tenant_id` indexed,
  `created_at` / `updated_at` / `deleted_at` / `is_active` columns, UUID PK.
- **No ORM relations to non-CPQ entities** — `customer_id`, `product_id`,
  `quote_id`, etc. are FK strings. Use Response Enrichers / Widget Injection
  to surface joined data in UI.
- Status enums live in `services/types.ts` (`CPQ_STATUSES`,
  `INVENTORY_SUBSCRIPTION_STATUSES`, `INVENTORY_ASSET_STATUSES`,
  `CPQ_ORDER_STATUSES`) — extend there, not inline.
- After editing entities, run `yarn mercato db generate` (NEVER hand-write a
  migration). Confirm with the user before `yarn mercato db migrate`.
- After touching `acl.ts`, `ce.ts`, `events.ts`, `data/enrichers.ts`, any
  `api/`, `subscribers/`, `workers/`, or widget files, run `yarn generate`.
- All user-facing strings via `useT()` / `resolveTranslations()` — never
  hardcoded.
- Sidebar icons via `lucide-react` only.

## ACL features (don't invent new prefixes)

```
cpq.quotes.{view,manage}
cpq.pricing.{view,manage}
cpq.products.{view,manage}
cpq.specifications.{view,manage}
cpq.offerings.{view,manage}
cpq.wizards.{view,manage}
cpq.orders.{view,manage}
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
6. [`specs/implementation/`](../../../specs/implementation/) — the long-form specs behind each manual

## Self-review checklist (CPQ-specific)

- [ ] Touched only files under `src/modules/cpq/` — no leakage into other
      `src/modules/<x>/`.
- [ ] All cross-module references are FK strings, not ORM relations.
- [ ] Entities are tenant-scoped with the standard columns.
- [ ] Used the closure-resolution DI pattern for new services.
- [ ] Followed `api/<resource>/route.ts` layout.
- [ ] Status enums updated in `services/types.ts`, not inline.
- [ ] ACL features added to `acl.ts` AND wired in `setup.ts`
      `defaultRoleFeatures`.
- [ ] User-facing strings translated.
- [ ] Ran `yarn generate` and `yarn mercato db generate` as appropriate.
- [ ] Documented any breaking change in [`packages/cpq/MIGRATION.md`](../../../packages/cpq/MIGRATION.md)
      so it lands in the eventual `@dainamite/cpq` CHANGELOG.
