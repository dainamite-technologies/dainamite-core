# Notify — 2026-11-14-cpq-cost-plus-order-subscription-costs

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-14T09:59:15Z — run started
- Brief: implement .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md (App Spec cost-plus, feature 2 of 6), stacked on PR #93.
- Decision: one implementation PR for the whole spec (its internal PR 1 / PR 2 split folded in), like feature 1.
- Decision: no DB / browser available — migrations generated DB-less; Playwright specs written and run by CI.
- 2026-11-14 review1-a: ARC activation now links order line costs to the inventory costs they create/update (links returned via applyAmendment/applyRenewal/applyMergeRenewal).
- 2026-11-14 review1-b: scope decision (spec Q5 + R14): replace ends only open catalog item costs absent from seeds (manual costs kept); with cpq.cost_plus off at activation a reconfigured mirror line is upsert-only (ends nothing). Toggle read once per ARC activation via optional cpqCostService.
- 2026-11-14 review1-c: order margin now uses the quote margin's line predicate (isArcMirrorLine on the source quote type; termination-line costs excluded).
