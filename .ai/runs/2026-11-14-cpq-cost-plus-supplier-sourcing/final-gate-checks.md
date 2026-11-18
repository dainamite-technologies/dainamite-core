# Final gate — PR #95 (CPQ cost-plus: supplier cost sourcing)

- **Recorded:** 2026-11-15
- **Head:** fe13144 (all 20 Steps + review fixes 4/6/7/13 + review1-a..h)

| Check | Result | Notes |
|---|---|---|
| `yarn generate` / CPQ build / `yarn typecheck` | ✅ pass | local + executor runs after review1 |
| Unit tests (CI) | ✅ pass | 2496 tests (CI run 43700894242) |
| Integration tests (CI, Postgres) | ✅ pass | 65 passed, 1 skipped (`test.fixme` recipe scenario: workflow trigger is delivered asynchronously by the queue worker); Migration20261114192129 + Migration20261115000100 applied |
| CI trigger | ⚠️ manual | `ci.yml` runs only on PRs into `main`; run via `workflow_dispatch` |
| Golden tests | ✅ | unchanged |
| Confidentiality (I-4) | ✅ | sweep covers events, notifications, command logs, history, queue projections, sourcing responses |
| Review pass | ✅ | review-1/r1-findings.md: 0 blocker, 2 major, 3 minor, 3 nit — all fixed (review1-a..h) |
| Style lint | ⏭️ skipped | no ESLint / design-system lint configured |
| Browser QA | ⚠️ owed | Cost requests page and quote Costs panel never rendered here |

## Review fixes during the run (main session)

| Fix | Finding |
|---|---|
| 4-review-fix ebee995 | margin-only costs are lock-exempt in answers / declines (App Spec R11) |
| 6-review-fix 408849a | a clone's first recalculation opened requests (spec "Clone", R16) |
| 7-review-fix e23ead6 | DB CHECK on `value_origin` rejected `supplier` — every answer would fail on Postgres; foreign-currency answers keep the amount |
| 13-review-fix 83a31e6 / 874677a | test typings; deep imports into core notifications → optional peer; detach recalculation signal sink |

## Review-1 dispositions

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | major | E2E asserted a ref conflict after a re-request (which clears the hash by design) | review1-a e6f4e2e |
| 2 | major | Deleting a manual cost left its request open (no history / event) | review1-b 8ce81fc |
| 3 | minor | Demo seed abandoned the pending-proposal scenario | review1-c 291e8a3 |
| 4 | minor | Request opened on an inactive element | review1-d ba559a6 |
| 5 | minor | Apply dialog claimed a currency conversion | review1-e 74100af |
| 6–8 | nit | deleteQuote scoping / batching; currency upper-casing; clone route openApi | review1-f 332899d, review1-g dbd04d2, review1-h fe13144 |
