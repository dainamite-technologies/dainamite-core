# Final gate — PR #94 (CPQ cost-plus: order & subscription costs)

- **Recorded:** 2026-11-14
- **Head:** 9174f19 (all 21 Steps + 14/20 review fixes + review1-a..f)

| Check | Result | Notes |
|---|---|---|
| `yarn generate` / CPQ build / `yarn typecheck` | ✅ pass | local, checkpoint 4 + executor runs after review1 |
| Unit tests (CI) | ✅ pass | 143 suites, 2098 tests (CI run 43629857321) |
| Integration tests (CI, Postgres) | ✅ pass | 64 passed incl. `TC-CPQ-COST-ORDER-001` and all `TC-CPQ-ARC-*`; Migration20261114101001 applied. Needed two test-only fixes (20-review-fix 2c61872, 9174f19) and one re-run for a Turbopack Google-Fonts fetch failure in the CI build (infra; unrelated) |
| CI trigger | ⚠️ manual | `ci.yml` runs only on PRs into `main`; this stacked PR was run via `workflow_dispatch` |
| Golden tests | ✅ | `costPlusGolden.json` and the subscription event payload golden unchanged; new I-9 tests compare payloads with / without costs and toggle on / off (review1-e) |
| Confidentiality (I-4) | ✅ | sweep extended to order / subscription / asset / change-log / lifecycle-event / `cost_changed` channels |
| Review pass | ✅ | review-1/r1-findings.md: 0 blocker, 3 major, 2 minor, 1 nit — all fixed (review1-a..f) |
| Style lint | ⏭️ skipped | no ESLint / design-system lint configured in the repo |
| Browser QA of new screens | ⚠️ owed | no browser here; order / subscription / asset cost sections and Change History cost diffs covered by helper + static-markup tests and the Playwright E2E's test-id assertions only |

## Review-1 dispositions

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | major | ARC activations never linked order line costs to inventory costs | review1-a 6868d81 (+ c1cb0e2) |
| 2 | major | Reconfigured mirror replace ended costs the quote could not carry (manual costs; toggle off) | review1-b dffa0aa — end only missing `catalog` costs; upsert-only when `cpq.cost_plus` is off (scope decision, NOTIFY) |
| 3 | major | Order margin counted ARC mirror lines the quote margin excludes | review1-c 1461615 |
| 4 | minor | Concurrent activations of one order could both succeed | review1-d eec9b12 — `PESSIMISTIC_WRITE` lock + re-check in the transaction |
| 5 | minor | I-9 golden didn't compare with / without costs | review1-e 08d578d |
| 6 | nit | Subscription costs section silent on read failure | review1-f 1177fba |
