# @dainamite/cpq

## 0.3.0

### Minor Changes

- f111f9d: Add `mercato cpq seed` — a one-command loader for a minimal, neutral CPQ test catalog (a configurable product with a Specification, an Offering, and a fixed monthly charge) into a single tenant.

  - **Idempotent**: every row is matched by a stable `DEMO-CPQ-*` code/sku, so re-running is a no-op rather than a duplicate. The charge find-or-create keys on `(offering_id, code)` to match the DB uniqueness constraint.
  - **Scope**: resolves the primary organization created by `mercato init` when no `--tenant`/`--org` flag is given.
  - **`--reset`**: clears the seed's own rows before re-seeding.

  The seed is intentionally generic so it ships with the package; rich, vertical demo catalogs continue to live in app-level `demo_<x>` modules + `mercato demo_tenants seed`. Pairs with `mercato billing seed` (`@dainamite/billing`) and the consumer-side `yarn dainamite-cpq-test` / `yarn dainamite-test` aliases.

### Patch Changes

- 2261dfa: XD-289: ship `xlsx` as a runtime dependency so the pricing-table detail page works out of the box on fresh `create-mercato-app` scaffolds.

  `xlsx` was previously declared only in `peerDependencies` (alongside the rest of the React / MikroORM / `@open-mercato/*` peer set). That works in this monorepo because the root `package.json` already lists `xlsx`, but it broke for external consumers: installing `@dainamite/cpq` into a vanilla `create-mercato-app` project did not pull `xlsx` into `node_modules`, and the very first `yarn dev` after `yarn add @dainamite/cpq` crashed every page with

  ```
  Module not found: Can't resolve 'xlsx'
  > 1 | import * as XLSX from "xlsx";
      | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  @dainamite/cpq/dist/modules/cpq/backend/cpq/pricing/[id]/xlsxExport.js
  @dainamite/cpq/dist/modules/cpq/backend/cpq/pricing/[id]/xlsxImport.js
  ```

  (The pricing-table `[id]/page.tsx` statically imports both files, so Next.js
  bundles them for Client SSR and Client Browser regardless of which route the
  visitor actually opens — a single broken import takes down `/login` and the
  whole backend.)

  The peer-dependency rule from SPEC-001 ("never `dependencies` for sibling
  `@dainamite/*` / `@open-mercato/*`") exists to keep React, MikroORM, Next.js,
  and the rest of the framework as a single shared instance. `xlsx` is a
  CPQ-internal leaf library (used only by `pricing/[id]/xlsxExport.ts` and
  `xlsxImport.ts`); it has no decorator/context/hook contract that breaks under
  duplication, so promoting it to `dependencies` is safe and matches how leaf
  libs are normally distributed on npm.

  Consumers no longer need to `yarn add xlsx` after installing `@dainamite/cpq`.
  The package-isolation test (`__tests__/package-isolation.test.ts`) was updated
  in the same change so its allow-list comment mentions both `peerDependencies`
  and `dependencies` instead of just peers.

## 0.2.2

### Patch Changes

- 73650dc: Add MIT license for first public release.

  Switching `packages/cpq/package.json` `license` field from `UNLICENSED` (carry-over from the private era) to `MIT`, and shipping a `packages/cpq/LICENSE` file with the full license text. This matches the `@open-mercato/*` ecosystem and removes the "UNLICENSED" badge that public npm shows on packages without a recognized OSI license.

  No code or API changes — purely a licensing/metadata clarification ahead of the first publish to https://www.npmjs.com/package/@dainamite/cpq.

- 7b09790: Switch publish target from GitHub Packages to public npm.js.

  Initial publish attempts as `@dainamite/cpq` on GitHub Packages failed
  with `403 Forbidden — installation does not exist`: scope `@dainamite`
  on GitHub belongs to a different (unrelated) "DAInamite" organization
  based in Berlin. Switching to public npm.js, where the `@dainamite`
  scope is free, lets us keep the brand without renaming everything to
  `@dainamite-technologies/cpq`.

  Open Mercato itself publishes to public npm.js
  (`@open-mercato/core`, etc.), so this is also more consistent with the
  upstream ecosystem and matches the L2 model from SPEC-001.

  For consumers: install with plain `yarn add @dainamite/cpq` — no
  `.npmrc` auth setup needed.

## 0.2.1

### Patch Changes

- e44dfd1: Fix `repository.url` in package.json to point at
  `dainamite-technologies/dainamite-core` (was `dainamite/dainamite-core`).
  GitHub Packages requires the URL to match the publishing repo;
  mismatch returns `403 Forbidden — installation does not exist`.
  This blocked the inaugural publish of 0.2.0.

## 0.2.0

### Minor Changes

- 41c8b6d: Initial release of `@dainamite/cpq` as a standalone package.

  Configure-Price-Quote engine for Open Mercato: configurable product
  attributes, multi-charge pricing tables, guided quoting wizards,
  customer inventory & subscription tracking, ARC (Amend / Renew / Cancel)
  flows, quote → order → activation pipeline.

  This is the first release shipped from the dainamite-core monorepo as
  `@dainamite/cpq` on GitHub Packages. Source previously lived in
  `src/modules/cpq/` (in-tree, `from: '@app'`); now consumed via
  `peerDependencies` and registered as `{ id: 'cpq', from: '@dainamite/cpq' }`.

  Requires (peerDependencies): `@open-mercato/core ^0.5.0`,
  `@open-mercato/events ^0.5.0`, `@open-mercato/shared ^0.5.0`,
  `@open-mercato/ui ^0.5.0`, `@mikro-orm/core ^6.6.0`,
  `@mikro-orm/postgresql ^6.6.0`, `awilix ^12.0.0`, `next ^16.0.0`,
  `react ^19.0.0`, `react-dom ^19.0.0`, `zod ^4.0.0`, `bcryptjs ^3.0.0`,
  `lucide-react ^0.400.0`.

  Required Open Mercato modules (declared in `metadata.requires`):
  `auth`, `directory`, `catalog`, `sales`, `customers`, `dictionaries`.

### Patch Changes

- 8868606: Refresh README to reflect post-extraction state. Removes outdated
  "scaffold only" warning, documents install + register flow, lists
  required Open Mercato modules, and links to the package-isolation
  guard test.
