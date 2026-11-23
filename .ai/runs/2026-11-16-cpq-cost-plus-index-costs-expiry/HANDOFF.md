# Handoff — 2026-11-16-cpq-cost-plus-index-costs-expiry

**Last updated:** 2026-11-16T05:42:45Z
**Branch:** feat/cpq-cost-plus-index-costs-expiry (local `cez/fdfb25fb`, push with `git push origin HEAD:feat/cpq-cost-plus-index-costs-expiry`)
**PR:** draft, stacked on #100
**Current phase/step:** Phase A Step 1

## Environment caveats
- No Postgres / Docker / browser; CI via `gh workflow run ci.yml --ref feat/cpq-cost-plus-index-costs-expiry`
- Migrations DB-less (`TMPDIR=/tmp node_modules/.bin/tsx node_modules/.cache/cpq-tools/gen-cpq-migration.mts`); hand-add CHECKs / partial indexes
