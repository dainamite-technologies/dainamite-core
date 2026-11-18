# Handoff — 2026-11-15-cpq-cost-plus-foreign-currency-costs

**Last updated:** 2026-11-15T09:54:48Z
**Branch:** feat/cpq-cost-plus-foreign-currency-costs (local worktree branch `cez/fdfb25fb`, push with `git push origin HEAD:feat/cpq-cost-plus-foreign-currency-costs`)
**PR:** draft, stacked on #95
**Current phase/step:** Phase A Step 1
**Last commit:** — (run folder commit)

## Next concrete action
- Step 1 — Characterization tests.

## Environment caveats
- No Postgres / Docker / browser; CI via `gh workflow run ci.yml --ref feat/cpq-cost-plus-foreign-currency-costs`
- Migrations generated DB-less (`TMPDIR=/tmp node_modules/.bin/tsx node_modules/.cache/cpq-tools/gen-cpq-migration.mts`)
- Build CPQ dist before the full `yarn test`
