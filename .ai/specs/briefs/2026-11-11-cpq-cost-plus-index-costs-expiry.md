# Index-linked costs (e.g. oil) and supplier-cost expiry warnings

- Date: 2026-11-11
- Category: feature
- Priority signal: medium — §7 Phase 4; the user's case 3 (variable cost)
- Risk signal: low — reference data with append-only revisions; scheduler grounded-elsewhere
- Routing: om-spec-writing "Index-linked costs (e.g. oil) and supplier-cost expiry warnings — brief: .ai/specs/briefs/2026-11-11-cpq-cost-plus-index-costs-expiry.md"
- App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md — sections §1.3 (cost index, index value in force), §1.4.5, R4, R13 (Renew re-evaluation), events (`cost_expiring`, notification `cpq.cost.expiring`), §5 (US-1.4, US-3.6), §7 Phase 4, Q-D9, Q-D15
- Depends on: the quote pricing and margin feature (and the sourcing feature for expiry warnings)

## Problem

Fuel- and energy-linked costs move with market indices. Until this feature they are `fixed` costs that the pricing admin updates by hand, and supplier quotes expire without warning.

## Agreed direction

- Commits #35–#38:
  - `CpqCostIndex` / `CpqCostIndexValue`: append-only values, server-assigned revisions, value > 0; future values are allowed but unused before their date.
  - Import API, plus list and detail pages with an Add value form.
  - Engine `index` source: unit cost = value × factor + offset, in the index currency. The snapshot is taken on saved recalculation and frozen at lock (R4). Renew re-evaluates. `INDEX_NO_VALUE` when no value exists.
  - A scheduled `cost_expiring` command (`SchedulerService`), deduplicated by `(cost line, valid_until)` and catching up missed days, plus notification `cpq.cost.expiring` to cost managers.
- **Rejected:** storing indices in the currencies module (it handles currency rates only); a `data_sync` adapter (project-level); revaluing live item costs (Q-D9).

## Resolved unknowns

| Question | Answer |
|----------|--------|
| Live item revaluation | No, frozen until the next ARC (Q-D9) |
| Negative index values | Rejected in v1; deferred (Q-D15) |
| Deleting / deactivating a referenced index | Refused |
| Acceptance criteria | §7 Phase 4 domain criteria + business criteria |

## Non-goals

- Customer-price indexation clauses; automatic market-data feeds (a project integration can call the import API).

## Affected areas (if known)

- `packages/cpq/src/modules/cpq/`: entities, migrations, `api/cost-indices/**` (new), `backend/cpq/cost-indices/**` (new), `services/cpqPricingService.ts`, scheduler registration, `notifications.ts`; GIX demo index.
