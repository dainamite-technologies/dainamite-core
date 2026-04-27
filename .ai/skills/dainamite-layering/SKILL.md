---
name: dainamite-layering
description: Decide where new code lives in the Dainamite 3-layer architecture (L1 Open Mercato core / L2 @dainamite/* product packages / L3 customer apps). Load before adding ANY new module, package, or large feature, and whenever the question is "should this be reusable, customer-specific, or upstreamed?". Pairs with .ai/specs/SPEC-001 (the architectural decision) and cpq/packaging/SKILL.md (mechanical extraction).
---

# Dainamite — Layering & Distribution Logic

This skill is the **decision framework** for the 3-layer architecture
described in [`.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md`](../../specs/SPEC-001-2026-04-23-module-distribution-architecture.md).
Every new module, package, or large feature triggers the question
"where does this live?" — answer it here, before writing code.

For the **mechanical** how-to of extracting CPQ specifically to
`@dainamite/cpq`, see [`cpq/packaging/SKILL.md`](../cpq/packaging/SKILL.md).

## The 3 layers

```
┌─────────────────────────────────────────────────────────────┐
│ L1: Open Mercato core (upstream — we consume)               │
│     @open-mercato/core, /shared, /ui, /events, /search, …   │
│     We never edit. To customise: eject (heavy) or extend    │
│     via UMES (preferred).                                   │
└─────────────────────────────────────────────────────────────┘
                              ▲ npm install
┌─────────────────────────────┴───────────────────────────────┐
│ L2: Dainamite product modules (we own and publish)          │
│     @dainamite/cpq, @dainamite/billing, @dainamite/catalog… │
│     ─── 1 monorepo, many npm packages, GitHub Packages ───  │
│     Reusable across multiple customers. Versioned. Peer-    │
│     dependency-coupled. Migrations ship with the package.   │
└─────────────────────────────────────────────────────────────┘
                              ▲ npm install
┌─────────────────────────────┴───────────────────────────────┐
│ L3: Customer apps (one repo per customer)                   │
│     dainamite-core (Demo Netia), customer-acme-telco, …     │
│     Standalone Next.js apps. Install needed @dainamite/*    │
│     packages. Tenant-specific code lives in                 │
│     src/modules/@app/<feature>/ — never published.          │
└─────────────────────────────────────────────────────────────┘
```

`dainamite-core` is **L3** today (the first customer demo, "Demo Netia").
The CPQ module physically lives at `src/modules/cpq/` here for now but is
destined to graduate to L2 — see `packages/cpq/` (placeholder) and
`packages/cpq/MIGRATION.md`.

## Decision tree — where does new code go?

```
                   ┌─ Is it customer-specific (Demo Netia only)?
                   │     YES → L3 / src/modules/@app/<feature>/
                   │     NO  ↓
                   │
                   ├─ Is it a fork or deep customisation of an existing
                   │  Open Mercato core module?
                   │     YES → eject into L3 / src/modules/@app/<core-id>/
                   │           (last resort — see "Ejection") 
                   │     NO  ↓
                   │
                   ├─ Is it a generic capability we'd give to ANY customer
                   │  who buys this domain (CPQ, billing, catalog…)?
                   │     YES → L2 / packages/<name>/ → @dainamite/<name>
                   │     NO  ↓
                   │
                   ├─ Is it a vertical add-on (telco-only, retail-only,
                   │  healthcare-only) on top of an L2 package?
                   │     YES → L2 / packages/<base>-<vertical>/ →
                   │           @dainamite/<base>-<vertical>
                   │           (peerDependency on the base package)
                   │     NO  ↓
                   │
                   ├─ Does it belong upstream (would benefit ALL Open
                   │  Mercato users, not just Dainamite customers)?
                   │     YES → contribute to @open-mercato/core
                   │           OR build it as a generic L2 package and
                   │           propose upstreaming later
                   │     NO  ↓
                   │
                   └─ Reconsider — if none of the above, you don't have
                      a clear home. Probably it's customer-specific
                      (default to L3 / @app) or you're missing context.
```

## L2 packaging rules

When you decide the code goes to L2 (`@dainamite/*`):

| Rule | Why |
|---|---|
| **One domain = one package** | CPQ in one, Billing in another. Don't split CPQ into pricing/quoting sub-packages — coupling is too tight |
| **Vertical add-on = separate package** | `@dainamite/cpq-telco-addons` (if it ever exists) sits next to `@dainamite/cpq` and depends on it via `peerDependencies` |
| **Meta-bundles allowed (no code)** | A package with only `dependencies` on other `@dainamite/*` is fine for "buy this bundle" SKUs. Zero `src/modules/` |
| **`peerDependencies`, NEVER `dependencies`** for sibling `@dainamite/*` and `@open-mercato/*` | Otherwise yarn duplicates instances in `node_modules` → two DI containers → silent data corruption |
| **Cross-package data = FK string only** | Never `@ManyToOne` across package boundaries. Ever. Use Response Enrichers / Widget Injection / events for joining at the seams |
| **Migrations ship with the package** | Customer apps run `yarn mercato db migrate` after upgrade and it just works |
| **Customer-specific code NEVER lives here** | If it mentions "Acme" or "Netia" by name, it goes to L3 |
| **Versioned via changesets, semver enforced** | Patch = bugfix, Minor = additive, Major = breaking + upgrade notes in CHANGELOG |
| **Coordinated bumps for cross-package breaking changes** | Major bump in CPQ that requires changes in `cpq-telco-addons` → one PR, both bumped, peer range updated |

## L3 customer-app rules

For code that stays in `dainamite-core` (or any future customer repo):

| Rule | Why |
|---|---|
| **Custom code under `src/modules/@app/<feature>/`** | Distinct from L2 packages installed via npm; registered in `src/modules.ts` with `from: '@app'` |
| **No customer name in module IDs going to L2** | If you write `acme-pricing-rules`, it's L3 forever. Generic name + config = candidate for L2 promotion later |
| **`yarn mercato eject <core-module>` is last resort** | Freezes the customer on the current upstream version of that module. UMES (enrichers / interceptors / widgets / replacement) handles 90% of customisation needs without ejecting |
| **Customer-specific test data and seeds in L3** | Demo Netia fixtures, test customers, demo offerings — never in `@dainamite/*` |
| **L3 imports `@dainamite/*` like a third-party package** | Even today when `@dainamite/cpq` doesn't yet exist as a package, treat `src/modules/cpq/` as a black box: don't import it from `src/modules/@app/<x>/` directly. Use events / REST / response enrichers |

## Promotion: L3 → L2

A feature lives in `src/modules/@app/<feature>/` (L3) until **both**:

1. The same feature is requested by 2+ customers (or strongly anticipated to be), AND
2. The implementation has stabilised (no major redesign in last 1-2 sprints)

Promotion checklist:
- [ ] Strip customer-specific names, hardcoded ids, demo data
- [ ] Replace direct imports of L3 modules with framework primitives
- [ ] Add proper `peerDependencies` against `@open-mercato/*` and any sibling `@dainamite/*`
- [ ] Move migrations into the package
- [ ] Write a CHANGELOG entry (this is v0.1.0 of the new package)
- [ ] Add to the L2 monorepo's `packages/` directory; release via changesets
- [ ] Update L3 customer repos to consume from npm; remove the old `@app` copy in a follow-up

## Ejection (eject Open Mercato core into L3)

Use `yarn mercato eject <module>` only when **all** of these are true:

- The change is fundamental to the customer (you'd lose them otherwise)
- UMES extension primitives genuinely cannot achieve it (you tried)
- The customer accepts being frozen on the current upstream version of that
  module until the next eject-merge

Ejected code lives in `src/modules/@app/<core-module-id>/` and is registered
with `from: '@app'`. Track ejected modules per customer — at every Open
Mercato core major bump, do a manual review of every ejected module to
decide: re-eject from new upstream, port the diff manually, or drop the
customisation.

## Cross-cutting hard rules

These apply at every layer; learn them once.

| Rule | Layer | Reason |
|---|---|---|
| **No ORM relations across modules / packages** | L1, L2, L3 | Modules can be enabled/disabled dynamically; ORM relation = hard fail. FK string + framework primitive (response enricher / widget) is the only way |
| **Tenant-scoped entities have `organization_id` + `tenant_id` indexed, plus `id` UUID, `created_at`, `updated_at`, `deleted_at`, `is_active`** | L1, L2, L3 | Multi-tenant is non-negotiable; query engine, RBAC, encryption all assume this shape |
| **`openApi` export on every API route** | L1, L2, L3 | OpenAPI bundle generation fails otherwise; downstream contracts depend on it |
| **Custom write routes call `validateCrudMutationGuard` + `runCrudMutationGuardAfterSuccess`** | L1, L2, L3 | Record locks / mutation guards depend on this contract |
| **`withAtomicFlush` for "mutate-then-query on same EM" sequences** | L1, L2, L3 | MikroORM identity map silently drops pending changes otherwise — covered by SPEC-018 |
| **Wildcard-aware feature matching (`hasFeature` / `hasAllFeatures`)** | L1, L2, L3 | `module.*` and `*` grants must work; raw `.includes()` breaks them |
| **Sidebar icons via `lucide-react` only** | L1, L2, L3 | Inline SVG / `React.createElement('svg', ...)` breaks under `yarn generate` |

## When in doubt — ask these three

1. **"Will another Dainamite customer ever want this?"** — yes → L2 candidate; no → L3
2. **"Does it depend on something the customer's own infra exposes (their ERP, their billing, their identity provider)?"** — yes → integration provider package or L3 module; no → core domain candidate for L2
3. **"Could I describe this feature without naming any specific customer?"** — yes → ready for L2; no → keep in L3 until it can be

If the answer pulls in different directions, default to L3. Promotion to
L2 is reversible-ish (delete the package, copy back into `@app`); a
premature L2 with customer-specific assumptions baked in is much harder
to fix later.

## Self-review checklist (before opening the PR)

- [ ] Decision recorded in commit message or PR description: which layer
      and why
- [ ] If L2: package name follows `@dainamite/<domain>` convention; one
      domain per package
- [ ] If L2: `peerDependencies` (NOT `dependencies`) for `@open-mercato/*`
      and sibling `@dainamite/*`
- [ ] If L2: migrations ship inside the package
- [ ] If L2: README + CHANGELOG entry; semver impact identified
- [ ] If L3: feature lives under `src/modules/@app/<feature>/`; registered
      with `from: '@app'`
- [ ] If L3: no customer name baked into module id (so future promotion
      is possible)
- [ ] No ORM relations across module / package boundaries (FK string only)
- [ ] No direct imports between sibling modules — uses events / response
      enrichers / widget injection / REST instead
- [ ] If ejecting a core module: documented why UMES wasn't sufficient
