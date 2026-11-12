# Phase 4 — role-reversal acceptance criteria, CPQ Cost-Plus Pricing

Execution: fresh-context DDD subagent wrote the domain criteria per phase (2026-11-11); the PM challenged them. The final criteria and the PM's challenges live in App Spec §7.

PM challenge outcomes:
- Phase 1: all accepted (golden I-8, property R2, leak sweep I-4, billing byte-identity I-9).
- Phase 2: "at most one open request" — the lock-path assertion is the phase gate; a DB partial unique index is deferred to the feature spec.
- Phase 3: all accepted (parallel-Amend, forward-compatibility of Phase-1 Renews).
- Phase 4: "index value ≤ 0 rejected" accepted for v1; negative-price indices logged as Q-D15.

DDD's essential list (defended, none cut): I-8, I-4 (incl. audit / undo / search / export), I-5, I-6, I-13, I-10, I-12, I-9, R4.

The Phase 4 challenger run on the phasing itself is recorded below once it completes.

## Final challenger (phasing + whole-document consistency), 2026-11-11

Execution: fresh-context subagent over the full App Spec.

| Severity | Finding | Disposition |
|---|---|---|
| CRITICAL | I-5 / R11 / §1.3 / §8 lacked the Q-D13 post-conversion exemption | FIXED |
| CRITICAL | US-1.6 (Phase 1) showed the Phase 2 Cost requests menu | FIXED — phase-tagged |
| CRITICAL | "quantity rule" leftovers | FIXED → cost model |
| CRITICAL | toggle-off warning leftover | FIXED — removed |
| CRITICAL | stale status line / changelog / gate header | FIXED |
| WARNING | §7 intro rationale; missing Phase 1 criteria for R14, R4 tables, R1b value part | FIXED — criteria added, R1b split across phases |
| WARNING | Phase-2 behaviour unmarked in Phase 1 stories; `requires_sourcing` / FX before Phase 2 | FIXED |
| WARNING | ROI metrics true-by-construction or unmeasurable | FIXED — redefined |
| WARNING | Expiry filter / notification undefined; `item_cost_changed` "When"; CF block vs R14 exceptions; action name drift; ACL request under view; demo product name; MRC in Renew criterion | FIXED |
