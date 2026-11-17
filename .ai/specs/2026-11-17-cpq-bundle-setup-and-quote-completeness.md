# CPQ bundles: setup fixes and honest quote-line completeness

Extends: `specs/implementation/xd-223-bundled-offerings.md` (Add-to-Quote Flow, V-QBUN-1..5 — designed, never built)
Extends: `specs/implementation/xd-201-quoting.md` (line `isConfigured` / quote `cpqStatus`)

Issues: #122, #123, #124, #125 · Package: `@dainamite/cpq` · Status: **Draft — autonomous defaults applied; Q2 and Q5 need human confirmation**

## 📝 TLDR

Bundles can't be set up or quoted end to end today. Bundle offerings can't be created in the admin UI. A removed component can't be re-added. Adding a bundle to a quote creates no default component lines. A bundle with empty required slots shows as "configured". A valid line for an offering with no charges can never become "configured", and nothing says why.

**Proposed:** fix the two setup defects (#122). Build the add-to-quote expansion and the quote-time slot validation that XD-223 designed but never built (#123, #124). Replace the three copies of the `isConfigured` formula with one rule that handles zero-charge offerings and always says why a line is incomplete (#125).

## Resolved assumptions (autonomous defaults)

The questions below were resolved with the recommended answer, without waiting for a reply. Each can be overridden before merge: comment on the PR with the question id and the option you want, and the dependent sections are updated. Items marked ⚠ keep this spec PR in **draft** until a human confirms them.

| # | Question | Chosen answer | Rationale |
|---|---|---|---|
| **Q1** | Which callers get default components when a bundle line is added? | **B** — opt-in `expandBundleDefaults` on `POST …/items` (default `false`). The admin quote page and the `cpq.add_quote_line` tool send `true`. | Today, callers that add a bundle and then post its children themselves get exactly what they send. That includes the admin "+ component" buttons, agents using `parentLineId`, and seeds. Expanding on every call would silently add duplicate default lines to their quotes and push slot groups over `cardinalityMax`. The flag is additive and changes no existing contract. (Puffin is not one of these callers: its calculator posts slot children as **root** lines with `parentLineKey: null`, `CalculatorShell.tsx:140-151`, and posts the bundle line alone only as a fallback, `:157-165`.) Rejected: A (silent behaviour change for every API caller) and C (UI-only: agents and API clients would not get it, and it is not atomic). |
| **Q2** | How strictly should an incomplete bundle be enforced? | **B** — the line and quote become `incomplete` with a V-QBUN error that names the slot, **and** quote → order conversion returns 422 while the quote's **stored** validation result has bundle-slot errors (`type: 'bundle_slot'`). Other invalid states convert as today. Submit and status transitions stay free. ⚠ NEEDS HUMAN CONFIRMATION | #124 asks to block submission as well. The code records a product decision to allow any status transition (`services/types.ts:66`, `cpqQuotingService.ts:907`). The guard is limited to bundle-slot errors so this change doesn't also start blocking attribute, relationship or `V-LINE-1` errors that convert today. Blocking only conversion stops broken subscriptions without reopening that decision. It is still a new 422 on an existing route, so the product owner should confirm it, or choose C (also block submit) or A (block nothing). |
| **Q3** | When is a valid line with no charges "configured"? | **B** — configured when the offering has **no active charge definitions**. If charges exist but none applies, the line stays incomplete with `V-LINE-1`. | Zero-priced included equipment is intended. A pricing gap where every charge's applicability condition is false is not, and quoting it silently at 0 hides mistakes. Every incomplete line gets a stated reason. |
| **Q4** | How do we fix "re-add after remove returns 500"? | **A** — make `cpq_off_comp_unique` a partial unique index (`WHERE deleted_at IS NULL`). A unique violation maps to 409 and not-found maps to 404. | Follows the partial-unique-on-`deleted_at IS NULL` precedent in `packages/cpq-billing-connector/src/modules/cpq_billing_connector/data/entities.ts:24`, and keeps removed rows as history. |
| **Q5** | Do the catalog routes we change also get new AI write tools? | **A** — update only `cpq.add_quote_line`. The catalog write routes (`POST /product-offerings`, `POST /offering-components`) stay without tools; the PR says why. Follow-up: #128. ⚠ NEEDS HUMAN CONFIRMATION | Those routes change in a backward-compatible way, and `catalog-pack` is read-only by design. But `.ai/skills/mcp-tools/SKILL.md` requires a tool for every changed route, so this exception needs explicit sign-off. |
| **Q6** | One implementation PR or three? | **B** — three PRs, in phase order (Phasing below). The four issues stay in one spec, as requested. | Each phase ships and tests on its own. Phase 3 depends on phase 2's shared rule. |

---

## 📝 Problem Statement

These are the defects behind the four issues. Each was checked against `main` at `d343b7b`.

| Issue | Symptom | Root cause (code) |
|---|---|---|
| #122-1 | Creating a bundle offering in the UI fails with `V-OFF-7: offeringType 'simple' must match … 'bundle'` | `backend/cpq/offerings/[id]/page.tsx:128` hardcodes `offeringType: 'simple'`, and the form has no type control. `backend/cpq/specifications/[id]/page.tsx:198` does the same. The Zod create schema adds `.default('simple')` (`data/validators.ts:56`), so the route cannot tell "omitted" apart from `'simple'`. `api/product-offerings/route.ts:234` then correctly rejects the request. |
| #122-2 | Removing a component and adding it again returns 500 | `removeComponent` soft-deletes the row (`cpqBundleService.ts:446`). The V-COMP-5 check filters `deletedAt: null` and passes. The **non-partial** unique constraint `cpq_off_comp_unique` (`data/entities.ts:259`, migration `20260412000000`) then rejects the insert. `api/offering-components/route.ts` maps every error that isn't a `V-*` error to 500. The same route returns 500 for "Offering / Slot / Child offering not found". |
| #123 | Adding a bundle creates only the bundle line. Slots show `0/1 (min 1)` | `addQuoteItemInTransaction` (`cpqQuotingService.ts:202`) never reads the bundle tree. XD-223 §Add-to-Quote Flow step 2 ("auto-expand defaults") was never built. |
| #124 | A bundle with empty required slots shows **configured** | `isConfigured = errors.length === 0 && (charges.length > 0 \|\| isBundleOffering)` at `:266`. `cpqValidationService.validateRelationships` checks only `CpqProductRelationship` cardinality, never `CpqBundleSlot`. XD-223 rules V-QBUN-1..4 were never built. |
| #125 | A valid line with no charges stays "incomplete" and shows no error | The same formula appears at `:266`, `:503-504` and `:1041-1042`. Every valid line with `charges.length === 0` is incomplete, and no `ValidationError` is added. The quote shows "Validation Issues" with an empty list. |

The formula is copied in three places (add, update, recalculate). The add and update copies are dead writes. Both paths finish with `recalculateInternal(save=true)` (`:364`, `:540`), which overwrites `isConfigured`. Only the recalculate copy (`:1041`) decides what is persisted and returned. A fix applied anywhere else has no effect.

## 📝 Prior spec drift

- **XD-223 §Add-to-Quote Flow and §Bundle Validation Rules (Quote-Time):** the spec describes auto-expansion and V-QBUN-1..5. The code has neither. This spec builds them.
- **XD-223 §Quote line `slot_id`:** the spec adds a `slot_id` column to quote lines. `CpqQuoteLineConfiguration` has no such column. This spec **does not add it** (see Proposed Solution).
- **V-QBUN-5 (cascade delete):** this one is already built. `removeQuoteLineTree` removes descendant lines.

## 📝 Proposed Solution

### 1. Bundle setup (#122)

- **Offering type follows the specification.** In `cpqProductOfferingCreateSchema`, `offeringType` becomes `.optional()` with no default. On POST, the route sets `offeringType = body.offeringType ?? spec.specType`, and V-OFF-7 still applies when the field is sent. The update schema already uses `partialWithoutDefaults`, so it is not affected.
- **UI:** both create forms (the offering page, and the Offerings tab on the specification page) stop sending a hardcoded type. They show the type, taken from the selected specification, as a read-only tag. After save, the form uses the type the server returned (the code already does this at `:389`).
- **Re-adding a component:** per **Q4**. `addComponent` / `offering-components` POST map errors as follows: not found → 404, `V-*` → 400, Postgres unique violation (`23505`) → 409 `V-COMP-5`.

### 2. One rule for "configured" (#125, needed by #124)

Create a pure function `lib/lineCompleteness.ts → evaluateLineCompleteness(input): { isConfigured, errors }`. `recalculateInternal` calls it. The dead add and update computations (`:266`, `:503-504`) are **deleted**, not routed through the function, because the recalculation that follows overwrites them anyway. The `:1041` copy is replaced by the call.

Bundle-slot errors need the whole set of lines, so `recalculateInternal` runs `validateBundleSlots` (§4) as a **first pass, before the per-line loop**, and hands each line its `bundleSlotErrors`. Price-adjustment errors (`:1061-1068`) keep their current post-step. That step still sets `isConfigured = false` after the function has run, and this is documented in the function's JSDoc.

```
input: { attributeErrors, charges, offeringHasChargeDefinitions, isBundleOffering,
         isArcMirrored, isArcCancelled, bundleSlotErrors }
isConfigured =
  isArcCancelled                                   // unchanged: removal lines are complete
  || ( attributeErrors.length === 0
       && bundleSlotErrors.length === 0             // new (#124)
       && ( charges.length > 0
            || isArcMirrored
            || isBundleOffering                     // the bundle line itself may have no charges
            || !offeringHasChargeDefinitions ))     // #125, per Q3=B
errors += V-LINE-1 when the line is not configured only because no charge applied
```

`offeringHasChargeDefinitions` must use the same keys as pricing (`cpqPricingService.ts:92-98`): `offeringId` when set, otherwise `productId`. It is computed with one batched query per recalculation over all keys on the quote (`CpqProductCharge {isActive, deletedAt: null}`), not one query per line. A line with **neither** offering nor product is treated as having charge definitions, so it stays incomplete as today, unless it is an ARC mirror line.

### 3. Default components on add (#123)

`addQuoteItemInTransaction` gets `expandBundleDefaults` (per **Q1**). When it is true and the offering is a bundle with `action = 'add'`:

1. Call `cpqBundleService.resolveBundleTree(offeringId, scope)` once. The service is already in DI; inject it into `DefaultCpqQuotingService`. Skip child offerings that are inactive or deleted: the tree filters component rows, not child offerings (`cpqBundleService.ts:457-466`).
2. For each slot **group** (cardinality is defined per group, V-SLOT-3), take the active `isDefault` components in `sortOrder` order. Stop at the group's `cardinalityMax`.
3. Create one child line per default component. Factor the line-creation part of `addQuoteItemInTransaction` into a private `createLine(em, cpqConfig, input)` helper, and call it with `parentLineId = bundle line`, `quantity = 1`, `configuration = {}` and the parent's `targetSubscriptionId` (ARC). Line numbers come from a running counter seeded once from the existing line count; today each add re-queries the count (`:272-278`), which would hand out duplicate numbers inside one transaction. The new lines are flushed **without** recalculating.
4. If a default child is itself a bundle, repeat steps 2–3 for it (XD-223 step 3). `resolveBundleTree` already guards against cycles.
5. Recalculate **once**, at the end, in the same `writeQuote` transaction. The response is the whole quote, as today.

A default child with required attributes is created without them and is incomplete with attribute errors. That is the intended prompt for the user to fill them in.

### 4. Slot validation on quotes (#124)

Add `validateBundleSlots({ lines, scope })` to `cpqValidationService`. It runs in `recalculateInternal` next to `validateRelationships`. Per bundle line, recursively (V-QBUN-4):

- **Mapping a child line to its slot:** use the bundle's **active** `CpqOfferingComponent` row (`deletedAt: null`, `isActive: true`) where `childOfferingId === child.offeringId`. V-COMP-5 makes that row unique per bundle, so no `slot_id` column is needed. The column was designed in XD-223 but dropped (see Data Model).
- **Add-ons are not components.** Some child lines match no component but are allowed by a `parent_child` `CpqProductRelationship` from the bundle's spec (`cpqValidationService.ts:152-156`; the AI tool describes `parentLineId` as "bundle child or add-on"). These are left to `validateRelationships` and are neither counted in a slot nor flagged.
- Count children per slot **group**. Lines cancelled by ARC are not counted.
- **ARC mirror bundles are grandfathered.** A bundle line mirrored from a live subscription (`_arcMirroredFromItemId`) may predate expansion and have fewer children than its slots require. V-QBUN-1/2 are raised on it only when this quote changes its children (a child is cancelled or added). Otherwise renewals of legacy subscriptions would be blocked.
- Errors use `type: 'bundle_slot'` (extending the `ValidationError['type']` union), with `lineId` set to the bundle line and `slotGroup` / `slotName` as fields. `ValidationError` has no `code` field, so the code is the message prefix, following the existing `V-*` convention:
  - `V-QBUN-1` — "*{slot}* requires at least {min} component(s) ({n} selected)"
  - `V-QBUN-2` — "*{slot}* allows at most {max} component(s) ({n} selected)"
  - `V-QBUN-3` — set on the **child** line: "*{offering}* is not a component of bundle *{bundle}*" (not raised for relationship add-ons, see above)
- The bundle line's slot errors feed `bundleSlotErrors` in §2, so the line is incomplete and the quote status becomes `incomplete`.
- **Enforcement** per **Q2**. With B, `cpqOrderService.convertFromConfig` returns 422 `BUNDLE_INCOMPLETE` when the quote's **stored** `validationResult.errors` contains `type: 'bundle_slot'` entries. Conversion does not recalculate, and `cpqOrderService` has no quoting service, so the guard reads stored state, the same way `storedAdjustmentFailure` does at `:180`. Every quote write already recalculates and persists, so the stored state is current. Cancelled and rejected quotes are still blocked first, as today.

### Alternatives rejected

- **Add a `slot_id` column to quote lines (XD-223).** It needs a migration and a backfill, and it creates a second source of truth that can disagree with the component catalog. The component mapping is already unique per bundle. Revisit if V-COMP-5 is ever relaxed (the same child in two slots).
- **Expand defaults in the browser (Q1-C).** Agents and API clients would not get it, and it is not atomic.
- **Patch each `isConfigured` copy in place.** That is how the copies drifted apart in the first place.

## 📝 Delta

### Capability: cpq-offering-create
- **MODIFIED** — *An offering's type must match its specification's type (V-OFF-7).*
  - WHEN `POST /api/cpq/product-offerings` omits `offeringType` THEN the offering is created with `offeringType = spec.specType`.
  - WHEN `offeringType` is sent and differs from `spec.specType` THEN the route returns 400 `V-OFF-7` (unchanged).
  - Frozen by: new `api/product-offerings/__tests__/create-offering-type.test.ts` (characterization of the current 400 written first).

### Capability: cpq-bundle-components
- **MODIFIED** — *A child offering is at most one active component of a bundle (V-COMP-5).*
  - WHEN a component is removed and the same child is added again THEN it succeeds with 201.
  - WHEN the offering, slot or child is missing THEN the route returns 404, not 500.
  - WHEN a concurrent duplicate hits the unique index THEN the route returns 409 `V-COMP-5`.
  - Frozen by: `services/__tests__/cpqBundleService.test.ts` (extend it).

### Capability: cpq-quote-bundle-lines
- **ADDED** — *Default components are added with the bundle line.*
  - WHEN a bundle offering is added with `expandBundleDefaults: true` THEN each active `isDefault` component (capped at the slot group's `cardinalityMax`) becomes a child line, recursively for nested bundles, in one transaction.
  - WHEN `expandBundleDefaults` is omitted THEN only the bundle line is created (unchanged for every existing caller).
- **ADDED** — *Bundle slot cardinality is validated on quotes (V-QBUN-1..4).*
  - WHEN a required slot group has fewer component lines than `cardinalityMin` THEN the bundle line is not configured, the quote is `incomplete`, and a `V-QBUN-1` error names the slot.
  - WHEN a slot group has more than `cardinalityMax` THEN a `V-QBUN-2` error is returned.
  - WHEN a child line's offering is not a component of its bundle and no `parent_child` relationship allows it THEN a `V-QBUN-3` error is set on the child.
  - WHEN an ARC-mirrored bundle's children are unchanged by the quote THEN no V-QBUN-1/2 is raised for it.
- **MODIFIED** — *A bundle line is configured when its attributes are valid (`isBundleOffering` short-circuit).* It now also requires no slot errors.
  - Frozen by: new `services/__tests__/lineCompleteness.test.ts` plus extended `cpqQuotingService` tests.

### Capability: cpq-quote-line-completeness
- **MODIFIED** — *A line is configured only when it has valid attributes and at least one charge.*
  - WHEN the attributes are valid and the offering has no active charge definitions THEN the line is configured at price 0.
  - WHEN the offering has charges but none applies THEN the line is not configured and gets error `V-LINE-1`.
  - WHEN a line is not configured THEN at least one `ValidationError` names the reason (no more silent "incomplete").
  - Frozen by: `services/__tests__/cpqQuotingService.test.ts` (characterize today's persisted `isConfigured` after recalculation first).

### Capability: cpq-quote-conversion (Q2 = B)
- **MODIFIED** — *Any quote that isn't cancelled or rejected converts.*
  - WHEN the stored `validationResult.errors` contains `type: 'bundle_slot'` THEN conversion returns 422 `BUNDLE_INCOMPLETE` and lists those errors.
  - WHEN the quote is invalid for other reasons only THEN conversion behaves as today.
  - Frozen by: `services/__tests__/cpqOrderService.test.ts` (extend it).

## 📝 Architecture

Everything stays inside `@dainamite/cpq`, with no new cross-module imports. `DefaultCpqQuotingService` gets `cpqBundleService` through DI (`di.ts`). `cpqValidationService` reads `CpqBundleSlot` and `CpqOfferingComponent`, which are CPQ entities. The order conversion change (Q2) is inside `cpqOrderService`.

Consumers affected:
- **Admin quote page:** sends `expandBundleDefaults: true` whenever it adds a bundle offering, root or nested; its own "+ component" buttons post without the flag. It shows V-QBUN errors under the bundle's slot header. The `filledCount / min` badge already exists; it turns red when the slot is short.
- **Puffin calculator:** no request change. It posts slot children as root lines, so they are not under a bundle and V-QBUN does not apply to them. Its fallback cart, the bundle line alone, now shows V-QBUN-1 when the bundle has required slots. See Risks.
- **Wizard steps** (`workflows/steps/OfferingSelectStep.tsx:310`, `ProductConfigureStep.tsx:153`): both send `expandBundleDefaults: true` when the chosen offering is a bundle, so wizard quotes get complete bundles instead of turning `incomplete`.
- **Seeds** (`demo_puffin/seeds/seeders/examples.ts`, `demo_gix/seeds/examples.ts:89` which converts quotes): run them in Phase 3 verification. Any seeded bundle quote must be complete, or its conversion will now fail (Q2-B).
- **AI agent `cpq.add_quote_line`:** gains `expandBundleDefaults` (described as: "set true when adding a bundle unless you will add its components yourself"). Its approval preview (`previewAddLine`, `ai-tools/quotes-pack.ts:190-197`) must count the default lines too; otherwise the operator approves an understated change.
- **ARC (XD-250):** mirror lines are never auto-expanded (their `action` is not `add`). Slot counting leaves out ARC-cancelled lines, so removing a required component in an amend now shows V-QBUN-1. That is the intended outcome. Untouched legacy bundles are grandfathered (§4).

## 📝 Data Model

- **Q4 = A:** a migration created with `yarn mercato db generate` (never hand-written) drops `cpq_off_comp_unique` and recreates it as a partial unique index `… WHERE deleted_at IS NULL`. The entity decorator changes from `@Unique` to `@Index({ name, properties, expression: 'CREATE UNIQUE INDEX … WHERE "deleted_at" IS NULL' })`, following `cpq-billing-connector/.../data/entities.ts:24`. The current rule is a table **constraint**, so check that the generated SQL uses `drop constraint`, not `drop index`. The migration ships in `packages/cpq/src/modules/cpq/migrations/`. Log it in `packages/cpq/MIGRATION.md`.
- No new columns. `slot_id` on quote lines stays out of scope (see Alternatives).
- No sensitive data is added.

## 📝 API Contracts

| Route | Change | Compatibility |
|---|---|---|
| `POST /api/cpq/product-offerings` | `offeringType` becomes optional; it defaults to `spec.specType` | Additive. Clients that send `'simple'` for simple specs see no change. |
| `POST /api/cpq/offering-components` | Not found → 404; duplicate race → 409 `V-COMP-5` (was 500) | Status codes improve; `openApi` `errors` updated |
| `POST /api/cpq/quotes/:id/items` | New optional `expandBundleDefaults: boolean` (default `false`) | Additive (Q1-B) |
| `GET/POST quote responses` | `validationResult.errors[]` may contain `type: 'bundle_slot'` items with `slotGroup`, `slotName` and codes `V-QBUN-1..3`, `V-LINE-1` | Additive union member. The UI tolerates unknown types today: it renders `message`. |
| `POST /api/cpq/orders` (quote → order, Q2-B) | New 422 `BUNDLE_INCOMPLETE` when the stored validation has bundle-slot errors | **Behavior change.** Add it to `CHANGELOG.md` (changeset: minor). |

Every changed route updates its typed `openApi` export. `openapi-coverage.test.ts` must stay green.

## 📝 UI/UX

- **Offering create** (both entry points): a read-only **Type** tag (Simple / Bundle) that follows the selected specification. The user never edits the type.
- **Quote line → bundle expanded:** slots with errors show the `V-QBUN` message in the slot header row. The `0/1 (min 1)` counter gets the `error` tag variant. A line that isn't configured lists its errors, including `V-LINE-1`, in the existing line validation area.
- No new pages. Mockups were skipped because the changes reuse existing components: one read-only tag and error-text placement.

## 📝 Edge Cases & Failure Scenarios

| Case | Behavior |
|---|---|
| A slot group has more defaults than `cardinalityMax` | The first `max` defaults by `sortOrder` are added. The rest are skipped silently, which is a configuration choice of the catalog author. |
| A slot group has fewer defaults than `cardinalityMin` | The defaults are added, and the bundle shows V-QBUN-1 until the user adds the rest. |
| A default child is inactive, deleted or `deprecated` | Inactive and deleted component rows are filtered by `resolveBundleTree`. Inactive child offerings are skipped by the expansion loop. Deprecated child offerings are **still added**: catalog lifecycle is not a quoting blocker today. |
| A nested bundle default (a bundle inside a bundle) | Expanded recursively. The cycle guard in `resolveBundleTree` stops at an offering it has already visited. |
| A default child has required attributes | Its line is created incomplete with attribute errors, and the bundle shows the child's state. |
| Expansion fails halfway (pricing throws) | Everything runs inside one `writeQuote` transaction. Nothing persists, and the error surfaces as today. |
| A child line was added through the API under a bundle but isn't a component | V-QBUN-3 on the child and the quote is incomplete, unless a `parent_child` relationship allows it as an add-on. |
| An Amend/Renew of a subscription sold before expansion existed | The mirrored bundle is grandfathered and gets no V-QBUN-1/2 unless the quote changes its children. |
| A catalog author removes a component that quotes already use | Existing quote lines get V-QBUN-3 on the next recalculation. Expected: the catalog changed under the quote. |
| A slot group spread over two slots (V-SLOT-3) | Counting is per group (sum over its slots). The UI badge stays per slot, and the error text names the group. |
| The Puffin fallback cart (bundle line alone, required slots) | The quote is now `incomplete` with V-QBUN-1. The transition to `with_customer` still succeeds (Q2-B), so the calculator keeps working; conversion of that quote is blocked until it is completed. |

## 📝 Risks & Impact Review

- **Puffin and demo quotes:** any seeded quote or calculator cart with an under-filled required slot turns `incomplete` after its next recalculation. Before merge, run `yarn mercato demo_tenants seed --all` and the Puffin calculator integration tests, and fix the seed data rather than weakening the rule.
- **Q2-B makes conversion stricter.** Quotes with incomplete bundles that converted before now fail with 422. Other invalid states are unaffected. This is intentional and reversible (drop the guard), and it is documented in the changelog. Known caller: `demo_gix/seeds/examples.ts:89`.
- **Migration (Q4-A):** dropping and recreating a unique constraint is safe on existing data. The current constraint is stricter than the new index. Rollback recreates the full constraint, which fails if two rows now exist for the same pair (one deleted, one live). The `down()` migration therefore dedupes first or documents that rollback is not possible.
- **Performance:** `validateBundleSlots` adds two batched queries per recalculation (slots plus components for the bundle offering ids on the quote). Expansion adds one `resolveBundleTree` call (N+1 per level, bounded by catalog size), and only on add.
- **Product decisions in play:** the free status transitions (Q2) and catalog writes for agents (Q5). These are direction calls, not defects.

## 📋 Phasing

- **Phase 1 — Bundle setup (#122).** The offering type follows the specification; re-adding a component works; error status codes are fixed. Ships alone.
- **Phase 2 — One completeness rule (#125).** `evaluateLineCompleteness` replaces the three copies; zero-charge offerings become configured (Q3); V-LINE-1 is added. Ships alone.
- **Phase 3 — Bundle quoting (#123, #124).** Default expansion (Q1), V-QBUN validation, UI error display, conversion guard (Q2). Depends on Phase 2.

## 📋 Implementation Plan

**Phase 1 — Bundle setup (#122)**
1. Characterization: a test showing that POST with no `offeringType` against a bundle spec returns 400 today.
2. Validator: remove `.default('simple')` from `offeringType`. Route: default to `spec.specType`. Update `openApi`. Unit tests: omitted → spec type; mismatch → 400.
3. UI: both create forms drop the hardcoded type and show a read-only tag from the selected spec. Add i18n keys to `i18n/*.json`.
4. Entity: `cpq_off_comp_unique` → partial unique index; run `yarn mercato db generate`; review the SQL; log it in `MIGRATION.md`.
5. `addComponent` / route: not found → 404, `23505` → 409. Tests: remove then re-add succeeds; a missing slot returns 404.
6. Playwright: create a bundle spec → slot → bundle offering from the UI → add, remove and re-add a component. (Covers #122 "add a UI/integration test".)

**Phase 2 — Completeness rule (#125)**
1. Characterization tests that freeze today's persisted `isConfigured` after add, update and recalculate. All three end in `recalculateInternal`.
2. `lib/lineCompleteness.ts` + unit tests (table-driven: valid without charge definitions → configured; charges defined but none applicable → V-LINE-1; ARC cancelled; mirrored; bundle).
3. Batch-load `offeringHasChargeDefinitions` (offering, else product keys) in `recalculateInternal`. Call the shared function there. Delete the dead add and update computations.
4. Service tests: a zero-charge assetizable offering with valid attributes → configured, and quote `ready`.

**Phase 3 — Bundle quoting (#123, #124)**
1. Extend `ValidationError` (`type: 'bundle_slot'`, `slotGroup`, `slotName`). Add `validateBundleSlots` with unit tests for V-QBUN-1..4. Cover counting by slot group, leaving out ARC-cancelled lines, inactive components, `parent_child` add-ons not being flagged, and grandfathering of ARC mirror bundles.
2. Wire it into `recalculateInternal` as a first pass before the line loop → `bundleSlotErrors` → `evaluateLineCompleteness`. Test: a bundle with an empty 1..1 slot → incomplete with a V-QBUN-1 error naming the slot.
3. Factor out the `createLine` helper, taking a line-number counter (no behavior change; the existing tests must stay green).
4. Add `expandBundleDefaults` to `cpqAddQuoteItemSchema` and the route `openApi`. Inject `cpqBundleService`. Expansion loop: recursive, capped at max, one recalculation. Tests: two 1..1 slots with defaults → 2 children and quote `ready`; flag omitted → 1 line; nested bundle; cap at max.
5. `cpq.add_quote_line` AI tool: add the field with `.describe()`. Make `previewAddLine` include the default lines in its count. Update the tool test and the agent prompt note.
6. Admin quote page and wizard steps (`OfferingSelectStep`, `ProductConfigureStep`): send the flag whenever a bundle offering is added. Render slot errors and the error-variant counter.
7. (Q2-B) Conversion guard on the stored bundle-slot errors, plus a `cpqOrderService` test and a changeset entry. Run `yarn mercato demo_tenants seed --all` and fix any seeded bundle quote that fails conversion.
8. Playwright: add a bundle with defaults to a quote → children present, line configured. Remove a required child → V-QBUN-1 shown and conversion returns 422.
9. Update `manuals/xd-223-bundled-offerings.md` (quoting section) and add a lesson to `.ai/lessons.md` (the partial unique index for soft-deleted rows; `.default()` in the create schema hides "omitted").

**Archive:** after merge, add the outcome of each Delta to this spec's Changelog. Then close #122–#125 from the implementation PRs, not from this spec PR.

## Changelog

- 2026-11-17 — Draft spec for #122–#125.
- 2026-11-17 — Open Questions Q1–Q6 resolved with the recommended defaults; Q2 and Q5 flagged ⚠ for human confirmation.
- 2026-11-17 — Revised after an independent review against the code: conversion guard reads stored state and covers bundle-slot errors only; slot validation runs before the line loop; dead add/update `isConfigured` writes deleted; add-ons via `parent_child` exempt from V-QBUN-3; ARC legacy bundles grandfathered; wizard steps and AI preview added to scope; Puffin rationale corrected.
