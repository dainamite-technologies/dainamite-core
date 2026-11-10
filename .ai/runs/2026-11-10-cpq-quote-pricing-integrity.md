# Execution plan — CPQ quote pricing integrity

Source doc: .ai/specs/2026-11-10-cpq-quote-pricing-integrity.md
App Spec: .ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md (Phase 1)
Branch: fix/cpq-quote-pricing-integrity
Engine: om-auto-create-pr (steps: 7, --loop: no)

## Goal

Stop CPQ from changing quote prices behind the rep's back before manual price adjustments land: recalculation requires `cpq.quotes.manage` and is refused on terminal quotes; untouched Amend mirror lines keep the subscription's stored price; quote write routes consult mutation guards and export `openApi`.

## Scope

- `packages/cpq/src/modules/cpq/api/quotes/[quoteId]/recalculate/route.ts`, `status/route.ts`, `items/route.ts`, `items/[lineId]/route.ts`, `api/orders/route.ts` (convert).
- `packages/cpq/src/modules/cpq/services/cpqQuotingService.ts` — `recalculate`, `recalculateInternal`, `updateQuoteItem`, `mirrorTargetSubscriptionItems`.
- Quote detail UI: Frozen badge + reconfigure banner on Amend mirror lines; Recalculate hidden for viewers.
- Tests under `packages/cpq/src/modules/cpq/**/__tests__/`; docs `packages/cpq/MIGRATION.md`, `manuals/xd-250-arc-flow.md`; capability archive.

## Non-goals

- Manual price adjustments, waterfall, events (next spec `2026-11-10-cpq-manual-price-adjustments.md`).
- Carry-over of manual adjustments, billing propagation of modified items (Phase 2).
- Pipeline setup (`.ai/agentic.config.json`, GitHub labels) — not configured in this repo; label work skipped.

## Implementation Plan

### Phase 1: Recalculation hardening
- 1.1 Characterize today's recalculate route (view access, terminal-status saves).
- 1.2 Require `cpq.quotes.manage`; refuse `save:true` on terminal statuses; update tests.

### Phase 2: Frozen Amend mirror lines
- 2.1 Characterize Amend mirror-line re-pricing in recalculation.
- 2.2 Freeze engine-priced Amend mirror lines (`_arcPriceFrozen`), unfreeze on any pricing-input change; badge + banner in the quote UI.

### Phase 3: Guards, openApi, docs
- 3.1 Mutation guards + `openApi` on status, items, recalculate, convert routes.
- 3.2 Docs: `MIGRATION.md`, ARC manual.
- 3.3 Archive the Delta into `.ai/specs/capabilities/`.

## Risks

- Behaviour change for ARC operators (untouched Amend lines no longer follow catalog price changes) — documented.
- Mutation-guard API verified against the installed `@open-mercato/shared` before wiring.
- Integration-script callers of recalculate with a view-only key get `403` — release note.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Recalculation hardening

- [x] 1.1 Characterize today's recalculate route (view access, terminal-status saves). — fc822a4
- [x] 1.2 Require `cpq.quotes.manage`; refuse `save:true` on terminal statuses; update tests. — 48ed810

### Phase 2: Frozen Amend mirror lines

- [x] 2.1 Characterize Amend mirror-line re-pricing in recalculation. — b2c16e9
- [x] 2.2 Freeze engine-priced Amend mirror lines (`_arcPriceFrozen`), unfreeze on any pricing-input change; badge + banner in the quote UI. — 7cb034e

### Phase 3: Guards, openApi, docs

- [ ] 3.1 Mutation guards + `openApi` on status, items, recalculate, convert routes.
- [ ] 3.2 Docs: `MIGRATION.md`, ARC manual.
- [ ] 3.3 Archive the Delta into `.ai/specs/capabilities/`.
