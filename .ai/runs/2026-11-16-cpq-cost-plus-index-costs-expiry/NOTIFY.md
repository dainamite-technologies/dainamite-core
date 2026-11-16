# Notify — 2026-11-16-cpq-cost-plus-index-costs-expiry

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-16T05:42:45Z — run started
- Brief: implement .ai/specs/2026-11-12-cpq-cost-plus-index-costs-expiry.md (App Spec cost-plus, feature 6 of 6), stacked on PR #100.
- Decision: the spec's PR 1 / PR 2 (+2b) / PR 3 are folded into one PR; each phase keeps its close-out (sweep, smoke, migration notes, archive).

## 2026-11-16T07:30:00Z — step 12 scope decision
- Re-evaluation also patches `instance_amount` (derived from the new unit amount, x quantity for per_unit): the PR #100 seam allows it, and leaving it stale would break margin. `value_status`, flags and every other field are untouched.
