# Migration plan — `src/modules/cpq/` → `@dainamite/cpq`

This document tracks the concrete steps to extract the in-tree CPQ module into
the `@dainamite/cpq` package, per
[SPEC-001 — Module Distribution Architecture](../../.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md).

## Current state (2026-04-27)

- CPQ source lives at [`src/modules/cpq/`](../../src/modules/cpq/).
- Registered as `{ id: 'cpq', from: '@app' }` in
  [`src/modules.ts`](../../src/modules.ts).
- `packages/cpq/` is a structural placeholder only (this directory).
- `dainamite-core` repo is the L3 customer demo (Demo Netia) per SPEC-001 Q4.

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

### Phase 1 — Standalone build

- [ ] Promote root to a Yarn workspace (`workspaces: ["packages/*"]` in root
      `package.json`).
- [ ] Add `packages/cpq/tsconfig.json` extending root config.
- [ ] Add `packages/cpq/build.mjs` mirroring `@open-mercato/core` (esbuild +
      MikroORM entity manifest).
- [ ] Move `src/modules/cpq/` → `packages/cpq/src/modules/cpq/` (single git mv
      to preserve history).
- [ ] Update `src/modules.ts` entry to `{ id: 'cpq', from: '@dainamite/cpq' }`.
- [ ] Run `yarn install && yarn generate && yarn typecheck && yarn build`.
- [ ] Smoke-test backend: list/create offering, run a quote wizard.

### Phase 2 — Audit & lint cross-package coupling

- [ ] Grep for `@ManyToOne`, `@OneToMany`, `@ManyToMany` to entities outside
      `cpq` — replace with FK string columns.
- [ ] Grep for direct imports from other `src/modules/*` (custom in-app
      modules) — break them.
- [ ] Add a guard test: try to bootstrap CPQ in isolation (no other app modules
      registered).

### Phase 3 — Publish

- [ ] Configure `.npmrc` for GitHub Packages auth (read-only token committed
      to repo template, write token in CI secrets only).
- [ ] Add changesets (`@changesets/cli`) — patch bumps wired up.
- [ ] First publish: `@dainamite/cpq@0.1.0`.
- [ ] Update SPEC-001 changelog.

### Phase 4 — Extract to product monorepo

- [ ] Create new `dainamite-product/` repo with `packages/cpq/` plus tooling
      (`tools/`, `.changeset/`, GH Actions release pipeline).
- [ ] Move `packages/cpq/` from `dainamite-core` to `dainamite-product`.
- [ ] `dainamite-core` keeps `from: '@dainamite/cpq'` in `src/modules.ts`,
      installs from GitHub Packages just like any future customer repo.

## Risks (carried from SPEC-001)

| Risk | Mitigation |
|---|---|
| Cross-package ORM relations leak in | Lint rule + isolation bootstrap test |
| Two CPQ instances in `node_modules` | `peerDependencies` only, narrow ranges |
| Breaking schema migration on customer DB | Migrations ship in package, document upgrade in CHANGELOG |
| Custom @app code drifts from package | Audit every 6 months, promote duplicated features into the package |

## Open decisions (per SPEC-001 §Open Questions)

- Q3 — Monorepo tooling: yarn workspaces alone vs Nx/Turborepo. Default to
  workspaces; revisit at >15 packages.
- Q5 — Licensing model (per-package vs per-tenant). **Deferred.**
- Q6 — Customer repo commit access (us only vs customer too). **Deferred.**
