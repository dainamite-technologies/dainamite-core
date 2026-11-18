# Checkpoint 1 — Steps A.1–C.9 verified; Phases A–C closed

- **Checkpoint:** 1
- **Steps covered:** 1 c9b9595, 2 1506682, 3 38def29, 4 38666f9, 5 d7aa99d, 6 af00b5a, 7 6a23c20, 8 72174c4, 9 a21bf07
- **Recorded:** 2026-11-15
- **Touched areas:** `packages/cpq` — FX settings (`fx_max_days_back`, `fx_source_priority`); `CpqFxRateResolver` over a structural `exchangeRateService` (`autoFetch: false`, direct then inverse, 8 dp, `currencies` optional); FX snapshot columns on quote / order line / inventory costs (Migration20261115100403, Migration20261115102552); engine snapshot policy (save + unlocked → resolve and store; locked / ordered / save=false / carried + mirror snapshot → reuse or in memory), Q13 status on rate arrival, conversion at summing; foreign-currency manual writes and supplier answers; FX read projection for holders + `errorDetail`; usage `missingFxPairs` (raw grouped SQL); carry-through with `total_amount` in the document currency.

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn generate` / CPQ build / `yarn typecheck` | ✅ pass | |
| `yarn test` (full) | ✅ pass | 166 suites, 2615 tests; pricing golden + subscription event payload golden byte-identical; margin hash unchanged for quotes without FX (Q15) |
| CI on a21bf07 (manual dispatch) | ✅ pass | 2615 unit; 65 integration passed, 1 skipped (fixme from PR #95); both FX migrations applied; raw `missingFxPairs` SQL ran on Postgres |
| Review of Steps 1–9 | ✅ 1 cross-feature requirement enforced | order / inventory `total_amount` must be in the document currency (feature 2 Q3) — specified for step 9 and implemented (order margin = quote margin for a USD cost) |

## Decisions accepted

- Quote cost `unit_amount` / `instance_amount` stay in the cost currency; `fx_rate` applies at summing (list price, margin, order / inventory `total_amount`).
- Resolver: `same_currency` reason; a direct-pair throw → `error` without trying the inverse; non-positive rates → `not_found`.
- Q13: a `none` + `CURRENCY_NO_RATE` row becomes `estimated` when a rate arrives (a supplier answer's original status is not stored).
- `error` stays a string code; `errorDetail {code, from, to, date}` added (spec object form would break `CostsPanel`).
- Costed change-log snapshots always carry the four fx keys (null when unset); uncosted snapshots unchanged.
