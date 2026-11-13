# Challenger — Phase 1 (§3 Workflows, §3.5 UI), CPQ Cost-Plus Pricing

Execution: fresh-context subagent, 2026-11-11. Inputs: App Spec §3, §3.5 with §1.3 / §1.4 as reference.

| Severity | Finding | Disposition |
|---|---|---|
| CRITICAL | Margin approval survives lock-exempt margin drops (keyed on pricing hash) | FIXED — `margin_hash`, `margin_changed.approvalInvalidated`, R8 |
| CRITICAL | Declined tail deadlocks the line (manual cost is a second line) | FIXED — R10a: alternative value on the same cost line; WF3 end condition |
| CRITICAL | Phase 1–2 ARC workaround leaves stale item costs | FIXED — minimal activation write-back in Phase 1 (+1 commit) |
| CRITICAL | Pricing admin lacks `cpq.costs.view` for WF1 | FIXED — §1.4.10, §2 |
| CRITICAL | Subscription / order cost sections shown to roles without `cpq.costs.view`; "order manager" missing in §2 | FIXED — gating stated, persona added |
| WARNING | WF2/WF3/WF4 boundaries overlap; WF4 end technical | FIXED — WF4 as WF2 review sub-flow with business end |
| WARNING | Cost-only amend forces customer acceptance | FIXED — internal: `ready → accepted` by operator |
| WARNING | I-3 false on frozen mirrors / re-confirmations | FIXED — exceptions stated |
| WARNING | Rep never notified of answers | FIXED — notification types (Phase 2) |
| WARNING | Retyping `proposedAmount` loses supplier origin | FIXED — "Apply supplier answer" action |
| WARNING | Validity extension bypasses I-6 | FIXED — evidence required |
| WARNING | WF1 end / cost-guarded preview; last price-basis element deactivation | FIXED |
| WARNING | Item margin undefined | FIXED — WF5 item margin |
| WARNING | Detail page keyed on cost line; cost elements no detail page; click counts | FIXED — page dropped (architect #1), child-entity exception, flows re-routed ≤ 3 |
| WARNING | Unmeasurable ROI WF4 / WF6 | FIXED — coverage target, effective-dated recording target |
