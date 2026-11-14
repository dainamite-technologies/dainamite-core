# Capability: cpq-subscription-history

What the subscription change log records about inventory costs and who may read it.

## Requirement: Inventory costs in change-log snapshots
The system SHALL include in every change-log `before_snapshot` / `after_snapshot` item and asset that owns inventory costs a `costs` array with each cost's id, `cost_key`, name, role, cost type, charge code, status, value status, amounts, currency, FX, supplier, supplier quote ref, validity, supplier term, `started_at` and `ended_at`. Items and assets that own no cost SHALL have no `costs` key.

### Scenario: Created row
- WHEN a new sale with a 270 EUR tail cost is activated
- THEN the `created` change-log row's `after_snapshot` item carries `costs: [{ costKey: 'tail', unitAmount: '270.0000', status: 'active', … }]`

### Scenario: Uncosted subscription
- WHEN a subscription without item costs is amended
- THEN its `before_snapshot` and `after_snapshot` are byte-identical to the snapshots produced before this change

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqInventoryService.arc.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md

## Requirement: Change-log cost redaction
The system SHALL remove every `items[].costs` and `assets[].costs` key from change-log snapshots returned to users without `cpq.costs.view`, or while the toggle is off, and SHALL otherwise return the change log unchanged.

### Scenario: Rep without cost access
- WHEN a user with `cpq.arc.changelog.view` but not `cpq.costs.view` lists the change log of a costed subscription
- THEN the rows, snapshots and line changes are returned without any `costs` key

Frozen by: `packages/cpq/src/modules/cpq/services/costs/__tests__/stripSnapshotCosts.test.ts`

Source: .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md
