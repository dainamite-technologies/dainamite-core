# Checkpoint 4 — Steps D.15–E.20 verified; Phases D–E closed (all 20 steps done)

- **Checkpoint:** 4
- **Steps covered:** D.15, D.16, E.17, E.18, E.19, E.20 (8dde6c8..1500026)
- **Recorded:** 2026-11-15
- **Touched areas:** Cost requests page + Answer / Decline dialogs; quote Costs panel sourcing badges and actions (incl. Reopen and apply); sourcing fields on the quote costs read projection; demo_gix sourcing demo quotes; `cpq_cost_sourcing` workflow recipe seeded disabled; manual "Supplier cost sourcing", MIGRATION.md, changeset, `TC-CPQ-COST-SOURCING-001`; capability archive (`cpq-cost-sourcing.md` + updates).

| Check | Result | Notes |
|---|---|---|
| generate / CPQ build / typecheck | ✅ pass | |
| `yarn test` (full) | ✅ pass | 163 suites, 2490 tests |
| Review of Steps 15–20 | ✅ | queue `quoteId` filter accepted only the sales id (fixed in step 15); recipe principal grant accepted (seeded disabled, logged) |
| UI | ⚠️ | not rendered in a browser (none here) — helper + static-markup tests only; browser QA owed (row-expansion layout flagged) |
