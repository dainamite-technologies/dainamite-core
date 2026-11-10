# Harden CPQ quote pricing: recalculate permission, frozen Amend lines, mutation guards on quote routes

Extends: specs/implementation/xd-201-quoting.md
Extends: specs/implementation/xd-250-arc-spec.md

App Spec: `.ai/specs/2026-11-10-app-spec-cpq-quote-price-adjustments.md` (Phase 1). Brief: `.ai/specs/briefs/2026-11-10-cpq-price-adjustments-quote-pricing-integrity.md`. Prerequisite of `.ai/specs/2026-11-10-cpq-manual-price-adjustments.md`.

## 📝 TLDR
Before reps can negotiate prices, CPQ must stop changing prices behind their back. Today a read-only user can persist a recalculation, accepted quotes can be re-priced, Amend quotes re-price items nobody touched and write the result to the subscription, and no quote route lets a project enforce approvals. **Proposed (future behavior):** recalculation requires `cpq.quotes.manage` and is refused on terminal quotes; untouched Amend lines keep the subscription's stored price; quote write routes call mutation guards and export `openApi`.

## Resolved assumptions (autonomous defaults)

| # | Question | Default | Rationale |
|---|---|---|---|
| Q1 | Keep `save:false` recalculation for viewers? | No — the route requires `cpq.quotes.manage` | Only caller (quote page, integration test) always sends `save: true` (`backend/cpq/quotes/[id]/page.tsx:452-456`, `__integration__/TC-CPQ-002.spec.ts:85`); a route-level `requireFeatures` is grounded, a handler-level feature check is not (route context loads no granted features). |
| Q2 | Guard behaviour without a project guard | Pass-through | No change for tenants that register none. ⚠ NEEDS HUMAN CONFIRMATION of `validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess` signatures against the installed `@open-mercato/core` (not installed in this worktree). |
| Q3 | What unfreezes an Amend line? | Any pricing input change: configuration (deep-equal ignoring `_arc*` markers), quantity, `termMonths`, `startDate`, `endDate`, `usageEstimates` | `updateQuoteItem` always receives the full configuration (`cpqQuotingService.ts:389-403`), so "any field present" would unfreeze everything. |

## 📝 Problem Statement

- `recalculate` persists prices with `cpq.quotes.view` (`api/quotes/[quoteId]/recalculate/route.ts:9`) and has no status check (`cpqQuotingService.ts:544`), so a viewer — or anyone on an `accepted` quote — can rewrite stored prices.
- ARC mirror lines that carry `offeringId` / `productId` are re-priced on every recalculation (`cpqQuotingService.ts:812-831`) and activation writes the result to the subscription item (`cpqInventoryService.ts:1731-1772`): an Amend that adds one port silently moves every other port to today's catalog price in CPQ inventory, while billing keeps the old rate (amend events carry no `modify` changes, `cpqOrderService.ts:1220-1285`).
- No CPQ route calls a mutation guard (status route `api/quotes/[quoteId]/status/route.ts:11-26`) and no quote route exports `openApi`, contrary to the CPQ Definition of Done (`.ai/skills/cpq/SKILL.md:98-100`).

## 📝 Proposed Solution

1. **Recalculate:** route metadata `requireFeatures: ['cpq.quotes.manage']`; `recalculate(save:true)` on a terminal status (`accepted`, `rejected`, `cancelled`) → `QuotingError(409)`.
2. **Frozen Amend mirror lines:** `mirrorTargetSubscriptionItems` sets `_arcPriceFrozen: true` on engine-priced mirror lines of **Amend** quotes. `recalculateInternal` treats a frozen line like a free-form mirror line — keeps its stored `charges`, skips the engine. `updateQuoteItem` clears the marker when a pricing input changes (Q3), then re-prices as today. Renew and Cancel quotes are unchanged (Renew re-prices by design). A banner on reconfigured Amend lines says that negotiated prices are not carried over yet.
3. **Guards + `openApi`:** status, items (POST / PUT / DELETE), recalculate and convert (`POST /api/cpq/orders`) routes call `validateCrudMutationGuard` before and `runCrudMutationGuardAfterSuccess` after the write, and export `openApi`.

Alternatives: handler-level `hasFeature` for `save:true` only (rejected — no granted-feature list in the CPQ route context, Q1); freezing Renew lines too (rejected — renewals re-price by product decision, App Spec Q8).

## 📝 Delta

### Capability: cpq-quote-lifecycle

#### MODIFIED Requirement: Recalculation
The system SHALL allow recalculating a quote only for users with `cpq.quotes.manage`, and SHALL refuse a saved recalculation on a quote in a terminal status.

##### Scenario: Viewer
- WHEN a user with only `cpq.quotes.view` posts `/api/cpq/quotes/{id}/recalculate`
- THEN the API returns `403` and nothing is stored

##### Scenario: Accepted quote
- WHEN a manager posts `recalculate` with `save: true` on an `accepted` quote
- THEN the API returns `409` and stored prices are unchanged

Frozen by: `packages/cpq/src/modules/cpq/api/quotes/[quoteId]/recalculate/__tests__/route.test.ts` (created by the characterization step)

#### ADDED Requirement: Mutation guards on quote writes
The system SHALL consult registered mutation guards before and after status transitions, line writes, recalculation and quote-to-order conversion.

##### Scenario: Project guard blocks a transition
- WHEN a project guard rejects `ready → with_customer`
- THEN the status route returns the guard's error and the status is unchanged

### Capability: cpq-arc

#### MODIFIED Requirement: Amend mirror line pricing
The system SHALL keep an engine-priced mirror line on an Amend quote at the source subscription item's stored charges until a pricing input of that line changes, and SHALL then re-price it at the current standard price.

##### Scenario: Untouched line
- WHEN an Amend quote adds a port and the existing port's catalog price rose from 100 to 120 since activation
- THEN the existing port's line keeps 100, and activation leaves its subscription item price at 100

##### Scenario: Reconfigured line
- WHEN the rep changes the existing port's speed on the Amend quote
- THEN the line is re-priced at the current standard price and the banner is shown

##### Scenario: Unchanged resubmission
- WHEN the UI saves the line with the same configuration and quantity
- THEN the line stays frozen

Frozen by: `packages/cpq/src/modules/cpq/services/__tests__/cpqQuotingService.arc.test.ts` (recalculation cases added by the characterization step; today the file covers only `transitionStatus → validateArcQuote`)

## 📝 Architecture

Changes stay in `@dainamite/cpq` route metadata, `cpqQuotingService` (mirror helper, `recalculateInternal`, `updateQuoteItem`, `recalculate`) and five route files. Marker handling reuses the `_arcMirrored*` preservation pattern (`cpqQuotingService.ts:389-403`). No data-model change: `_arcPriceFrozen` lives in the line `configuration` jsonb.

## 📝 API Contracts

- `POST /api/cpq/quotes/{quoteId}/recalculate`: `requireFeatures: ['cpq.quotes.manage']` (was `view`); `409` on `save:true` in terminal statuses.
- Status, items, recalculate and `POST /api/cpq/orders`: unchanged request / response; may return a guard error (status / body from the guard); each exports `openApi`.
- `QuoteResult.lines[].configuration` may contain `_arcPriceFrozen: true` (read-only marker).

## 📝 UI/UX

Amend quote lines show a `Frozen` badge ("price kept from the subscription"); reconfiguring shows the banner "Negotiated prices are not carried over yet — this line now uses the current catalog price". Viewers no longer see an enabled Recalculate action. Strings via `useT()`.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior |
|---|---|
| Viewer opens a quote | Sees stored prices; Recalculate hidden; API `403` |
| Integration scripts using a view-only API key to recalculate | `403` — release note; grant `cpq.quotes.manage` |
| Amend quote created before this change (no marker) | Lines behave as today (re-priced) until re-mirrored |
| Free-form mirror line | Unchanged (already keeps copied charges) |
| Guard throws | Write aborted, error returned, nothing persisted |

## 📝 Risks & Impact Review

| Risk | Severity | Mitigation |
|---|---|---|
| Behaviour change for ARC operators who relied on Amend re-pricing untouched items | Medium | Release note + `MIGRATION.md`; reconfiguring a line re-prices it explicitly |
| Permission tightening breaks a viewer workflow | Low | No UI caller sends `save:false`; release note |
| Guard API unverified (U1) | Medium | Verify before the guard step; pass-through default |
| Rollback | Low | Code-only; removing the marker logic restores re-pricing on next touch |

## 📋 Phasing

Single phase (part of App Spec Phase 1), shipped before `manual-adjustments`.

## 📋 Implementation Plan

1. **Characterize recalculation** — new `recalculate/__tests__/route.test.ts` asserting today's `view` access and terminal-status saves; green; commit alone.
2. **Harden recalculation** — route metadata `cpq.quotes.manage`; terminal refusal in `recalculate`; update the step-1 test to the new scenarios.
3. **Characterize Amend re-pricing** — add recalculation cases to `cpqQuotingService.arc.test.ts` (untouched mirror line re-priced today); green; commit alone.
4. **Frozen Amend lines** — marker in `mirrorTargetSubscriptionItems`, skip in `recalculateInternal`, unfreeze rule in `updateQuoteItem` (Q3), marker preservation; update step-3 tests; UI badge + banner.
5. **Guards + `openApi`** — verify the guard API in the installed framework; wire guards into status, items, recalculate and convert routes; export `openApi` on each; tests asserting guard invocation and rejection propagation.
6. **Docs** — `packages/cpq/MIGRATION.md`, `manuals/xd-250-arc-flow.md` (frozen lines), release note.
7. **Archive the Delta** into `.ai/specs/capabilities/cpq-quote-lifecycle.md` and `.ai/specs/capabilities/cpq-arc.md`.
