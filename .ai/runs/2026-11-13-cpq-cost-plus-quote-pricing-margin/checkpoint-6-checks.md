# Checkpoint 6 — Steps D.18–D.20 (+ 19-review-fix) verified; Phase D closed

- **Checkpoint:** 6
- **Steps covered:** D.18, D.19, D.19-review-fix, D.20 (f6e0157..b42681c)
- **Recorded:** 2026-11-13T17:51:24Z
- **Touched areas:** `packages/cpq` UI — offering charge editor (cost-plus fields, Cost elements sub-table + dialog, Preview cost, switch-back confirmation), pricing-table purpose selector + list filter, quote page (cost status badges, Indicative chip, "≈ fallback" / "Price on request", Costs panel, Margin card, Add / Edit / Confirm cost and Override markup dialogs, `expectedRevision` on status changes with the stale-price banner); backend: `fallbackPrice` on unpriced cost-plus charges.

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn generate` | ✅ pass | |
| `yarn typecheck` | ✅ pass | clean |
| `yarn workspace @dainamite/cpq build` | ✅ pass | client bundles compile |
| `yarn test` (full) | ✅ pass | 122 suites, 1775 tests; golden fixture unchanged |
| Component tests | ✅ pass | `renderToStaticMarkup` (no jsdom in the repo): CostsPanel, Margin card, dialog form bodies, error-code mapping, request builders (`expectedRevision`, note rules) |
| Project UI rules on new code | ✅ pass | new code uses `apiCall`, `Button` / `IconButton`, `lucide-react`, `t(key, fallback)`; the raw `fetch` / `<button>` / `<svg>` left on the offering and quote pages predate this PR |
| Review of Steps 18–19 | ✅ 1 major fixed | no fallback price on resolved charges → 19-review-fix |
| UI / browser verification | ⏭️ skipped | UI touched, but the app cannot run here (no Postgres; Docker socket denied) and no browser provider is configured; no screenshots. Interaction paths (Cmd/Ctrl+Enter, Escape, click flows) are not exercised by tests. Needs browser QA before merge. |
