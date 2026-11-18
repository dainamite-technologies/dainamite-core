# Handoff — 2026-11-15-cpq-cost-plus-arc-costs

**Last updated:** 2026-11-15T15:03:07Z
**Branch:** feat/cpq-cost-plus-arc-costs (local `cez/fdfb25fb`, push with `git push origin HEAD:feat/cpq-cost-plus-arc-costs`)
**PR:** draft, stacked on #96
**Current phase/step:** Phase A Step 1

## Next concrete action
- Step 1 — Characterization.

## Environment caveats
- No Postgres / Docker / browser; CI via `gh workflow run ci.yml --ref feat/cpq-cost-plus-arc-costs`
- Migrations DB-less (`TMPDIR=/tmp node_modules/.bin/tsx node_modules/.cache/cpq-tools/gen-cpq-migration.mts`); hand-add CHECK changes
