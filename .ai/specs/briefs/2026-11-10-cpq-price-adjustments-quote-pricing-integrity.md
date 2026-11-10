# Harden CPQ quote pricing: recalculate permission, frozen Amend lines, mutation guards on quote routes

- Date: 2026-11-10
- Category: feature (hardening of existing behaviour)
- Priority signal: high — §7 Phase 1, prerequisite of `manual-adjustments`
- Risk signal: medium — changes ARC re-pricing behaviour and route permissions; mutation-guard API docs-only (U1)
- Routing: om-spec-writing "Harden CPQ quote pricing: recalculate permission, frozen Amend lines, mutation guards on quote routes — brief: .ai/specs/briefs/2026-11-10-cpq-price-adjustments-quote-pricing-integrity.md"
- App Spec: .ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md — sections §0 (C11, C12, C15), §1.4.5 (R7, R9 rollout rules), §1.4.8, §3 WF3 / WF4, §4 (WF1 integration row, WF3 frozen row, WF4 guard rows), §7 Phase 1

## Problem

Three existing defects would undermine negotiated prices: a user with only `cpq.quotes.view` can persist a recalculation, and accepted quotes can be re-priced (C11); Amend quotes re-price untouched items at today's standard and write the result to CPQ inventory (C12); no quote route calls a mutation guard or exports `openApi` (C15), so projects cannot enforce approvals.

## Agreed direction

- Recalculate route requires `cpq.quotes.manage` (the UI always saves) and refuses terminal statuses.
- Frozen Amend mirror lines (`_arcPriceFrozen`) keep the source item's stored charges until configuration / quantity / term / dates / usage estimates change.
- Mutation guards + `openApi` on status, items, recalculate and convert routes (verify the guard API against the installed framework first).
- Rejected: per-request feature checks inside the handler (CPQ route context loads no granted features).

## Resolved unknowns

| Question | Answer |
|---|---|
| Viewers recalculating without saving | Not used by any caller; viewers read stored prices via GET |
| Unfreeze rule | Submitted configuration differs from the stored one (deep-equal, ignoring `_arc*` markers), or quantity / `termMonths` / `startDate` / `endDate` / `usageEstimates` differ |
| Guard default | Pass-through when no project guard is registered |

## Non-goals

- Manual adjustments, events (sibling `manual-adjustments`); carry-over (`arc-continuity`).

## Affected areas (if known)

- `packages/cpq/src/modules/cpq/api/quotes/[quoteId]/{recalculate,status,items,items/[lineId]}/route.ts`, `api/orders/route.ts`, `services/cpqQuotingService.ts` (mirror + recalc), tests in `services/__tests__/cpqQuotingService.arc.test.ts`, `__integration__/`.
