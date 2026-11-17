# CPQ bundles: setup fixes and honest quote-line completeness

Extends: `specs/implementation/xd-223-bundled-offerings.md` (Add-to-Quote Flow, V-QBUN-1..5 — designed, never built)
Extends: `specs/implementation/xd-201-quoting.md` (line `isConfigured` / quote `cpqStatus`)

Issues: #122, #123, #124, #125 · Package: `@dainamite/cpq` · Status: **Draft — Open Questions pending**

## 📝 TLDR

Bundles can't be set up or quoted end to end today. Bundle offerings can't be created in the admin UI. A removed component can't be re-added. Adding a bundle to a quote creates no default component lines. A bundle with empty required slots shows as "configured". A valid line for an offering with no charges can never become "configured", and nothing says why.

**Proposed:** fix the two setup defects (#122). Build the add-to-quote expansion and the quote-time slot validation that XD-223 designed but never built (#123, #124). Replace the three copies of the `isConfigured` formula with one rule that handles zero-charge offerings and always says why a line is incomplete (#125).

## ❓ Open Questions (answer before implementation)

Each question has a **recommended** answer. Reply with the question number and your choice, e.g. "Q1 A, Q2 B, …". Recommended answers are marked ★.

| # | Question | Options | ★ Recommendation and why |
|---|---|---|---|
| **Q1** | Which callers get default components when a bundle line is added? | **A** — every `POST …/items` for a bundle offering (the API default becomes "expand").<br>**B** — opt-in flag `expandBundleDefaults` on `POST …/items`; it defaults to `false`. The admin quote page and the `cpq.add_quote_line` AI tool send `true`.<br>**C** — only the admin UI does it, client-side. | **B ★.** The Puffin public calculator (`demo_puffin/api/cloud-pricing-calculator/quotes/route.ts`) already posts the bundle line and then each child line with `parentLineId`. Its seeded bundles have `isDefault` components (`demo_puffin/seeds/seeders/bundles.ts`). Under **A**, every Puffin quote gets duplicate child lines and goes over the slot maximum. **B** is additive and changes no existing contract. **C** puts domain logic in the UI and leaves agents and API clients without it. |
| **Q2** | How strictly should an incomplete bundle (empty required slot, too many components, a component not allowed in the bundle) be enforced? | **A** — line and quote become `incomplete` with a V-QBUN error that names the slot. No transition is blocked.<br>**B** — A, plus **quote → order conversion** returns 422 while the quote has errors.<br>**C** — B, plus submit-for-approval (`in_approval` / `pre_approved` / `with_customer`) returns 422. | **B ★.** #124 asks to block submission and conversion. But `types.ts:66` and `cpqQuotingService.ts:907` record a product decision to "let operators jump between any pair of statuses", and the Puffin flow moves quotes straight to `with_customer`. Blocking conversion stops an incomplete bundle from becoming a broken subscription, and it does not reopen the status-jump decision. **C** overturns that decision; it needs a product-owner call. |
| **Q3** | When is a valid line for an offering with no charges "configured" (#125)? | **A** — always: a valid line with no charges is configured, at price 0.<br>**B** — configured only when the offering has **no active charge definitions**. If it has charges but none applies to the configuration, the line stays incomplete with error `V-LINE-1: No charge applies to this configuration`.<br>**C** — configured only for assetizable offerings or bundle components. | **B ★.** Included equipment priced at zero (CPE/ONT) is a normal, intended case. A pricing gap is not: an offering with charges whose applicability conditions all evaluate false. **A** would silently quote such gaps at 0. **C** is an arbitrary rule that does not cover a standalone free add-on. With **B** every incomplete line has a stated reason. |
| **Q4** | How do we fix "re-add after remove returns 500" (#122 bug 2)? | **A** — migration: make `cpq_off_comp_unique` partial (`WHERE deleted_at IS NULL`).<br>**B** — no schema change: `addComponent` revives the soft-deleted row (clears `deletedAt`, updates `slotId` / `isDefault` / `sortOrder`).<br>**C** — both. | **A ★.** This matches the soft-delete convention already used elsewhere (`billing` uses partial `WHERE "deleted_at" IS NULL` indexes). Removed rows stay as history, and a re-add creates a fresh row with a new id. The migration runs after a package upgrade. In every option, a unique-violation race maps to **409**, and the plain `Error('… not found')` throws map to **404**, never 500. |
| **Q5** | The agent rule ("every changed route ships with its AI tool") applies to the routes we touch. `POST /product-offerings` and `POST /offering-components` have **no write tool today**: `catalog-pack` is read-only. | **A** — update only `cpq.add_quote_line` (the new `expandBundleDefaults` field). Record in the PR why the catalog write routes are left out.<br>**B** — A, plus new `cpq.create_offering` and `cpq.add_bundle_component` write tools. | **A ★.** The catalog routes change in a backward-compatible way (an optional field, better status codes). Opening catalog writes to agents is a separate product decision and needs its own allowlist and approval review. File it as a follow-up issue. |
| **Q6** | One spec covers four issues. Deliver as one PR or three? | **A** — one PR.<br>**B** — three PRs in phase order: (1) #122 setup, (2) #125 + the shared `isConfigured` rule, (3) #123 + #124 bundle expansion and validation. | **B ★.** Each phase can ship and be tested on its own. Phase 1 alone unblocks demo setup. Phase 3 depends on phase 2's single rule. |

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

The formula is copied in three places (add, update, recalculate), and the copies have already drifted: `isArcMirrored` is missing in the add path. Any fix that patches only one copy reopens the bug.

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

Create a pure function `lib/lineCompleteness.ts → evaluateLineCompleteness(input): { isConfigured, errors }`. It is called from add, update and recalculate. The `:266 / :503 / :1041` copies are deleted.

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

`offeringHasChargeDefinitions` costs one extra query per line. `count(CpqProductCharge {offeringId, isActive, deletedAt:null})` is batched once per recalculation for all offering ids on the quote. It is not run per line.

### 3. Default components on add (#123)

`addQuoteItemInTransaction` gets `expandBundleDefaults` (per **Q1**). When it is true and the offering is a bundle with `action = 'add'`:

1. Call `cpqBundleService.resolveBundleTree(offeringId)` once. The service is already in DI. Inject it into `DefaultCpqQuotingService`.
2. For each slot **group** (cardinality is defined per group, V-SLOT-3), take the active `isDefault` components in `sortOrder` order. Stop at the group's `cardinalityMax`.
3. Create one child line per default component. Factor the line-creation part of `addQuoteItemInTransaction` into a private `createLine(em, cpqConfig, input)` helper, and call it with `parentLineId = bundle line`, `quantity = 1`, `configuration = {}` and the parent's `targetSubscriptionId` (ARC). The new lines are flushed **without** recalculating.
4. If a default child is itself a bundle, repeat steps 2–3 for it (XD-223 step 3). `resolveBundleTree` already guards against cycles.
5. Recalculate **once**, at the end, in the same `writeQuote` transaction. The response is the whole quote, as today.

A default child with required attributes is created without them and is incomplete with attribute errors. That is the intended prompt for the user to fill them in.

### 4. Slot validation on quotes (#124)

Add `validateBundleSlots({ lines, scope })` to `cpqValidationService`. It runs in `recalculateInternal` next to `validateRelationships`. Per bundle line, recursively (V-QBUN-4):

- **Mapping a child line to its slot:** use the bundle's `CpqOfferingComponent` row where `childOfferingId === child.offeringId`. V-COMP-5 makes that row unique per bundle, so no `slot_id` column is needed. The column was designed in XD-223 but dropped (see Data Model).
- Count children per slot **group**. Lines cancelled by ARC are not counted.
- Errors use `type: 'bundle_slot'` (extending the `ValidationError['type']` union), with `lineId` set to the bundle line and `slotGroup` / `slotName` as fields:
  - `V-QBUN-1` — "*{slot}* requires at least {min} component(s) ({n} selected)"
  - `V-QBUN-2` — "*{slot}* allows at most {max} component(s) ({n} selected)"
  - `V-QBUN-3` — set on the **child** line: "*{offering}* is not a component of bundle *{bundle}*"
- The bundle line's slot errors feed `bundleSlotErrors` in §2, so the line is incomplete and the quote status becomes `incomplete`.
- **Enforcement** per **Q2**. With B: `cpqOrderService.convertFromConfig` returns 422 `Quote has validation errors: …` when it recalculates and the quote is not valid. Cancelled and rejected quotes are still blocked first, as today.

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
  - WHEN `expandBundleDefaults` is omitted THEN only the bundle line is created (unchanged; the Puffin path).
- **ADDED** — *Bundle slot cardinality is validated on quotes (V-QBUN-1..4).*
  - WHEN a required slot group has fewer component lines than `cardinalityMin` THEN the bundle line is not configured, the quote is `incomplete`, and a `V-QBUN-1` error names the slot.
  - WHEN a slot group has more than `cardinalityMax` THEN a `V-QBUN-2` error is returned.
  - WHEN a child line's offering is not a component of its bundle THEN a `V-QBUN-3` error is set on the child.
- **MODIFIED** — *A bundle line is configured when its attributes are valid (`isBundleOffering` short-circuit).* It now also requires no slot errors.
  - Frozen by: new `services/__tests__/lineCompleteness.test.ts` plus extended `cpqQuotingService` tests.

### Capability: cpq-quote-line-completeness
- **MODIFIED** — *A line is configured only when it has valid attributes and at least one charge.*
  - WHEN the attributes are valid and the offering has no active charge definitions THEN the line is configured at price 0.
  - WHEN the offering has charges but none applies THEN the line is not configured and gets error `V-LINE-1`.
  - WHEN a line is not configured THEN at least one `ValidationError` names the reason (no more silent "incomplete").
  - Frozen by: `services/__tests__/lineCompleteness.test.ts` (characterize the current three copies first).

### Capability: cpq-quote-conversion (only if Q2 = B or C)
- **MODIFIED** — *Any quote that isn't cancelled or rejected converts.*
  - WHEN `validationResult.valid` is false after recalculation THEN conversion returns 422 and lists the errors.
  - Frozen by: `services/__tests__/cpqOrderService.test.ts` (extend it).

## 📝 Architecture

Everything stays inside `@dainamite/cpq`, with no new cross-module imports. `DefaultCpqQuotingService` gets `cpqBundleService` through DI (`di.ts`). `cpqValidationService` reads `CpqBundleSlot` and `CpqOfferingComponent`, which are CPQ entities. The order conversion change (Q2) is inside `cpqOrderService`.

Consumers affected:
- **Admin quote page:** sends `expandBundleDefaults: true` when adding a root bundle. It shows V-QBUN errors under the bundle's slot header. The `filledCount / min` badge already exists; it turns red when the slot is short.
- **Puffin calculator:** no change under Q1-B. Its quotes now get correct V-QBUN validation, which is a behavior change if any calculator cart under-fills a required slot. See Risks.
- **AI agent `cpq.add_quote_line`:** gains `expandBundleDefaults` (described as: "set true when adding a bundle unless you will add its components yourself").
- **ARC (XD-250):** mirror lines are never auto-expanded (their `action` is not `add`). Slot counting leaves out ARC-cancelled lines, so removing a required component in an amend now shows V-QBUN-1. That is the intended outcome.

## 📝 Data Model

- **Q4 = A:** a migration created with `yarn mercato db generate` (never hand-written) drops `cpq_off_comp_unique` and recreates it as a partial unique index `… WHERE deleted_at IS NULL`. The entity decorator changes to `@Index({ name, properties, expression: 'CREATE UNIQUE INDEX … WHERE "deleted_at" IS NULL' })`, following the `billing` precedent. The migration ships in `packages/cpq/src/modules/cpq/migrations/`. Log it in `packages/cpq/MIGRATION.md`.
- No new columns. `slot_id` on quote lines stays out of scope (see Alternatives).
- No sensitive data is added.

## 📝 API Contracts

| Route | Change | Compatibility |
|---|---|---|
| `POST /api/cpq/product-offerings` | `offeringType` becomes optional; it defaults to `spec.specType` | Additive. Clients that send `'simple'` for simple specs see no change. |
| `POST /api/cpq/offering-components` | Not found → 404; duplicate race → 409 `V-COMP-5` (was 500) | Status codes improve; `openApi` `errors` updated |
| `POST /api/cpq/quotes/:id/items` | New optional `expandBundleDefaults: boolean` (default `false`) | Additive (Q1-B) |
| `GET/POST quote responses` | `validationResult.errors[]` may contain `type: 'bundle_slot'` items with `slotGroup`, `slotName` and codes `V-QBUN-1..3`, `V-LINE-1` | Additive union member. The UI tolerates unknown types today: it renders `message`. |
| `POST /api/cpq/orders` (quote → order, Q2-B) | New 422 when the quote is invalid | **Behavior change.** Add it to `CHANGELOG.md` (changeset: minor). |

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
| A default child is inactive, deleted or `deprecated` | `resolveBundleTree` already filters out inactive and deleted components. Deprecated child offerings are **still added** (catalog lifecycle is not a quoting blocker today). Flag this if you disagree. |
| A nested bundle default (a bundle inside a bundle) | Expanded recursively. The cycle guard in `resolveBundleTree` stops at an offering it has already visited. |
| A default child has required attributes | Its line is created incomplete with attribute errors, and the bundle shows the child's state. |
| Expansion fails halfway (pricing throws) | Everything runs inside one `writeQuote` transaction. Nothing persists, and the error surfaces as today. |
| A child line was added through the API under a bundle but isn't a component | V-QBUN-3 on the child, and the quote is incomplete. |
| A catalog author removes a component that quotes already use | Existing quote lines get V-QBUN-3 on the next recalculation. Expected: the catalog changed under the quote. |
| A slot group spread over two slots (V-SLOT-3) | Counting is per group (sum over its slots). The UI badge stays per slot, and the error text names the group. |
| A Puffin cart under-fills a required slot | The quote is now `incomplete`. Under Q2-B the transition to `with_customer` still succeeds, so the calculator is not broken. |

## 📝 Risks & Impact Review

- **Puffin and demo quotes:** any seeded quote or calculator cart with an under-filled required slot turns `incomplete` after its next recalculation. Before merge, run `yarn mercato demo_tenants seed --all` and the Puffin calculator integration tests, and fix the seed data rather than weakening the rule.
- **Q2-B makes conversion stricter.** Quotes that converted before will now fail if invalid. This is intentional and reversible (drop the guard), and it is documented in the changelog.
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
1. Characterization tests that freeze today's three `isConfigured` results (add / update / recalculate), including the `isArcMirrored` drift on add.
2. `lib/lineCompleteness.ts` + unit tests (table-driven: valid without charge definitions → configured; charges defined but none applicable → V-LINE-1; ARC cancelled; mirrored; bundle).
3. Batch-load `offeringHasChargeDefinitions` in `recalculateInternal`; use the shared function in all three paths; delete the copies.
4. Service tests: a zero-charge assetizable offering with valid attributes → configured, and quote `ready`.

**Phase 3 — Bundle quoting (#123, #124)**
1. Extend `ValidationError` (`type: 'bundle_slot'`, `slotGroup`, `slotName`). Add `validateBundleSlots` with unit tests for V-QBUN-1..4, including counting by slot group and leaving out ARC-cancelled lines.
2. Wire it into `recalculateInternal` → `bundleSlotErrors` → `evaluateLineCompleteness`. Test: a bundle with an empty 1..1 slot → incomplete with a V-QBUN-1 error naming the slot.
3. Factor out the `createLine` helper (no behavior change; the existing tests must stay green).
4. Add `expandBundleDefaults` to `cpqAddQuoteItemSchema` and the route `openApi`. Inject `cpqBundleService`. Expansion loop: recursive, capped at max, one recalculation. Tests: two 1..1 slots with defaults → 2 children and quote `ready`; flag omitted → 1 line; nested bundle; cap at max.
5. `cpq.add_quote_line` AI tool: add the field with `.describe()`; update the tool test and the agent prompt note.
6. Admin quote page: send the flag on root bundle add; render slot errors and the error-variant counter.
7. (Q2-B) Conversion guard + `cpqOrderService` test; changeset entry.
8. Playwright: add a bundle with defaults to a quote → children present, line configured. Remove a required child → V-QBUN-1 shown and conversion returns 422.
9. Update `manuals/xd-223-bundled-offerings.md` (quoting section) and add a lesson to `.ai/lessons.md` (the partial unique index for soft-deleted rows; `.default()` in the create schema hides "omitted").

**Archive:** after merge, add the outcome of each Delta to this spec's Changelog. Then close #122–#125 from the implementation PRs, not from this spec PR.

## Changelog

- 2026-11-17 — Draft spec for #122–#125; Open Questions Q1–Q6 pending.
