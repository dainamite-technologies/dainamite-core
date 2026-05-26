---
name: cpq-packaging
description: Extracting CPQ from `src/modules/cpq/` to the `@dainamite/cpq` npm package per SPEC-001. Load when working on packaging, npm publishing, GitHub Packages auth, peer-dependency hygiene, or anything in `packages/cpq/`.
---

# CPQ — Packaging into `@dainamite/cpq`

## Authoritative documents

1. [`.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md`](../../specs/SPEC-001-2026-04-23-module-distribution-architecture.md) — the architecture decision (L1/L2/L3, namespace `@dainamite`, registry GitHub Packages)
2. [`.ai/skills/dainamite-layering/SKILL.md`](../../dainamite-layering/SKILL.md) — the **decision framework** for "where does this code live?" — load this if the question is "should X be its own package?", "L2 vs L3?", "promote @app → @dainamite?". This skill (packaging) covers the **mechanics** of doing the extraction; the layering skill covers the **principles**
3. [`packages/cpq/MIGRATION.md`](../../../packages/cpq/MIGRATION.md) — phased migration plan (Phase 0 done; Phase 1+ pending)
4. [`packages/cpq/README.md`](../../../packages/cpq/README.md) — package surface & rules

## Where things live today (Phase 0)

- **Code**: `src/modules/cpq/` (registered as `from: '@app'` in `src/modules.ts`)
- **Package shell**: `packages/cpq/` — only `package.json`, `README.md`,
  `MIGRATION.md` for now
- **Distribution**: not yet — installation still happens via the in-tree
  module loader

## Hard rules when working on the eventual package

- **`peerDependencies` only** for `@open-mercato/*` and sibling
  `@dainamite/*`. Putting them in `dependencies` causes duplicate copies
  in customer `node_modules` — silent runtime corruption.
- **No imports from non-CPQ `src/modules/`.** If something is needed from
  another module, expose it via REST or events, not by import.
- **No ORM relations across the package boundary.** Already a global rule
  but doubly important here — extraction will fail otherwise.
- **Migrations stay with the package.** Customer apps run
  `yarn mercato db migrate` after upgrade and that's enough.
- **No customer-specific code in `packages/cpq/`.** Customer-specific tweaks
  live in `dainamite-core/src/modules/@app/<feature>/`, never in CPQ itself.

## Phase 1 — Stand up the package build

When ready to actually move code into `packages/cpq/src/modules/cpq/`:

1. Add yarn workspaces to root `package.json`:
   ```json
   "workspaces": ["packages/*"]
   ```
2. Create `packages/cpq/tsconfig.json` extending the root config but with
   its own `outDir`.
3. Create `packages/cpq/build.mjs` mirroring the pattern from
   `node_modules/@open-mercato/core/build.mjs` — esbuild + the MikroORM
   entity-manifest dance the framework expects.
4. `git mv src/modules/cpq packages/cpq/src/modules/cpq` (single commit
   to preserve history).
5. Update `src/modules.ts`:
   `{ id: 'cpq', from: '@dainamite/cpq' }`.
6. `yarn install && yarn generate && yarn typecheck && yarn build`.
7. Smoke-test: list/create offering, run a wizard, convert a quote to
   order, activate order.

## Phase 2 — Cross-package coupling audit

Lint pass before publishing:

- `grep -rn "@ManyToOne\|@OneToMany\|@ManyToMany"` inside `packages/cpq/` —
  every result must point to another CPQ entity, never to `catalog`,
  `sales`, `customers`, etc.
- `grep -rn "from '@/modules/[^c]"` inside `packages/cpq/` — should
  return nothing (no imports from sibling app modules).
- Add an integration test that bootstraps the module registry with **only**
  `@dainamite/cpq` + its declared `requires` (`catalog`, `sales`,
  `customers`, `dictionaries`) — proves it can run standalone.

## Phase 3 — Publish to GitHub Packages

1. `.npmrc` template (committed):
   ```
   @dainamite:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
   ```
2. CI write token in GitHub Actions secret `NPM_TOKEN`.
3. Add changesets:
   ```bash
   yarn add -DW @changesets/cli
   yarn changeset init
   ```
4. First release:
   ```bash
   yarn changeset            # describe the release
   yarn changeset version    # bumps package.json + writes CHANGELOG.md
   yarn changeset publish    # publishes to GitHub Packages
   ```
5. Update [`packages/cpq/MIGRATION.md`](../../../packages/cpq/MIGRATION.md)
   marking Phase 3 done.

## Phase 4 — Move to `dainamite-product` monorepo

Out of scope for this repo. When triggered:

- New `dainamite-product/` git repo with `packages/cpq/` plus
  `tools/`, `.changeset/`, GH Actions release pipeline.
- `git mv packages/cpq` from `dainamite-core` into `dainamite-product`.
- `dainamite-core` keeps `from: '@dainamite/cpq'` and consumes from
  GitHub Packages exactly like a third-party customer app.

## Risks (carry-over from SPEC-001 §Ryzyka)

| Risk | Mitigation when packaging |
|---|---|
| Two CPQ instances in `node_modules` | `peerDependencies` only; narrow ranges (`^1.0.0`); coordinated changesets bumps |
| Sztywne ORM relations cross-package | Lint rule + isolation bootstrap test (Phase 2) |
| Breaking schema migration on customer DB | Migrations ship in package + upgrade path documented in CHANGELOG |
| Eject-driven version freeze | Don't eject CPQ from this repo — extend via UMES or fork the package |

## Self-review checklist

- [ ] No imports from non-CPQ `src/modules/<x>/` inside `packages/cpq/`.
- [ ] `peerDependencies` only — no `dependencies` on `@open-mercato/*` or
      `@dainamite/*` siblings.
- [ ] Cross-module references inside CPQ are FK strings, not relations.
- [ ] `MIGRATION.md` updated with the phase that just completed.
- [ ] If a public API/contract changed, bumped major and added a
      `CHANGELOG.md` entry.
- [ ] Customer-specific code is **not** in `packages/cpq/`.
