# @dainamite/cpq

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
