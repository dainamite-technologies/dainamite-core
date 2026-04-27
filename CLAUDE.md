@AGENTS.md

## Project: dainamite-core

This is the **first L3 customer demo** ("Demo Netia") in the Dainamite product
line — a standalone Open Mercato application that consumes `@open-mercato/*`
from `node_modules/` and currently hosts the in-tree CPQ module.

## Open Mercato framework expertise — table stakes

Anyone (or any agent) working in this repo is expected to operate as an
**Open Mercato specialist**. That is not optional — patterns guessed from
generic Next.js / TypeScript / MikroORM knowledge will produce code that
violates documented framework invariants. Open Mercato has a specific
extensibility contract; learn it before changing things.

What "specialist" means concretely:

- You know **what each package does** and which one to read first.
- You know the **auto-discovery conventions** (`backend/page.tsx`,
  `api/<method>/<path>.ts` or CPQ-style `api/<resource>/route.ts`,
  `subscribers/*.ts`, `workers/*.ts`, `widgets/injection/`,
  `data/entities.ts`, `data/validators.ts`, `data/extensions.ts`,
  `data/enrichers.ts`, `events.ts`, `acl.ts`, `setup.ts`, `ce.ts`,
  `translations.ts`, `notifications.ts`, `search.ts`).
- You know the **non-negotiable architectural rules**: tenant-scoped
  entities (`organization_id` + `tenant_id` indexed; standard columns),
  no ORM relations across modules, command pattern for writes,
  `withAtomicFlush` for mutate-then-query sequences on the same EM,
  `openApi` export on every route, `lucide-react` icons only.
- You know the **extension primitives** (UMES — Response Enrichers,
  Widget Injection, API Interceptors, Mutation Guards, Component
  Replacement, Event Subscribers, Triad Pattern) and prefer them
  over module-to-module imports.
- You know **where to look when in doubt**: the framework's own docs
  ship inside `node_modules/@open-mercato/*/AGENTS.md`. Read them rather
  than guessing.

### Framework reference map (load these BEFORE writing code)

Each `@open-mercato/*` package ships authoritative agent docs. When work
touches a package, open its file first:

| Package / area | File |
|---|---|
| Master extensibility contract — modules, DI, events, custom fields, ACL, setup, response enrichers, API interceptors, widget injection, component replacement, RBAC wildcard matcher, `withAtomicFlush`, command pattern | `node_modules/@open-mercato/core/AGENTS.md` |
| Sales (quote → order → invoice flow, `salesCalculationService`, returns, channels) — **CPQ piggybacks on sales for headers** | `node_modules/@open-mercato/core/src/modules/sales/AGENTS.md` |
| Customers / catalog / currencies / integrations / data_sync / workflows / customer_accounts / auth (RBAC) / directory | `node_modules/@open-mercato/core/src/modules/<module>/AGENTS.md` |
| Event bus — `createModuleEvents`, subscribers, persistent vs ephemeral, SSE bridge | `node_modules/@open-mercato/events/AGENTS.md` |
| Shared utilities — `withAtomicFlush`, response enrichers, query engine extensibility, feature-match helpers (wildcard-aware) | `node_modules/@open-mercato/shared/AGENTS.md` |
| `CrudForm`, `DataTable`, primitives, sidebar icons, portal extension, FormHeader/FormFooter | `node_modules/@open-mercato/ui/AGENTS.md` |
| CLI — generator system, auto-discovery file patterns, module-scoped migrations | `node_modules/@open-mercato/cli/AGENTS.md` |
| Worker contract — `metadata = { queue, id?, concurrency? }`, idempotency, local/async strategies | `node_modules/@open-mercato/queue/AGENTS.md` |
| Cache, search, content, onboarding, ai-assistant | `node_modules/@open-mercato/<package>/AGENTS.md` |
| Scheduler (no AGENTS.md) — read `node_modules/@open-mercato/scheduler/src/index.ts` for the `CommandHandler` / `registerCommand` API |  |

Where the framework's docs and our project conventions diverge, our
conventions win for repo-local code (e.g. CPQ uses Next.js-style
`api/<resource>/route.ts`; new modules follow framework's
`api/<method>/<path>.ts`). The divergences are documented per-skill —
when you spot a conflict, surface it rather than picking sides silently.

## Engineering bar — applies to ALL contributors

Every change in this repo is reviewed at a senior-engineer / architect bar.
The four non-negotiables (full version with rationale lives in
[`.ai/skills/cpq/SKILL.md`](.ai/skills/cpq/SKILL.md) → "Engineering bar"):

1. **Senior mindset** — read the existing service / spec / manual before
   writing. Identify hidden coupling. Push back on requests that break a
   documented invariant. No half-finished work.
2. **API-first** — every new feature starts with the REST contract
   (`openApi` export). UI is a consumer of the API. Breaking changes are
   versioned and changelogged.
3. **Every entity has a detail page** — if it's listed in admin UI,
   `backend/<module>/<entity>/page.tsx` (list) AND
   `backend/<module>/<entity>/[id]/page.tsx` (detail) ship together.
   Detail uses `FormHeader` in `detail` mode, handles loading / 404 / error
   distinctly, exposes injection slots for cross-module add-ons.
4. **Unit tests are obligatory** — services, validators, state machines,
   and seeds get tests under `__tests__/`. Use `jest --config jest.config.cjs`
   (already wired via `yarn test`). Integration / E2E flows go to Playwright
   per [`.ai/skills/integration-tests/SKILL.md`](.ai/skills/integration-tests/SKILL.md).

The full **Definition of Done** checklist (read it before opening a PR) is in
[`.ai/skills/cpq/SKILL.md`](.ai/skills/cpq/SKILL.md). It covers OpenAPI,
validators, atomic flush, ACL wiring, i18n, generators, manual updates, and
the migration log in `packages/cpq/MIGRATION.md`.

For the full distribution architecture (L1 = Open Mercato core, L2 =
`@dainamite/*` product modules, L3 = customer apps), read
[`.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md`](.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md).

## CPQ module

The Dainamite CPQ module lives at [`src/modules/cpq/`](src/modules/cpq/) and
is registered as `{ id: 'cpq', from: '@app' }` in
[`src/modules.ts`](src/modules.ts).

**It will be extracted to `@dainamite/cpq` and published to GitHub Packages.**
The eventual home is [`packages/cpq/`](packages/cpq/) — see
[`packages/cpq/MIGRATION.md`](packages/cpq/MIGRATION.md) for the phased plan.

Treat every change in `src/modules/cpq/` as code that will ship as a
standalone npm package. That has hard consequences:

- **No imports from `src/modules/<other>/`** — CPQ must be installable in any
  customer repo without our other in-tree modules. Use FK ids and Response
  Enrichers / Widget Injection for cross-module integration.
- **No ORM relations to entities outside `cpq`** (`@ManyToOne` / `@OneToMany`
  to `catalog`, `sales`, `customers`, etc.). Cross-module references are
  string columns (`customer_id`, `product_id`) resolved at runtime.
- **Customer-specific tweaks DO NOT belong in `src/modules/cpq/`.** Put them
  in a separate `src/modules/@app/<feature>/` module that depends on CPQ via
  events or REST.
- **Migrations live in `src/modules/cpq/migrations/`** and ship with the
  package — never hand-write them, always go through `yarn mercato db generate`.
- The CPQ module already uses Next.js-style `api/<resource>/route.ts` routes
  (not the framework's method-first `api/<method>/<path>.ts`). When extending
  CPQ, **match CPQ's style**; when scaffolding a *new* module, use the
  framework convention.

### CPQ → Task → Context Map

When the task touches CPQ, add the CPQ-specific files below to whatever the
generic Task → Context Map (in AGENTS.md) tells you to load.

| Task | Load |
|---|---|
| Anything CPQ-touching (start here) | `.ai/skills/cpq/SKILL.md` |
| Modify pricing rules / pricing tables | `.ai/skills/cpq/pricing/SKILL.md`, `manuals/xd-186-pricing-tables.md`, `manuals/xd-188-price-rules.md`, `manuals/xd-217-tiered-pricing-and-price-rules.md` |
| Modify quotes / quote wizards / configurator | `.ai/skills/cpq/quoting/SKILL.md`, `manuals/xd-188-quote-wizard-with-price-rules.md`, `specs/implementation/xd-201-quoting.md` |
| Modify offerings / bundles / specifications | `.ai/skills/cpq/products/SKILL.md`, `manuals/xd-223-bundled-offerings.md`, `specs/implementation/xd-187-product-specification.md` |
| Modify customer inventory / subscriptions | `.ai/skills/cpq/inventory/SKILL.md`, `manuals/xd-215-customer-inventory.md`, `specs/implementation/xd-215-customer-inventory.md` |
| Quote → Order conversion / order activation | `.ai/skills/cpq/orders/SKILL.md`, `manuals/cpq-quote-to-order-conversion.md` |
| Calculate-price API contract | `manuals/xd-187-calculate-price-api.md` |
| Extract / package CPQ as `@dainamite/cpq` (mechanical) | `.ai/skills/cpq/packaging/SKILL.md`, `packages/cpq/MIGRATION.md` |

### Cross-cutting: where does this code live?

Before adding a new module, package, or large feature, decide which layer
(L1 Open Mercato core / L2 `@dainamite/*` / L3 customer app) it belongs to.

| Question | Load |
|---|---|
| New module / package / feature — should it be reusable, customer-specific, or upstreamed? | `.ai/skills/dainamite-layering/SKILL.md`, `.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md` |
| Promoting an `@app/<feature>` to a `@dainamite/*` package | `.ai/skills/dainamite-layering/SKILL.md` → "Promotion: L3 → L2" |
| Considering ejecting a core module | `.ai/skills/dainamite-layering/SKILL.md` → "Ejection", `.ai/skills/eject-and-customize/SKILL.md` |

### Two spec conventions in this repo

This repo uses two parallel specification systems — don't mix them up.

1. **Project feature specs**: [`specs/implementation/xd-{JIRA}-{slug}.md`](specs/implementation/) —
   JIRA-linked feature specs in the 16-section format (see
   `xd-201-quoting.md`, `xd-215-customer-inventory.md`). Use this for new
   feature work.
2. **Architectural specs**: [`.ai/specs/SPEC-{NNN}-{date}-{slug}.md`](.ai/specs/) —
   cross-cutting / framework-level decisions. Use this for architecture
   choices like SPEC-001.

## Manuals

[`manuals/`](manuals/) contains the canonical functional/operator-facing
documentation for CPQ flows. When implementing or modifying a flow, read the
relevant manual — they encode product decisions that are **not** derivable
from the code.

## Dainamite distribution rules (carried from SPEC-001)

These apply to anything that will ship as `@dainamite/*`:

- **`peerDependencies`, never `dependencies`** for sibling `@dainamite/*` and
  `@open-mercato/*` — yarn must keep a single shared instance in
  `node_modules`.
- **Cross-package data is FK-string only** — never an ORM relation across
  package boundaries.
- **One domain = one package.** Don't split CPQ into pricing/quoting/wizard
  sub-packages. Industry/vertical add-ons (e.g. `cpq-address-inventory` if it
  ever exists) get their own package.
- **Each package ships its own migrations** — `yarn mercato db migrate` after
  upgrade is enough.
- **Customer-specific code never publishes** — it lives in a customer repo
  under `src/modules/@app/<feature>/` and is promoted to a Dainamite package
  only after appearing at 2+ customers.
