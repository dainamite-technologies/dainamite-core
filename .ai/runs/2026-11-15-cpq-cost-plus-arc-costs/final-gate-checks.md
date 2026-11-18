# Final gate — PR #100 (CPQ cost-plus: ARC costs)

- **Recorded:** 2026-11-16
- **Head:** d07a4d8 (steps 1–21 + 23; step 22 blocked; 7-review-fix; review1-a..g + typecheck)

| Check | Result | Notes |
|---|---|---|
| `yarn generate` / CPQ build / `yarn typecheck` | ✅ pass | |
| Unit tests (CI) | ✅ pass | 3017 tests (CI run 43786299653) |
| Integration tests (CI, Postgres) | ✅ pass | 67 passed, 1 skipped (PR #95 recipe fixme) incl. `TC-CPQ-COST-ARC-001` (cost-only Amend: item cost keeps its id, Change History 270 → 240) and all `TC-CPQ-ARC-*`; Migration20261115151709 applied. First attempt hit the Turbopack Google-Fonts fetch flake (infra) → `gh run rerun --failed` |
| CI trigger | ⚠️ manual | `ci.yml` runs only on PRs into `main` |
| Golden tests | ✅ | pricing golden + I-9 subscription payload golden byte-identical (cost-only Amend payload unchanged) |
| Confidentiality (I-4) | ✅ | previous / droppedItemCosts / exposure / arcCosts / reconfirm / carried-cost hashes (stripped from quote results) |
| Review pass | ✅ | review-1/r1-findings.md: 0 blocker, 2 major, 5 minor, 1 nit — 7 fixed (review1-a..g); #7 is spec-conformant and flagged for the product owner |
| Step 22 Re-price from cost | ⛔ blocked | needs `modifiedItems` (spec Q3) — absent from this codebase |
| Browser QA | ⚠️ owed | quote / order ARC UI (badges, Keep current, Refresh, Re-confirm, exposure, COST_SOURCE_CHANGED banner) never rendered in a browser |

## Fixes during the run

| Fix | Finding |
|---|---|
| 7-review-fix bf9b4c0 | supplier answers / declines on frozen mirror lines follow the Q4 lock rule |
| review1-a cf145e2 | refresh / restore refused after conversion; activation compares against the carried-cost hash frozen at conversion |
| review1-b 608c4c4 | re-confirm dropped a typed currency (250 USD stored as 250 EUR) — currency now required with a first amount |
| review1-c 7cde64d | Renew attach demotion now cancels open cost requests |
| review1-d 5293f5f | demoted merge lines re-frozen at contracted charges |
| review1-e 79a38b3 | carried-cost edits and Keep current refused on a converted quote |
| review1-f 3cecd26 | carried-cost hash markers stripped from quote results (could confirm a guessed cost) |
| review1-g 6692df5 | re-confirm with no amount is not a value change |
| d07a4d8 | typecheck fix |
