# @dainamite/cpq

Dainamite **CPQ** (Configure, Price, Quote) module for Open Mercato.

> **Status — scaffold only.** The runtime source of truth currently lives at
> [`src/modules/cpq/`](../../src/modules/cpq/) and is registered via
> `from: '@app'` in [`src/modules.ts`](../../src/modules.ts).
>
> This `packages/cpq/` directory is a placeholder for the eventual
> `@dainamite/cpq` npm package. See [MIGRATION.md](./MIGRATION.md) and the
> architectural spec at
> [`.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md`](../../.ai/specs/SPEC-001-2026-04-23-module-distribution-architecture.md)
> for the extraction plan.

## What's inside (eventually)

```
packages/cpq/
├── package.json        @dainamite/cpq
├── src/
│   └── modules/cpq/    ← physical home AFTER extraction (today: src/modules/cpq/)
│       ├── index.ts
│       ├── acl.ts
│       ├── ce.ts
│       ├── di.ts
│       ├── setup.ts
│       ├── data/       (entities, validators)
│       ├── api/        (REST routes)
│       ├── backend/    (admin UI)
│       ├── services/   (pricing, quoting, validation, product, wizard, inventory, order, bundle)
│       ├── widgets/    (injection: customer-inventory, order-cpq-tab, quote-configurator)
│       ├── workflows/  (quote → order steps)
│       ├── lib/seeds.ts
│       └── migrations/ (own MikroORM migrations — never hand-write)
├── dist/               build output (not committed)
└── MIGRATION.md
```

## Distribution model (per SPEC-001)

- **L1** — Open Mercato core consumed from `@open-mercato/*` (npm).
- **L2** — Dainamite product modules (this package + sibling `@dainamite/*`),
  published to **GitHub Packages** under the `@dainamite` scope.
- **L3** — `dainamite-core` is the first L3 customer app ("Demo Netia"); other
  customer repos consume `@dainamite/cpq` via `npm install` and register it
  with `{ id: 'cpq', from: '@dainamite/cpq' }` in their `src/modules.ts`.

## Hard rules (carried over from SPEC-001)

- **No ORM relations across packages.** Cross-module references are FK strings
  only (`productId: string`), never `@ManyToOne`.
- **`peerDependencies`, never `dependencies`** for sibling `@dainamite/*` and
  `@open-mercato/*` — guarantees a single shared instance in `node_modules`.
- **Each major bump ships its own migrations** under
  `src/modules/cpq/migrations/`; document upgrade path in `CHANGELOG.md`.
- **No customer-specific logic here.** Tenant-specific overrides live in the
  consuming app under `src/modules/@app/<feature>/`.

## Versioning

- Package version is independent of the host app version.
- Use **changesets** in the future product monorepo to coordinate bumps with
  sibling packages.

## License

Proprietary — internal Dainamite use only.
