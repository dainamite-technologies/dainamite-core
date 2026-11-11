# Challenger — Phase 2 (§5 User Stories + cross-story impact matrix)

Execution: fresh-context subagent (general-purpose), 2026-11-10. Inputs: §1.3 glossary, §1.4.5–1.4.6, §5 + cited source files.

## CRITICAL (all fixed)

1. **Billing event lost after commit** — `activateOrder` emits after commit and swallows failures with `console.error` (`cpqOrderService.ts` ~L398-404); renew subscriber returns silently without a billing account. → Fixed: failure path "activation committed, event not queued → billing stale" on US-2.1 / 3.2 / 3.3; new **US-2.5 (P1) billing reconciliation** — connector CLI compares subscription items vs billing items by `sourceRef` / rate, reports drift, `--replay` re-emits; "no billing account" throws so the persistent subscriber retries.
2. **Carried-over price goes stale** — `ensureNoConcurrentArcQuote` (`cpqQuotingService.ts:2276`) ignores accepted-not-activated ARC orders; a second ARC quote pins pre-change prices and undoes the first on activation. → Fixed: carry-over stores `carried_from_item_hash`; if the source item changed since, the adjustment is invalid (`ADJUSTMENT_SOURCE_CHANGED`) → conversion refused and ARC activation refused (409). Matrix rows added (two ARC changes on one subscription; renew vs amend).
3. **Proration ambiguity** — billing bills full cycles only (`itemSelector.ts`); end-dating the old item without an old-rate proration leaves days unbilled. → Fixed: R14 spells out one proration item per (segment or rate) × partly covered cycle; worked amounts in US-2.2 / 3.3; backdated effective date inside an already-billed cycle → connector posts a one-time difference item (`(new − old) × billed days`, may be negative — allowed for `one_time`).

## WARNING (fixed)

- Lock weaker than claimed → R7: adjustments also locked once an order exists for the quote (`convertedOrderId`); US-4.2 states enforcement needs a project guard.
- Conversion vs invalid adjustment on an accepted quote → conversion uses the **stored** snapshot (no re-pricing); the way out is moving the quote back to `ready` (any → any), fixing, re-accepting. Stated in US-1.7.
- Several MRC charges per item → item schedule = merged breakpoints, segment price = Σ charge prices (R14).
- `bill_end_date < bill_start_date` unverified → future, never-billed segment items are **deleted** (billing items CRUD `DELETE`, `billing.item.manage`) instead of end-dated before they start.
- Concurrency / abandonment → common failure block for all write stories (stale revision 409; navigate away → nothing stored).
- Missing criteria → US-2.4, US-1.4 success lines; US-4.1 happy path; US-0.2 concrete figures.
- Matrix gaps → rows for inactive reasons (clone / carry-over keep them), order cancelled after conversion (pre-existing re-conversion block, logged U11), lost `status_changed` event (stored snapshot + project timer), preview (no state), seeds (none).
- Vague outcomes → US-1.5 / US-3.2 made observable.
