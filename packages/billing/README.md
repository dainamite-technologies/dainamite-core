# @dainamite/billing

Lightweight recurring-billing engine for Open Mercato applications.

Collects items to charge (`one_time`, `recurring`, `usage`), runs a scheduled
**Bill Run** that calculates totals and produces **draft invoices** in
`@open-mercato/core/sales`, and waits for human approval before posting.

## Status

**Phase 0 — Scaffold.** Module schema, ACL, and tenant setup are in place.
REST API, Bill Run engine, usage rating, admin UI, and the
`@dainamite/cpq-billing-connector` companion package land in later phases.

See [`specs/implementation/xd-249-billing-spec.md`](../../specs/implementation/xd-249-billing-spec.md)
for the full implementation plan.

## Installation

```bash
yarn mercato module add @dainamite/billing
yarn mercato db migrate
```

## License

MIT
