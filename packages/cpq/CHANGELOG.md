# @dainamite/cpq

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
