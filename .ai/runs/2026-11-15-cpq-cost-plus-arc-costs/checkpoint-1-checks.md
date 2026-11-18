# Checkpoint 1 — Steps A.1–C.11 (+ 7-review-fix) verified; Phases A–C closed

- **Checkpoint:** 1
- **Steps covered:** 1 25504d3, 2 6ac785c, 3 88e658d, 4 93ead2b, 5 d50980d, 6 495e68e, 7 cef5ad1, 7-review-fix bf9b4c0, 8 29232a7, 9 496467f, 10 747aa57, 11 75ccc8f
- **Recorded:** 2026-11-15
- **Touched areas:** `lib/stateHash.ts`, `itemCostState.ts` (item cost state / set hashes incl. fx fields), `sourceQuoteLock.ts` (order row → source quote → subscriptions sorted), `COST_SOURCE_CHANGED` at conversion and activation, `carried` origin + `renegotiation_due` (Migration20261115151709 widens both CHECKs, partial index), carry on Amend mirrors (`arcCostCarry`), frozen-line lock rule (Q4) incl. sourcing answers, conversion link + carried write-back (full-image replace), cost-only Amend I-9, merge rule, Phase 1 forward compatibility.

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn generate` / CPQ build / `yarn typecheck` | ✅ pass | |
| `yarn test` (full) | ✅ pass | 174 suites, 2841 tests; pricing golden + I-9 payload golden byte-identical |
| CI on 75ccc8f (manual dispatch) | ✅ pass | unit + 66 integration (1 skipped fixme) on Postgres; `TC-CPQ-ARC-*` green; Migration20261115151709 applied |
| Review of Steps 1–11 | ✅ 1 fix | supplier answers / declines on frozen mirror lines now follow the Q4 lock rule (7-review-fix) |

## Decisions accepted

- Carried lines are `confirmed` (spec "Amend carries subscription item costs"); a formerly `estimated` margin-only item cost therefore emits `cost_changed` at activation.
- Carried lines sync as a full image (`replace` ends any open item cost missing from the seeds — catalog, manual or carried) regardless of the toggle; non-carried reconfigured lines keep PR #94 review1-b (catalog-only ends; upsert with the toggle off).
- A cancel line with a stale carried marker does not block (its costs end anyway).
- Step 13 must take the source-quote lock before reading the order row (no lock inversion with activation).
