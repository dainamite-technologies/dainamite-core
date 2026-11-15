# Notify — 2026-11-14-cpq-cost-plus-supplier-sourcing

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-11-14T19:13:56Z — run started
- Brief: implement .ai/specs/2026-11-12-cpq-cost-plus-supplier-sourcing.md (App Spec cost-plus, feature 3 of 6), stacked on PR #94.
- Decision: one implementation PR for the whole spec (its internal PR A / PR B split folded in), like features 1–2.
- Decision: no DB / browser available — migrations generated DB-less; Playwright specs written here and run by CI (manual dispatch).

## 2026-11-14T19:28:13Z — 4-review-fix
- Margin-only costs are lock-exempt in the sourcing rules (App Spec R11 cost lock: "Exempt: margin-only costs"): on a locked quote a different-value answer is applied (not a proposal that would block conversion with COST_ANSWER_PENDING), and a decline follows the unlocked R10a rule. `classifyAnswer` / `declineEffect` take the cost role; a missing role is treated as price-basis. Steps 7–9 must pass `role`.

## 2026-11-14T20:00:00Z — step 5 (B1)
- Decision: `note` on `POST …/request` is validated (≤ 500) but not persisted: the spec gives it no column and the sourcing events / history carry no free text. Reversible (a `request_note` column or an event field can be added without changing the route).
- Seam for step 12: `services/costs/sourcingSignals.ts` (`SourcingSignal`, `SourcingSignalPublisher`). Every producer pushes amount-free signals during its transaction; `CpqCostSourcingService` (dep `publisher`) and `DefaultCpqQuotingService` (dep `sourcingPublisher`) hand them to the publisher in `withQuotePricingWrite({ afterCommit })`. Step 12 only has to implement the publisher and wire it in `di.ts`; nothing is emitted today.

## 2026-11-14T20:20:00Z — step 6 (B1)
- Decision: a clone's first saved recalculation auto-opens requests like any saved recalculation (Q12; the clone route threads the cloning user as requester, Q5). The clone's cost lines still start `not_requested` (SOURCING_RESET); the open request appears only after that recalculation. Reversible by not passing the sourcing context from `cloneQuoteInTransaction`.
- Decision: R1b cancels on any driver change of an `on_request` / entered cost (also when the value was already `none`), not only when the reset note is written, so a request never survives a reconfiguration it was not made for.

## 2026-11-14T19:47:01Z — 6-review-fix
- A clone's first saved recalculation no longer auto-opens requests (spec "Clone": the cloned tail is `not_requested`, R16; open requests are never copied). New `autoOpen` option on cost resolution (default true); the clone path passes `false`. A later saved recalculation of the clone may still auto-open per Q12.

## 2026-11-15T00:10:00Z — step 7 (B2)
- Decision: a supplier-answered value gets `value_origin = 'supplier'` and the catalog resolver treats it like an entered (`manual`) value (kept until a driver changes, then R1b resets it). Without this the next saved recalculation would overwrite an applied answer with the catalog estimate. A declined (cleared) unlocked value also becomes origin `supplier` for the same reason.
- Decision: `COST_ANSWER_PENDING` is checked BEFORE `COSTS_NOT_CONFIRMED` in conversion (a proposal line is usually also `estimated`; the pending refusal is the actionable one). Enforced in `conversionGuard.loadConversionBlockers` (one read of the price-basis rows; `proposed_amount` not null), consumed by `cpqOrderService`. Step 9 owns the remaining conversion work (request cancellation).
- Decision: an answer in a non-quote currency is stored as `none` + `CURRENCY_NO_RATE` with the amount not persisted on the row (hash and history keep the idempotency); `validUntil >= today` and the currency format are `422`, the date is checked after the idempotency check so a retry never fails on a passed date.
- Seam: `SourcingValuedSignal` (`kind: 'valued'`, causes answer / decline / apply_answer, no amounts) is pushed into the write's signal sink; step 12 maps it to `cpq.quote.cost_valued`. `fullCostView` gained `costRequestId`, `requestSeq`, `answeredAt`, `declineReason`, `hasAnswerPending`, `proposedAnswer` (cost-view holders only).

## 2026-11-15T00:16:27Z — 7-review-fix
- Migration20261115000100 widens `cpq_quote_line_costs_value_origin_check` to allow `supplier` (step 7 writes it; the feature-1 constraint allowed only catalog / manual, so every answer would fail on Postgres — mock-EM tests could not see it). down() maps supplier → manual before restoring the narrow check.
- An answer in a non-quote currency now keeps the supplier's unit amount in its own currency (spec edge case: "stored and answered"), still `none` + `CURRENCY_NO_RATE` with no instance amount, so nothing prices from it until FX ships.

## 2026-11-15T01:00:00Z — steps 9-10 (B3)
- Finding: core never emits `sales.quote.deleted`. It is declared (core `sales/events.ts:37`), but `sales.quotes.delete` (`commands/documents.ts:5400`) only queues indexer side effects (`queueDeletionSideEffects`, `documents.ts:2273-2296`, no `events` config) and the quotes route has none; only create passes `quoteCrudEvents` (payload `id`, `organizationId`, `tenantId`, `userId`). The Q7 subscriber is registered and tested but dormant today; the queue filter and the `QUOTE_CLOSED` check cover the case.
- Decision: element-deactivation fan-out covers the cost-element write path only (`updateElement` isActive true -> false, `deleteElement`). A charge leaving cost-plus (`deactivatePriceBasisElements`) or being deleted runs inside the route's own flush, so it is left to R1a on the quote's next saved recalculation and to the answer-side inactive-element check. Reversible: the product-charges routes can call `cancelRequestsForElements` after their flush.
- Decision: a manual value write cancels with `manual_value` when the value or status changes (not for note / supplier-data edits) and also clears an unapplied proposal on a closed (`answered`) row.

## 2026-11-15T02:00:00Z — step 12 (C1)
- Decision: event payloads use `quoteId` = the CPQ quote id (same as `pricing_changed` / `margin_changed`, and the id the quote detail URL and the cost routes take), `quoteConfigurationId` = the same value, plus `salesQuoteId` for the sales document. Reversible (additive fields).
- Decision: Q11's `manual_value` and `reset` causes are produced here: `updateCost` pushes a `valued` signal when the value / status changes, and R1b (`costResolution`) pushes one with cause `reset`. The reset signal's `lineReady` is approximated from the reset value (`status != none` and no `errorCode`): the finished recalculation's validation is not available inside the plan. A manual cost created with a value does not emit `cost_valued` (no prior value; reversible).
- Gap closed: `adjustmentService` and `quoteCostService` now hand a signal sink to `recalculateLockedQuote` and publish after commit; `quoteCostService.write` owns the sink for every cost / markup write.

## 2026-11-15T03:00:00Z — step 13 (C1)
- Decision: two persistent subscribers instead of one (one event each, one side effect each): `cost-request-opened-notification.ts` (cost_requested -> managers) and `cost-request-notifications.ts` (cost_valued -> requester). The handler is not told which event fired, so a single file could not tell them apart.
- Finding: CPQ shipped no locale files before; `i18n/en.json` is the framework's mechanism (the generator emits `modules.i18n.generated.ts` with it, as for `billing`), so it ships with the notification keys and `notifications.categories.cpq`. English only; other locales fall back to the key's English text via the dictionary merge (add pl/de/es later).
- Recipients of `opened`: candidates from `getRecipientUserIdsForFeature(cpq.costs.manage)`, narrowed to the organization with `getScopedNotificationRecipientUserIds` (createBatch refuses recipients outside the organization), then `userHasAllFeatures([view, manage])`.

## 2026-11-15T04:00:00Z — 13-review-fix
- Decision: `notifications` is an OPTIONAL peer of CPQ (not added to `metadata.requires`), per core AGENTS "Cross-Module Coupling" (optional consumer owns the glue, resolves the peer in try/catch, no-ops when absent). CPQ no longer deep-imports the notifications module: subscribers use `tryResolveNotificationService`, `buildCostNotification` builds the batch input locally (same shape as core's builder), and `notifyCostManagers` takes candidates from the quote organization's live users (Kysely on `users`, auth is a required module) narrowed by `rbacService.userHasAllFeatures([view, manage])` instead of `getRecipientUserIdsForFeature`. Costs one ACL check per org user per opened request (cached by rbac); revisit with a feature-holder query if orgs get large.
- Fixed: target-subscription detach now passes the signal sink to its recalculation (R1a / R1b cancellations were dropped).

## 2026-11-15T06:00:00Z — steps 15-16 (D1)
- Finding: notification links carry the CPQ quote id (`?quoteId={quoteId}`), but the queue filter compared the sales quote id only. The list `quoteId` filter now matches either id (`quoteId` or `quoteConfigurationId`), so the links land on a filtered page. Row links and cost routes use `quoteConfigurationId` (the id the quote page takes).
- Decision: the quote costs read gains `requestEligible` (Q14, computed server-side from the line) and `overdue` (tenant threshold) on the status-only projection, plus `sourcingStatus`, `requestSeq`, `requestedAt`, `hasAnswerPending` (statuses only, confidentiality test still clean); the full projection adds `requestSupplierId/Name`. No new endpoint.
- Not implemented from the UI spec (no data / no browser): the supplier customers-company lookup in the Answer dialog (plain supplier name field; the request's supplier id and name are prefilled and sent), the default `valid until` = today + element `default_validity_days` (the element default is not in any read API; the field starts empty), the dialog currency defaults to the request's estimate currency else the quote currency (the page resolves it with two reads on open). The page's row expansion is a DataTable sub-row whose panel overflows a zero-width cell (visual check needed in CI / by a human).

## 2026-11-15T07:00:00Z — step 18 (E1)
- Finding: the seeding entry point is public enough (`WorkflowDefinition` entity + `syncWorkflowDefinitionPrincipal` from `@open-mercato/core`), so the recipe ships as a seeded disabled definition in `demo_gix` (no JSON fallback). CALL_API has no step type of its own: it is an activity on `AUTOMATED` steps.
- Decision: the definition declares `grantedFeatures: ['cpq.costs.view', 'cpq.costs.manage']` and the seed provisions its execution principal. Without it an event-triggered run has `initiatedBy = trigger:<id>` and CALL_API refuses to run (no traceable principal). Seeds bypass the `workflows.definitions.grant_features` API gate (system seed); reversible (edit the grant in the studio).
- Limitation: form fields are not conditionally required, so `validUntil` / `unitAmount` etc. are optional on the task form; a blank value on the answer path fails at the cost route (422) and the step fails visibly. Lenient interpolation leaves an unresolved `{{context.x}}` literal.
