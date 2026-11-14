# Notify — 2026-11-14-cpq-cost-plus-order-subscription-costs

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-14T09:59:15Z — run started
- Brief: implement .ai/specs/2026-11-12-cpq-cost-plus-order-subscription-costs.md (App Spec cost-plus, feature 2 of 6), stacked on PR #93.
- Decision: one implementation PR for the whole spec (its internal PR 1 / PR 2 split folded in), like feature 1.
- Decision: no DB / browser available — migrations generated DB-less; Playwright specs written and run by CI.
- 2026-11-14 review1-a: ARC activation now links order line costs to the inventory costs they create/update (links returned via applyAmendment/applyRenewal/applyMergeRenewal).
