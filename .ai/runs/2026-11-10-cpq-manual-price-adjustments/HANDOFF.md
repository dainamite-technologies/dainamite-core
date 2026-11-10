# Handoff — manual price adjustments

Branch: feat/cpq-manual-price-adjustments
PR: not yet opened; stacked on PR #84 (5f2b419)
Current phase/step: 1.6 (not started)
Last implementation commit: 9a07adb

## Completed
Steps 1.1–1.5: pricing baseline, list/standard capture, legacy helper, adjustment entity/validators/generated migration, pure resolver, summary and hash.
669 CPQ tests and package typecheck passed. See checkpoint-1-checks.md.

## Next action
Implement transaction boundary for quote writes and conversion. Preserve source EM isolation and use transaction EM for the entire write/recalculation; do not mutate a shared service's EM during concurrent requests. Pass transaction EM explicitly to internal write implementations. Same lock/revision for adjustment commands in later steps.

## Review
Read-only Cezar review 2b7cc218-de8d-4a25-a5cd-5eb78d7c6afb pending. It must inspect actual implementation branch 9a07adb explicitly because cockpit children fork cez/2610846e. Do not merge a read-only child branch.

## Environment
No migrations applied. Database/browser checks unavailable; Docker socket denied. New branch not pushed/opened: Cezar Guard permission required before publication; prior user authorization covers PR #84 push.
