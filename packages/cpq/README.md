# @dainamite/cpq

Dainamite **CPQ** (Configure, Price, Quote) module for Open Mercato —
configurable product attributes, multi-charge pricing tables, guided
quoting wizards, customer inventory & subscription tracking, ARC
(Amend / Renew / Cancel) flows, quote → order → activation pipeline.

## Install

Requires access to the `@dainamite` GitHub Packages scope. Configure
`.npmrc` to point `@dainamite` at `https://npm.pkg.github.com`, then:

```sh
yarn add @dainamite/cpq
```

Register the module in your host app's `src/modules.ts`:

```ts
{ id: 'cpq', from: '@dainamite/cpq' }
```

Run framework migrations to install CPQ's schema:

```sh
yarn mercato db migrate
```

## What's inside

```
packages/cpq/src/modules/cpq/
├── index.ts        module metadata + requires
├── acl.ts          ACL feature definitions
├── ce.ts           custom entity / field set declarations
├── di.ts           Awilix DI registrations
├── setup.ts        tenant init, role features, seed data
├── data/           entities, validators, enrichers
├── api/            REST routes (resource-style: api/<resource>/route.ts)
├── backend/        admin UI pages (auto-discovered)
├── services/       pricing, quoting, validation, product, wizard, inventory, order, bundle
├── widgets/        injection: customer-inventory, order-cpq-tab, quote-configurator
├── workflows/      quote → order step components
├── lib/seeds/      use-case registry API
└── migrations/     own MikroORM migrations (never hand-write — `yarn mercato db generate`)
```

The package ships `src/` (for TypeScript consumers' types) and
`dist/` (esbuild-built JS for runtime). Following the
[`@open-mercato/core`](https://www.npmjs.com/package/@open-mercato/core)
build convention, no `.d.ts` is emitted — `exports.types` resolves
directly to source.

## Distribution model (per SPEC-001)

- **L1** — Open Mercato core consumed from `@open-mercato/*` (npm).
- **L2** — Dainamite product modules (this package + sibling
  `@dainamite/*`), published to **GitHub Packages** under the
  `@dainamite` scope.
- **L3** — `dainamite-core` is the first L3 customer app; other customer
  repos consume `@dainamite/cpq` via `yarn add` and register it the same
  way.

## Hard rules (carried over from SPEC-001)

- **No ORM relations across packages.** Cross-module references are FK
  strings only (`productId: string`), never `@ManyToOne`.
- **`peerDependencies`, never `dependencies`** for sibling
  `@dainamite/*` and `@open-mercato/*` — guarantees a single shared
  instance in `node_modules`.
- **Each major bump ships its own migrations** under
  `src/modules/cpq/migrations/`; document upgrade path in
  `CHANGELOG.md`.
- **No customer-specific logic here.** Tenant-specific overrides live
  in the consuming app under `src/modules/@app/<feature>/`.

## Required Open Mercato modules

CPQ declares the following in `metadata.requires` and will fail to
bootstrap if any are missing from the host app's `src/modules.ts`:

`auth`, `directory`, `catalog`, `sales`, `customers`, `dictionaries`.

## Package isolation guard

Static lint test at
[`src/modules/cpq/__tests__/package-isolation.test.ts`](src/modules/cpq/__tests__/package-isolation.test.ts)
asserts the package never imports from sibling app modules, never
deep-imports `@open-mercato/core/modules/<x>` for an undeclared
dependency, and contains zero cross-entity ORM relations. Runs on
every CI build — protects future contributors from accidentally
breaking the package boundary.

## Versioning

Versioned via [changesets](https://github.com/changesets/changesets).
Add a changeset alongside any change in `packages/cpq/`:

```sh
yarn changeset
```

Bumps and the GitHub Packages publish are handled by the release
workflow on push to `main`.

## License

Proprietary — internal Dainamite use only.
