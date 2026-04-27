@AGENTS.md

## Project: dainamite-core

This is the **first L3 customer demo** ("Demo Netia") in the Dainamite product
line — a standalone Open Mercato application that consumes `@open-mercato/*`
from `node_modules/` and currently hosts the in-tree CPQ module.

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
| Extract / package CPQ as `@dainamite/cpq` | `.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md`, `packages/cpq/MIGRATION.md` |

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
