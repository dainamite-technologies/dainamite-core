# Notify — 2026-11-14-cpq-cost-plus-supplier-sourcing

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-14T19:13:56Z — run started
- Brief: implement .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md (App Spec cost-plus, feature 3 of 6), stacked on PR #94.
- Decision: one implementation PR for the whole spec (its internal PR A / PR B split folded in), like features 1–2.
- Decision: no DB / browser available — migrations generated DB-less; Playwright specs written here and run by CI (manual dispatch).

## 2026-11-14T19:28:13Z — 4-review-fix
- Margin-only costs are lock-exempt in the sourcing rules (App Spec R11 cost lock: "Exempt: margin-only costs"): on a locked quote a different-value answer is applied (not a proposal that would block conversion with COST_ANSWER_PENDING), and a decline follows the unlocked R10a rule. `classifyAnswer` / `declineEffect` take the cost role; a missing role is treated as price-basis. Steps 7–9 must pass `role`.
