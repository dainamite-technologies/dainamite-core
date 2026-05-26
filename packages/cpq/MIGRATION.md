# Migration plan — `src/modules/cpq/` → `@dainamite/cpq`

This document tracks the concrete steps to extract the in-tree CPQ module into
the `@dainamite/cpq` package, per
[SPEC-001 — Module Distribution Architecture](../../.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md).

## Current state (2026-05-04)

- CPQ source lives at [`src/modules/cpq/`](../../src/modules/cpq/).
- Registered as `{ id: 'cpq', from: '@app' }` in
  [`src/modules.ts`](../../src/modules.ts).
- `packages/cpq/` is a structural placeholder only (this directory).
- `dainamite-core` repo is the L3 customer demo per SPEC-001 Q4.
- **Customer demo data does NOT live in `cpq/`** (since XD-276). GIX and
  Puffin Cloud catalog seeds live in `src/modules/demo_gix/` and
  `src/modules/demo_puffin/`, registered as use cases via
  `cpq/lib/seeds/api.ts` and orchestrated by `src/modules/demo_tenants/`.
  When extracting `@dainamite/cpq`, only the registry API ships; the demo
  modules stay in the customer repo.

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

### Phase 1 — Standalone build (XD-270, 2026-05-08)

- [x] Promote root to a Yarn workspace (`workspaces: ["packages/*"]` in root
      `package.json`).
- [x] Add `packages/cpq/tsconfig.json` (extends root) and
      `packages/cpq/tsconfig.build.json`.
- [x] Add `packages/cpq/build.mjs` (esbuild → `dist/`, mirrors
      `@open-mercato/core/build.mjs` — only `.js` emit, no `.d.ts`).
      Per Open Mercato convention, the package ships `src/` for types
      and `dist/` for runtime — exports map `types → ./src/*.ts`,
      `default → ./dist/*.js`.
- [x] Move `src/modules/cpq/` → `packages/cpq/src/modules/cpq/` (single
      `git mv` — history preserved, all 136 source files renamed).
- [x] Update `src/modules.ts` entry to `{ id: 'cpq', from: '@dainamite/cpq' }`.
- [x] Patch `@open-mercato/cli@0.5.0` to allow the `@dainamite/` prefix in
      `GENERATED_MODULE_SPECIFIER_PREFIXES` (the CLI rejects unknown package
      scopes when emitting `.mercato/generated/`). Patch lives at
      `.yarn/patches/@open-mercato-cli-npm-0.5.0-*.patch`. **Will be
      fixed upstream in the next framework release** — patch can be
      removed at that point.
- [x] Rewrite cross-module imports in `demo_gix`, `demo_puffin`,
      `demo_tenants`: `'../../cpq/...'` → `'@dainamite/cpq/modules/cpq/...'`
      (26 files). Demo modules now consume CPQ via the public package
      surface — no in-repo coupling left.
- [x] Extend root `jest.config.cjs` `testMatch` to discover tests under
      `packages/*/src/**/__tests__/`. Without this, the 27 CPQ test files
      moved with `git mv` were silently skipped.
- [x] `yarn install && yarn workspace @dainamite/cpq build && yarn generate && yarn typecheck && yarn test` — all green (26 suites, 531 tests).
- [ ] Smoke-test backend: `yarn dev`, list/create offering, run a quote
      wizard, check ARC subscription detail page. **(manual, blocks merge)**

### Phase 2 — Audit & lint cross-package coupling (XD-270, 2026-05-09)

- [x] Grep for `@ManyToOne`, `@OneToMany`, `@ManyToMany`, `@OneToOne` —
      zero violations (CPQ already uses FK string columns).
- [x] Grep for cross-module imports (`@/modules/<x>`, `src/modules/<x>`,
      relative escapes) — zero violations.
- [x] Audit deep imports into `@open-mercato/core/modules/<x>` — found
      `auth` and `directory` usages not declared in `metadata.requires`.
      Fix: extended [`packages/cpq/src/modules/cpq/index.ts`](src/modules/cpq/index.ts)
      `requires` to `['auth', 'directory', 'catalog', 'sales', 'customers', 'dictionaries']`.
- [x] Audit external deps used by package — found `bcryptjs` imported in
      `lib/seeds/tenant-provisioning.ts` but missing from `peerDependencies`.
      Fix: added `bcryptjs ^3.0.0` to `peerDependencies`. Also added
      `lucide-react ^0.400.0` (used by sidebar icons in `backend/**/page.meta.ts`).
- [x] Add guard test:
      [`packages/cpq/src/modules/cpq/__tests__/package-isolation.test.ts`](src/modules/cpq/__tests__/package-isolation.test.ts) —
      static analysis of every `.ts`/`.tsx` in the package, asserting:
      no forbidden cross-module imports; only allowed import prefixes
      (mirroring `peerDependencies`); deep core imports declared in
      `requires`; zero ORM relations; module index loads cleanly. Future
      regressions caught by CI.
- [x] Removed `@open-mercato/core` patch (nav sidebar order tweak) — was
      cosmetic; not worth the upstream-PR cost.

### Phase 3 — Publish (XD-270, 2026-05-09)

- [x] Flip `private: true` → `false` in `packages/cpq/package.json`.
- [x] Install + init `@changesets/cli` — config in `.changeset/config.json`
      with `access: restricted` → later switched to `public`,
      `baseBranch: main`, `dainamite-core` automatically skipped (private workspace).
- [x] First changeset: `.changeset/initial-release.md` for
      `@dainamite/cpq` initial release.
- [x] CI release workflow at `.github/workflows/release.yml` —
      on push to `main`, runs `changesets/action@v1` which either opens a
      "Version Packages" PR (when changesets exist) or runs
      `yarn changeset publish` (when version PR is merged).
- [x] **Switched publish target from GitHub Packages → public npm.js.**
      First publish attempts as `@dainamite/cpq` on GitHub Packages failed
      with `403 Forbidden — installation does not exist`: scope `@dainamite`
      on GitHub belongs to a different (unrelated) "DAInamite" organization
      based in Berlin (dainamite.de). Switching to public npm.js, where the
      `@dainamite` scope is free, lets us keep the brand without renaming
      everything to `@dainamite-technologies/cpq`. Open Mercato itself
      publishes to npm.js (`@open-mercato/core` etc.) so this is also more
      consistent with the upstream ecosystem.
- [ ] **Manual / first-time setup before merge to main:**
      - **npm.js account + org** — sign up at https://www.npmjs.com/signup
        if needed, then create the `dainamite` org at
        https://www.npmjs.com/org/create (Free plan — public packages only,
        which is fine since CPQ is public).
      - **`NPM_TOKEN` secret** — at https://www.npmjs.com/settings/<your-username>/tokens
        click "Generate New Token" → type `Automation` → Add as repo secret
        named `NPM_TOKEN`.
      - **`RELEASE_TOKEN` PAT** — required for "Version Packages" PRs to
        trigger CI automatically. Without it, you must push an empty
        commit to `changeset-release/main` each release to trigger CI
        (the default `GITHUB_TOKEN` cannot trigger workflows on PRs it
        opens, anti-recursion safety). Setup:
        1. Settings → Developer settings → Personal access tokens →
           Tokens (classic) → Generate new (classic)
        2. Scope: `repo` (full)
        3. Expiration: 90+ days, set a calendar reminder to rotate
        4. Repo settings → Secrets and variables → Actions → New
           repository secret → name `RELEASE_TOKEN`, value the PAT
      - **License decision** — `packages/cpq/package.json` still has
        `"license": "UNLICENSED"` from when the package was private.
        For a public npm package pick a real OSI license (MIT recommended
        for ecosystem consistency with `@open-mercato/*`) and update
        before merging.
- [ ] **First publish flow** (after this branch lands on main):
      1. Push to main triggers release workflow.
      2. Workflow sees pending changesets and opens a
         "Version Packages" PR that bumps `@dainamite/cpq` and writes
         `packages/cpq/CHANGELOG.md`.
      3. Merge that PR → release workflow re-runs, this time runs
         `yarn changeset publish` → `@dainamite/cpq` lands on
         https://www.npmjs.com/package/@dainamite/cpq.
- [ ] Update SPEC-001 changelog.

> **Note:** SPEC-001 references a future `dainamite-product/` repo as a
> Phase 4 destination. **That plan is dropped** — `dainamite-core` IS the
> Dainamite product monorepo, and `packages/cpq/` (plus any future
> `@dainamite/*` packages) stay here permanently. Other customer apps
> install from npm.js with no auth setup needed (public package).

## Risks (carried from SPEC-001)

| Risk | Mitigation |
|---|---|
| Cross-package ORM relations leak in | Lint rule + isolation bootstrap test |
| Two CPQ instances in `node_modules` | `peerDependencies` only, narrow ranges |
| Breaking schema migration on customer DB | Migrations ship in package, document upgrade in CHANGELOG |
| Custom @app code drifts from package | Audit every 6 months, promote duplicated features into the package |

## Schema / API changelog (track breaking changes here)

### 2026-05-04 — XD-250 ARC (Amend / Renew / Cancel)

Additive only. Every existing CPQ contract is preserved.

**New entities** (require migration):
- `cpq_quote_target_subscriptions` — junction quote ↔ subscription target
- `cpq_subscription_change_logs` — append-only audit per ARC operation

**New columns on existing entities** (additive, default-safe):
- `cpq_quote_configurations`: `quote_type` (default `'new'`), `arc_reason_*`,
  `arc_etf_*`, `arc_merge_new_term_*`, `arc_merge_new_sub_*`
- `cpq_quote_line_configurations`: `target_subscription_id`,
  `source_subscription_item_id`
- `cpq_inventory_subscriptions`: `current_term_start`,
  `merged_into_subscription_id`, `last_change_log_id`,
  `version` (MikroORM optimistic lock)

**Status enum extensions**:
- `INVENTORY_SUBSCRIPTION_STATUSES` adds `'superseded'` (terminal,
  reachable only via merge-renewal — sources transition there).
- Subscription items mirror parent via the same `'superseded'` status.

**New events** in `cpq.events.ts` (NEW file — first events for the module):
- `cpq.subscription.amended`
- `cpq.subscription.renewed`
- `cpq.subscription.merged`
- `cpq.subscription.cancelled`
- `cpq.subscription.superseded`

All five include a `proration` payload + ChangeLog id, persistent +
`clientBroadcast: true`.

**New API endpoints** (all under `src/modules/cpq/api/`):
- `POST /api/cpq/quotes/from-subscription`
- `GET / POST /api/cpq/quotes/[quoteId]/target-subscriptions`
- `PATCH / DELETE /api/cpq/quotes/[quoteId]/target-subscriptions/[targetId]`
- `POST /api/cpq/quotes/[quoteId]/cancel-meta`
- `POST /api/cpq/quotes/[quoteId]/merge-meta`
- `PATCH /api/cpq/quotes/[quoteId]` — extended to accept `quoteType`
  (one-way `new → amend|renew|cancel`)
- `GET /api/cpq/inventory/subscriptions/[subscriptionId]/change-log`
- `GET /api/cpq/inventory/subscriptions/expiring`

**New ACL features** (in `acl.ts`, granted to admin + employee in `setup.ts`):
- `cpq.arc.amend.manage`
- `cpq.arc.renew.manage`
- `cpq.arc.cancel.manage`
- `cpq.arc.changelog.view`
- `cpq.inventory.expiring.view`

**Service surface additions** (no new top-level services — methods on existing):
- `cpqInventoryService.applyAmendment / applyRenewal / applyMergeRenewal /
  applyCancel` — idempotent on `(sourceOrderId, subscriptionId)`.
- `cpqInventoryService.findExpiringSubscriptions / listChangeLog`.
- `cpqQuotingService.createQuoteFromSubscription / setQuoteType /
  attachTargetSubscription / detachTargetSubscription /
  updateTargetSubscription / setCancelMeta / setMergeMeta /
  validateArcQuote`.
- `cpqOrderService.activateOrder` — extended to branch on `quoteType` and
  invoke the right `apply*` per attached target. Events emit AFTER commit.

**Backwards compatibility**: existing `quote_type='new'` quotes flow through
the unchanged path. `autoRenew` column on subscriptions is preserved but no
longer consulted (no scheduler).

## Open decisions (per SPEC-001 §Open Questions)

- Q3 — Monorepo tooling: yarn workspaces alone vs Nx/Turborepo. Default to
  workspaces; revisit at >15 packages.
- Q5 — Licensing model (per-package vs per-tenant). **Deferred.**
- Q6 — Customer repo commit access (us only vs customer too). **Deferred.**
