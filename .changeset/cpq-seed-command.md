---
"@dainamite/cpq": minor
---

Add `mercato cpq seed` — a one-command loader for a minimal, neutral CPQ test catalog (a configurable product with a Specification, an Offering, and a fixed monthly charge) into a single tenant.

- **Idempotent**: every row is matched by a stable `DEMO-CPQ-*` code/sku, so re-running is a no-op rather than a duplicate. The charge find-or-create keys on `(offering_id, code)` to match the DB uniqueness constraint.
- **Scope**: resolves the primary organization created by `mercato init` when no `--tenant`/`--org` flag is given.
- **`--reset`**: clears the seed's own rows before re-seeding.

The seed is intentionally generic so it ships with the package; rich, vertical demo catalogs continue to live in app-level `demo_<x>` modules + `mercato demo_tenants seed`. Pairs with `mercato billing seed` (`@dainamite/billing`) and the consumer-side `yarn dainamite-cpq-test` / `yarn dainamite-test` aliases.
