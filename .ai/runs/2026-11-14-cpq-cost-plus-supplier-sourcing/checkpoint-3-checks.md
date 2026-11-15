# Checkpoint 3 — Steps C.12–C.14 (+ 13-review-fix) verified; Phase C closed

- **Checkpoint:** 3
- **Steps covered:** C.12, C.13, C.14, 13-review-fix (eb05ea6..874677a)
- **Recorded:** 2026-11-15
- **Touched areas:** `packages/cpq` — events `cpq.quote.cost_requested` / `cost_request_cancelled` / `cost_valued` (`clientBroadcast: false`, `payloadSchema`, no amounts) via `sourcingEventBuffer` + `sourcingPublisher`, wired for every producer; four notification types (`cpq.cost_request.opened` / `answered` / `answer_pending` / `declined`), `lib/costNotifications.ts` (`notifyCostManagers`), two persistent subscribers, `i18n/en.json`; confidentiality sweep extended to the sourcing surfaces.

## Checks

| Check | Result | Notes |
|---|---|---|
| `yarn generate` / CPQ build / `yarn typecheck` | ✅ pass | first run FAILED (4 TS errors in new tests; package-isolation: deep imports into core `notifications`) → 13-review-fix |
| `yarn test` (full) | ✅ pass | 157 suites, 2433 tests; golden fixtures unchanged |
| Producers emit exactly once | ✅ | request / re-request / cancel / answer / decline / apply / deactivation fan-out / sales-quote-deleted subscriber / close / DELETE / conversion / adjustment writes / quote cost writes / target detach (gap closed) / saved recalculation R1a, R1b, auto-open; none on no-op or rollback |
| Confidentiality (I-4) | ✅ | sentinel 7777.77 absent from events, notifications, command logs, history, queue projections, sourcing responses for non-holders |
| UI / integration | ⏭️ skipped | no UI in this window |

## Decisions accepted

- `notifications` is an optional peer: subscribers resolve `notificationService` from DI in try/catch and no-op when absent (core AGENTS "Cross-Module Coupling"); no deep imports.
- Cost-manager recipients are the users of the quote's organization (core `createBatch` 404s the whole batch for a recipient outside the organization scope — `assertNotificationRecipientsInScope`), filtered by `rbacService.userHasAllFeatures(['cpq.costs.view','cpq.costs.manage'])`. One RBAC check per org user — follow-up if organizations get large.
- Event `quoteId` is the CPQ quote id (like sibling events), plus `salesQuoteId`.
- `reset` signal's `lineReady` is derived from the reset value; manual costs created with a value emit no `cost_valued`.
- CPQ gains `i18n/en.json` (English only).
