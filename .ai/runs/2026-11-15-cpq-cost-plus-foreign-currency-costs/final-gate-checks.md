# Final gate — PR #96 (CPQ cost-plus: foreign-currency costs)

- **Recorded:** 2026-11-15
- **Head:** 14a0fa1 (all 12 Steps + 11-review-fix + review1-a..f)

| Check | Result | Notes |
|---|---|---|
| `yarn generate` / CPQ build / `yarn typecheck` | ✅ pass | |
| Unit tests (CI) | ✅ pass | 168 suites, 2652 tests (CI run 43726841208) |
| Integration tests (CI, Postgres) | ✅ pass | 66 passed, 1 skipped (PR #95's recipe `fixme`); `TC-CPQ-COST-FX-001` incl. 345.00 list price, UI "≈ 276.00 EUR", unlocked refresh and locked freeze (price unchanged, R11); Migration20261115100403 + Migration20261115102552 applied; raw `missingFxPairs` SQL ran |
| CI trigger | ⚠️ manual | `ci.yml` runs only on PRs into `main` |
| Golden tests | ✅ | pricing golden + subscription event payload golden byte-identical; margin hash unchanged without FX (Q15) |
| Confidentiality (I-4) | ✅ | rate / date / source / derivation / converted amount / errorDetail only for `cpq.costs.view`; calculate-price exposes none |
| Review pass | ✅ | review-1/r1-findings.md: 0 blocker, 0 major, 5 minor, 4 nit — all fixed (review1-a..f) |
| Browser QA | ⚠️ owed | only the Costs panel converted line was exercised by Playwright; the cost dialog hint, charge editor and order / subscription panels were never rendered |
| Upstream UP-FX-1 | ⚠️ not filed | draft in `UP-FX-1-issue.md`; a human files it and replaces "to be filed" in the manual and MIGRATION.md |

## Fixes during the run

| Fix | Finding |
|---|---|
| (step 9 brief) | order / inventory `total_amount` converted into the document currency (feature 2 Q3) — order margin = quote margin for a USD cost |
| 11-review-fix 3e50edd | FX E2E read the Costs panel without expanding the quote line |
| review1-a eacd0e4 | no-rate writes left `instanceAmount` set (only `none` status hid a 1:1 read); a transient FX error now keeps the snapshot instead of demoting the cost |
| review1-b 9fd41f7 | `missingFxPairs` counted locked quotes that can never pick up a new rate |
| review1-c de02b0c / review1-d f955308 | converted per-unit and order / subscription notes did not reconcile with the displayed totals |
| review1-e a06c3b2 | E2E now asserts the 345.00 list price and its freeze on the locked recalculation |
| review1-f 14a0fa1 | nits (comment, test title, demo rate horizon) |
