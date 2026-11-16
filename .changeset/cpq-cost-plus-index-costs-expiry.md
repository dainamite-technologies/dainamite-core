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

Index cost elements (Phase B: engine): a cost-plus charge can take its cost from an index.

- Migration `Migration20261116060621` adds `cost_index_id`, `index_factor` and `index_offset`
  to `cpq_charge_cost_elements` (partial index and CHECKs); run `yarn mercato db migrate`.
- `POST|PUT /api/cpq/charge-cost-elements` accept `source: 'index'` with `costIndexId`,
  `indexFactor` (> 0, default 1), `indexOffset` (>= 0, default 0); new error codes
  `INDEX_REQUIRED`, `INDEX_INACTIVE`, `INDEX_FIELDS_NOT_ALLOWED`, and the cost-line error
  `INDEX_NO_VALUE`.
- Saved recalculations of unlocked quotes re-price from the value in force today and store an
  `index_snapshot`; sent (locked) quotes never move. ARC Renew re-evaluates carried index
  costs. Calculate-price and cost preview resolve at today's value and expose no index data.
- Index value, factor, offset and snapshot are `cpq.costs.view` data only.
