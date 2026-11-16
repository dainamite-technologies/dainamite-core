---
"@dainamite/cpq": minor
---

Cost indices for cost-plus pricing (Phase A: catalogue): dated, revisioned index values with list and detail pages.

- Migration `Migration20261116054402` adds `cpq_cost_indices` and `cpq_cost_index_values`
  (append-only values, `value > 0`, unique `(cost_index_id, effective_date, revision)`);
  run `yarn mercato db migrate`.
- New routes: `GET|POST /api/cpq/cost-indices`, `GET|PATCH|DELETE /api/cpq/cost-indices/{indexId}`,
  `GET|POST /api/cpq/cost-indices/{indexId}/values`, `POST /api/cpq/cost-indices/import`
  (dry run supported). Read needs `cpq.pricing.view` + `cpq.costs.view`; write needs
  `cpq.pricing.manage` + `cpq.costs.view`. All answer 404 while `cpq.cost_plus` is off.
- New error codes: `INDEX_IN_USE`, `INDEX_CURRENCY_LOCKED`, `CODE_IMMUTABLE`, `DUPLICATE_CODE`,
  `UNKNOWN_CURRENCY`, `INDEX_INACTIVE`, `CONCURRENT_INDEX_WRITE`, `IMPORT_VALIDATION_FAILED`.
- New pages: Cost indices list and detail (Add value, Import CSV, Used by), read-only without
  `cpq.pricing.manage`.
- No pricing change yet: the `index` cost source is wired in a later phase.
