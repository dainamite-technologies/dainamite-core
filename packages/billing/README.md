# @dainamite/billing

Lightweight recurring-billing engine for Open Mercato applications.

Collects items to charge (`one_time`, `recurring`, `usage`), runs a scheduled
**Bill Run** that calculates totals and produces **draft invoices** in
`@open-mercato/core/sales`, and waits for human approval before posting. It
does **not** replace your accounting system — it prepares billing data and
hands drafts to a human.

## Status

**Built — publishing soon.** Schema, ACL, tenant setup, the Bill Run engine,
usage rating, the full admin UI, and the `@dainamite/cpq-billing-connector`
companion are all in place. The package is not yet on npm; until it publishes
it is available inside the `dainamite-core` monorepo.

See [`specs/implementation/xd-249-billing-spec.md`](../../specs/implementation/xd-249-billing-spec.md)
for the full implementation plan.

## What's inside

- **Billing Items** — the charge backlog (`one_time`, `recurring`, `usage`),
  each scoped to a Billing Account with a bill start/end window.
- **Bill Runs** — a background worker (`@open-mercato/queue`) that, on a
  schedule or on demand, rates usage, sums the due items for the period, and
  writes **draft invoices into `@open-mercato/core/sales`**. Runs are
  idempotent and tenant-locked; stale runs are reaped by a worker.
- **Draft invoice approval** — invoices land in `draft`; a human reviews and
  **posts** them (a guarded ACL action) before they leave draft.
- **Usage rating** — metered items are rated at run time from ingested usage.
- **Admin UI** under `/backend/billing/*` — Accounts, Items, Bill Runs,
  Invoices (list + detail pages).
- **Commands** for every write (accounts / items / runs / invoices / usage),
  validated with Zod.

## Installation

`@dainamite/billing` is an Open Mercato module. Install it and register it in
your host app's `src/modules.ts`:

```bash
yarn mercato module add @dainamite/billing   # installs + registers in one step
# …or: yarn add @dainamite/billing  then add { id: 'billing', from: '@dainamite/billing' }
```

```bash
yarn generate
yarn mercato db migrate
```

### Required Open Mercato modules

`sales` (draft invoices are written there), `@open-mercato/queue` (Bill Run
worker), and `@open-mercato/events` (lifecycle events consumed by the
connector). Engines: **Node ≥ 24**.

## CPQ integration

To bill subscriptions sold through CPQ, add
[`@dainamite/cpq-billing-connector`](../cpq-billing-connector) — it subscribes
to CPQ subscription lifecycle events and creates/updates Billing Accounts and
Items automatically. Register it **after** both `cpq` and `billing`.

## Distribution rules (per SPEC-001)

- **`peerDependencies`, never `dependencies`** for `@open-mercato/*` and
  sibling `@dainamite/*` — one shared instance in `node_modules`.
- **No ORM relations across packages** — cross-module references are FK
  strings; draft invoices are created through the sales service / events, not
  a direct relation.
- **Ships its own migrations** under `src/modules/billing/migrations/`.
- Ships `src/` (types) + `dist/` (runtime JS); no `.d.ts` emitted.

## License

MIT.
