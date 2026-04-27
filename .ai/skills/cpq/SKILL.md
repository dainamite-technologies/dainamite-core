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

## Engineering bar — non-negotiable

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

### 1. Senior engineer mindset

- **Read before you write.** Open the existing service, validator, migration,
  and the relevant manual + spec. CPQ is a 6KLOC service layer with non-obvious
  invariants (charge uniqueness, atomic flush, status state-machines, FK-only
  cross-module references). Patterns guessed from one file don't transfer.
- **Identify hidden coupling.** Cross-module ORM relations are forbidden
  (FK-string only). Two CPQ services sharing an `EntityManager` need
  `withAtomicFlush`. Status changes propagate through state-machines, not
  raw property writes. Spot these before changing data shape.
- **Push back.** If the request would break a documented invariant
  (FK-string-only, charge-uniqueness, no-direct-sales-mutation, etc.) — call
  it out and propose the alternative. Don't paper over it with a hack.
- **No half-finished work.** Either ship the change end-to-end (entity →
  validator → service → API → UI list → UI detail → tests → manual update)
  or split the spec into phases and finish each one cleanly.
- **Idempotent, observable, recoverable.** Worker / activation / cleanup
  paths must be safe under retry. Server-side errors carry enough context
  to diagnose without local repro.

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

### 3. Every entity has a detail page

If you introduce a new entity (or expose an existing one in the admin UI),
you ship **both** a list page and a detail page. The detail page is not
optional. Concretely:

- `backend/cpq/<entity>/page.tsx` — list (DataTable)
- `backend/cpq/<entity>/[id]/page.tsx` — detail (CrudForm in `edit` mode +
  related sections via injection slots)
- `backend/cpq/<entity>/[id]/page.meta.ts` — `navHidden: true`, breadcrumb
  pointing back to the list, same `pageGroup` / `pageGroupKey`

The detail page MUST:
- Use `FormHeader` in `detail` mode (large title + entity-type label +
  status badge if applicable + Actions dropdown for `menuActions`).
- Render `LoadingMessage` / `ErrorMessage` for loading / error / 404 states
  (treat 404 as a distinct state — don't fall through to a blank `CrudForm`).
- Expose `crud-form:cpq.<entity>:fields` and `data-table:*` injection
  surfaces so cross-module add-ons can extend without forking CPQ.
- Carry the same RBAC features as the list (`cpq.<domain>.view` to read,
  `cpq.<domain>.manage` to edit).

### 4. Unit tests are obligatory

Every PR that adds or changes behavior in `src/modules/cpq/` MUST land tests:

| Layer changed | Required test |
|---|---|
| `services/<service>.ts` (new method or branch) | Unit test in `services/__tests__/<service>.test.ts` covering the happy path + each documented edge case |
| `data/validators.ts` | Round-trip tests: valid input parses, invalid input fails with stable error keys |
| `services/types.ts` enum / state-machine | Transition tests: every legal transition allowed, every illegal one rejected |
| `lib/seeds.ts` or `setup.ts` seeding | Snapshot-style test on the seeded shape so accidental drift fails CI |
| New API route | If non-trivial logic — controller test that calls the route handler with a mocked container; if pure CRUD — covered by service test + integration test (Playwright) |
| New entity | Migration test (entity → diff matches generated migration) + a service-level "can be created and re-fetched" test |

**Test conventions:**
- Path: `src/modules/cpq/<area>/__tests__/<unit>.test.ts`
- Runner: `jest --config jest.config.cjs` (already wired via `yarn test`)
- One file per unit; one `describe` block per public method
- Test naming: `it('rejects X when Y')` — describe the contract, not the
  implementation
- Use real validators / Zod schemas. Mock only at the EM / external-IO
  boundary. No mocking of pure functions.
- Money: assert on integer cents or decimals — never on `Number` floats
- Avoid snapshot tests for anything except seed shapes — they rot fast

For end-to-end flows (sidebar, full quote-to-order journey) use the
Playwright suite — see [`.ai/skills/integration-tests/SKILL.md`](../integration-tests/SKILL.md).
Unit and integration tests are **complementary, not substitutes**.

### Definition of Done — applies to every CPQ change

- [ ] Read the relevant manual + spec + sub-skill BEFORE coding
- [ ] OpenAPI block written / updated for any new or changed route
- [ ] Validators (Zod) updated; types derived via `z.infer`
- [ ] Service-layer changes have unit tests for happy path + each edge
- [ ] If a new entity is exposed: list page **and** detail page exist
- [ ] Detail page handles loading / 404 / error states distinctly
- [ ] Cross-module references are FK strings (no `@ManyToOne` outside CPQ)
- [ ] `withAtomicFlush` wraps any "mutate scalars then query on same EM"
      sequence
- [ ] ACL features added to `acl.ts` AND wired in `setup.ts`
- [ ] User-facing strings via `useT()` / `resolveTranslations()`
- [ ] `yarn generate` re-run after touching auto-discovered files
- [ ] `yarn mercato db generate` re-run after entity changes; migration
      reviewed before applying
- [ ] `yarn typecheck` and `yarn test` green locally
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
