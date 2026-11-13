# Architect checkpoint #2 — CPQ Cost-Plus Pricing (§6 story mapping, §7 phasing)

Execution: fresh-context subagent with the App Spec, commit plan, both catalogs and cited sources (framework read from `@open-mercato/core` 0.9.0 in another install). 2026-11-11.

| Tag | Finding | Re-mapping applied |
|---|---|---|
| OK | §4 = §6 = commit plan = 42; per-phase split reconciled | — |
| OK → grounded | Toggle override UI exists (`CORE/feature_toggles/backend/feature-toggles/overrides/page.tsx`); CPQ precedent `adjustmentService.ts:57` | U1 closed; removed from docs-only list |
| OK → grounded | `runCpqMutationGuards` on status + conversion (`P/api/_helpers/quoteMutationGuard.ts:13-37`) | cited in §4 / §6 |
| MISSED | US-4.4 "the guard still blocks" with no guard commit / no stored approved hash | Failure path rewritten: project-registered guard (manual recipe), approved hash in the workflow context; CPQ ships none |
| ESTIMATE | FX `getRate` defaults `autoFetch: true`, `maxDaysBack: 30`, multiple providers, `actualDate` | R3: `autoFetch: false`, 7-day look-back, `actualDate` stored, provider rule |
| ESTIMATE | #8 overloaded with Phase 2 / 3 concerns | R1b request cancellation → #22 (Phase 2); R1c skip stays in #8; Renew reconciliation in #30 |
| ESTIMATE | #11 write API realistically 2 commits | +1 (#11b) |
| MISSED | US-1.1 success line contradicted R15 / I-4 | Already fixed after challenger #2 |
| OVERENGINEERED | Toggle-off warning needs an injection spot the platform page lacks | Replaced by `GET /api/cpq/cost-plus/usage` + manual |
| OVERENGINEERED | Q-D13 re-confirmation in Phase 2 is rare | Moved to Phase 3; Phase 2 returns `409 QUOTE_CONVERTED` |
| PHASING | Phase 1 referenced Phase 2 states / actions (requested demo state, Request cost, open-request cancel) | Phase-tagged in US-0.2, US-2.5, US-4.2 |
| PHASING | #28 mis-attributed to US-4.4; approval recipe seeded in Phase 1 (#21) → docs-only affects Phase 1 | Attribution moved to US-3.1; U2 covers Phases 1 and 2 |

Net: 42 → 43 (Phase 1: 25, Phase 2: 7, Phase 3: 7, Phase 4: 4).
