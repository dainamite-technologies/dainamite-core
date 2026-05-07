---
name: cpq-arc
description: Amend / Renew / Cancel — operator changes a *live* subscription through a quote. Spawns a new ARC quote from a sub, attaches one or more sub targets, drives it through the standard approval ladder, converts to order, and on activation mutates the source subscription(s). Load whenever a task touches `quoteType` other than `'new'`, `CpqQuoteTargetSubscription`, `CpqSubscriptionChangeLog`, the ARC drawer (`ArcQuoteConfigurator.tsx`), `applyAmendment` / `applyRenewal` / `applyMergeRenewal` / `applyCancel`, or any of the `from-subscription`, `target-subscriptions`, `cancel-meta`, `merge-meta`, `change-log` API routes.
---

# CPQ — ARC (Amend / Renew / Cancel)

ARC reuses the entire Quote → Order pipeline (status ladder, approval gates,
convert, activate) but the order's activation, instead of creating a *new*
subscription, **mutates an existing one** (or, in the merge-renew case,
supersedes several into one).

## Mental model

```
                                  ┌─ amend  → modify items mid-term, term unchanged
sub.click("Amend / Renew /  ─┬─→  ├─ renew (standalone) → extend term, optional item edits
        Cancel")             │    ├─ renew (merge) → 2+ subs → 1 new sub + sources superseded
                             │    └─ cancel → terminate sub(s) with reason + optional ETF
                             │
                             ▼
                       /from-subscription  →  ARC quote (quoteType ∈ {amend, renew, cancel})
                                                  │
                                                  │  same status ladder as 'new':
                                                  │  new → ready → in_approval → approved
                                                  │     → with_customer → accepted
                                                  │
                                                  ▼
                                          /api/cpq/orders   (convert)
                                                  │
                                                  ▼
                                        /api/cpq/orders/[id]/activate
                                                  │
                                                  ├─ applyAmendment  per amend target
                                                  ├─ applyRenewal    per standalone-renew target
                                                  ├─ applyMergeRenewal  once for the absorbed group
                                                  └─ applyCancel     per cancel target
                                                  │
                                                  ▼
                                       CpqSubscriptionChangeLog row written;
                                       cpq.subscription.amended/renewed/
                                       cancelled/merged event emitted
```

## Canonical files

| Concern | File |
|---|---|
| Service — quote side | [`cpqQuotingService.ts`](../../../../src/modules/cpq/services/cpqQuotingService.ts) — `createQuoteFromSubscription`, `attachTargetSubscription`, `validateArcQuote`, `mirrorTargetSubscriptionItems` (helper), `pickArcMirrorCharges`, `buildRenewDefaults`, `resolveArcLineTargetSubscriptionId` |
| Service — apply side | [`cpqInventoryService.ts`](../../../../src/modules/cpq/services/cpqInventoryService.ts) — `applyAmendment`, `applyRenewal`, `applyMergeRenewal`, `applyCancel`, `applyLineChanges` (private), `snapshotSubscription` (private), `createChangeLog` (private) |
| Service — order routing | [`cpqOrderService.ts`](../../../../src/modules/cpq/services/cpqOrderService.ts) — activation routing per `quoteType`, `buildArcLineChange` (translator), `pickArcSourceFromConfig` |
| Entities | `data/entities.ts` — extra columns on `CpqQuoteConfiguration` (`quoteType`, `arcReasonCode`, `arcEtfAmount`, `arcMergeNew*`), `CpqQuoteLineConfiguration` (`targetSubscriptionId`, `sourceSubscriptionItemId`); `CpqQuoteTargetSubscription` (per-target row); `CpqSubscriptionChangeLog` (audit trail) |
| Validators | `data/validators.ts` — `cpqAttachTargetSubscriptionSchema`, `cpqCancelMetaSchema`, `cpqMergeMetaSchema`, `cpqChangeLogQuerySchema` |
| Events | `events.ts` — `cpq.subscription.amended/renewed/cancelled/merged/superseded` (typed) |
| Subscribers | `subscribers/subscription-{amended,renewed,cancelled,merged,superseded}-log.ts` (placeholder log handlers; downstream billing/notifications subscribes here) |
| API routes | `api/quotes/from-subscription/` (POST), `api/quotes/[quoteId]/target-subscriptions/` (GET/POST/DELETE), `api/quotes/[quoteId]/cancel-meta/`, `api/quotes/[quoteId]/merge-meta/`, `api/inventory/subscriptions/[subscriptionId]/change-log/`, `api/inventory/subscriptions/expiring/` |
| API helpers | `api/_helpers/handleArcError.ts` (error → JSON normaliser; duck-types `QuotingError` to survive Turbopack class drift) |
| UI — drawer | `backend/cpq/quotes/[id]/_components/ArcQuoteConfigurator.tsx` (right-side modal: `pick-targets → config-renew/cancel → review → submit`) |
| UI — quote detail (ARC additions) | `backend/cpq/quotes/[id]/page.tsx` — banner, multi-target Add Offering picker, per-line target badge, inline `Change Preview` (before/after) |
| UI — order detail (ARC additions) | `backend/cpq/orders/[id]/page.tsx` — header AMEND/RENEW/CANCEL badge, `ArcLineDiff` per line |
| UI — sub detail (ARC additions) | `backend/cpq/inventory/subscriptions/[id]/page.tsx` — Amend/Renew/Cancel buttons, `ChangeLogLineDetails` (per-line +/~/− glyphs, before→after MRC) |
| UI — Expiring view | `backend/cpq/inventory/subscriptions/expiring/page.tsx` (window-preset filter + cycle filter, Renew/Modify per row) |
| Seed | `lib/arc-example-seeds.ts` — 11 demo subs across all ARC scenarios under "Meridian Connectivity Sp. z o.o." (run via `seedExamples` opt-in, NOT in plain `seedDefaults`) |
| Manual | [`manuals/xd-250-arc-flow.md`](../../../../manuals/xd-250-arc-flow.md) — 11 click-by-click operator scenarios |
| Spec | [`specs/implementation/xd-250-arc-spec.md`](../../../../specs/implementation/xd-250-arc-spec.md) |
| Migration | `migrations/Migration20260504064621_cpq_arc.ts` |
| Integration tests | `__integration__/TC-CPQ-ARC-001.spec.ts` … `011.spec.ts` (cover amend, multi-target amend, merge renew, cancel + ETF, Expiring filter, concurrent rejection, renew-from-Expiring, suspended ARC, terminal-status gate, Change History empty, full lifecycle) |

## Hard rules — non-negotiable invariants

1. **`quoteType` is one-way.** Once a quote is created with
   `quoteType ∈ {amend, renew, cancel}`, it CANNOT transition back to `'new'`
   nor to a different ARC type. Enforced in the `PATCH /api/cpq/quotes/[quoteId]`
   handler. A quote that picked the wrong type must be deleted and recreated.

2. **Per-target rows always exist for ARC quotes.** `CpqQuoteTargetSubscription`
   is the source of truth for which sub(s) the quote acts on. A non-`new`
   quote with zero target rows is invalid and `validateArcQuote` rejects it
   on submit-for-approval.

3. **Line target tagging by quote type:**
   - `amend` / `cancel` / standalone-`renew` lines → `targetSubscriptionId`
     points at one of the attached targets.
   - merge-`renew` lines (≥2 absorb targets) → `targetSubscriptionId` MUST be
     `null` (the resulting merged sub doesn't exist yet at quote time).
   - Cross-target lines aren't supported — one line, one target.

4. **`sourceSubscriptionItemId` required for `modify` and `cancel` line actions.**
   `add` lines must omit it (no source item to mutate). The activation
   layer uses this to look up the existing item on the live sub.

5. **Merge mode must be coherent across the whole quote.** Either every
   target has `mergeAction: 'standalone'` (count = 1) or every target has
   `'absorb'` (count ≥ 2). The drawer auto-flips standalone→absorb when the
   2nd target is attached and re-tags any pre-existing lines'
   `targetSubscriptionId` to null.

6. **One ARC quote per subscription at a time** (concurrency). Both
   `createQuoteFromSubscription` and `attachTargetSubscription` call
   `ensureNoConcurrentArcQuote`; UI surfaces the conflict via a
   `window.confirm()` that can redirect to the existing quote.

7. **Optimistic locking on `subscription.version`** at activation. Two ARC
   orders racing on the same sub: second one fails 409, order stays in
   `pending_activation`, retryable. Surfaced as `Concurrent modification
   detected`. `handleArcError` maps both `instanceof OptimisticLockError`
   and constructor-name fallback (Turbopack class drift survival).

8. **Pre-generate UUIDs for new sub items in `applyLineChanges` and merge
   carry-over.** `CpqInventorySubscriptionItem.id` uses `defaultRaw:
   'gen_random_uuid()'` which only fires at INSERT — without an explicit
   `id:` the entity's id is `undefined` between `em.create()` and
   `em.flush()`. That breaks: (a) `summary.push({ itemId: item.id })` in
   change-log line summaries → UI falls back to "New item"; (b) asset rows
   that reference `subscriptionItemId: item.id`; (c) the `sourceItemToNewItem`
   map in `applyMergeRenewal` carry-over → translation fails and
   `applyLineChanges` 404s with "Subscription item ... not found on
   subscription ...". Same trick is needed in `createQuoteFromSubscription`
   for the parent-link map.

9. **Routes use `handleArcError`, not naive `instanceof QuotingError`.**
   Turbopack hot-reload produces two distinct class instances of the same
   error type across module boundaries, so `instanceof` returns `false` and
   the route falls through to a generic 500. `handleArcError` does both
   `instanceof` AND duck-typing on `name === 'QuotingError'` + numeric
   `status` field.

## Drawer flow + step state machine

`ArcQuoteConfigurator.tsx` is a self-contained right-side drawer. State
lives in component-local `useState` (no global store).

```
pick-action  ──► pick-targets  ──► (renew)  config-renew  ─┐
                       │           (cancel) config-cancel  ├──► review ──► submitting ──► done
                       │           (amend)        ─────────┘
                       └─ "Cancel" → close
```

Behaviour notes:
- `pick-action` is shown only when `initialType === 'new'`. From a sub's
  `Amend/Renew/Cancel` button, the type is fixed and the drawer enters at
  `pick-targets` with the current target pre-checked.
- Eligible-subs list is **filtered server-side** by the quote's `customerId`.
  Backend `attachTargetSubscription` re-validates customer + currency +
  (for merge) billing cycle.
- Renew config-step pre-fills with `buildRenewDefaults` (same length
  starting at current term end). Editing **Months** auto-recomputes **End**
  via `addMonthsToIso`; merge mode defaults **Start** to today via
  `todayIso`.
- Multi-target Add Offering uses checkbox list (default = all targets
  picked). Submitting fires one POST per checked target — backend creates
  one line per target, each tagged appropriately.

## What gets written to `CpqSubscriptionChangeLog`

| `changeType` | When | `beforeSnapshot` | `afterSnapshot` | `lineChanges` summary |
|---|---|---|---|---|
| `amend` | `applyAmendment` | sub state pre-mutation | sub state post-mutation | `{action, itemId, mrcDelta}` for actual deltas only |
| `renew` | `applyRenewal` | pre | post (+ `termChange`) | as above |
| `cancel` | `applyCancel` | pre | post (status=`terminated`) | `null` (UI derives from `beforeSnapshot.items`) |
| `merge-source` | `applyMergeRenewal` per source | pre | `null` (sources end terminal) | — |
| `merge-result` | `applyMergeRenewal` once on M | `null` (M is brand-new) | M's full state (+ `termChange`, `mergedFromSubscriptionIds`) | combined |

UI joining: the subscription detail page (`ChangeLogLineDetails`) reads the
log row's `lineChanges` array and resolves item names by looking up
`itemId` in `before/afterSnapshot.items` — that's why pre-generating the
new item id in `applyLineChanges` matters.

## ACL features (XD-250)

Add to `acl.ts` and wire in `setup.ts` `defaultRoleFeatures`:

```
cpq.arc.amend.manage          # gate quote_type='amend' creation/edit
cpq.arc.renew.manage          # gate quote_type='renew' (incl. merge) creation/edit
cpq.arc.cancel.manage         # gate quote_type='cancel' creation/edit
cpq.arc.changelog.view        # read CpqSubscriptionChangeLog per sub
cpq.inventory.expiring.view   # access the Expiring Subscriptions list
```

ARC quote approval (status transitions through the lifecycle) reuses
`cpq.quotes.manage` — no new approval feature.

## Common gotchas

- **`isMergeRenew` is a derived flag, not stored.** Compute it from
  `targets.length >= 2 && targets.every(t => t.mergeAction === 'absorb')`.
  Detach that drops back to 1 target auto-flips the remaining target's
  `mergeAction` back to `'standalone'`.

- **Mirror happens at every attach for ARC quotes.** `attachTargetSubscription`
  calls `mirrorTargetSubscriptionItems` after persisting the target row.
  When transitioning into merge mode (the standalone→merge flip),
  pre-existing lines are also re-tagged to `targetSubscriptionId: null`.

- **`charges` on a mirrored line.** If the source `CpqInventorySubscriptionItem`
  has explicit charges, they're copied. Otherwise a flat MRC + NRC pair is
  synthesised from `mrcAmount` / `nrcAmount` so quantity edits still scale
  correctly through `computeLineTotals`. Without this, editing quantity on
  an ARC mirror flipped the line to `incomplete` because
  `resolveProductCharges` returned `[]` for items with no offering / product.

- **Activation is per target.** Multi-target amend/cancel runs the
  corresponding `apply*` once per target subscription independently — each
  emits its own event and writes its own change-log row. `Inconsistent renew
  targets` error fires if a renew quote mixes `standalone` and `absorb`.

- **Frontend `ArcLineSource` is duplicated per page.** Both `quotes/[id]/page.tsx`
  and `orders/[id]/page.tsx` declare their own local `ArcLineSource` type
  matching the service-side `services/types.ts` `ArcLineSource`. Acceptable
  duplication — client components stay self-contained.

- **`buildArcLineChange.add` MUST carry `parentQuoteLineId`.** Otherwise
  bundle-component lines added through ARC end up as standalone sub items
  on activation. `applyLineChanges` then resolves the parentItemId from
  either an existing modify line's `sourceSubscriptionItemId` or another
  add line's pre-generated id (built in a `quoteLineToFinalItemId` map).

## Definition of Done — ARC-specific

On top of the generic CPQ DoD ([`../SKILL.md`](../SKILL.md) → "Definition of Done"):

- [ ] `validateArcQuote` updated if you added a new invariant
- [ ] If a new line action (currently {`add`, `modify`, `cancel`}) is
      introduced, its handling is added to `applyLineChanges` AND
      `buildArcLineChange` AND the change-log summary
- [ ] Manual scenario added/updated in `manuals/xd-250-arc-flow.md` if
      operator UX changed
- [ ] Spec section updated in `specs/implementation/xd-250-arc-spec.md`
      if a contract changed
- [ ] Integration test (`__integration__/TC-CPQ-ARC-*.spec.ts`) covers any
      new operator-facing scenario
- [ ] `MIGRATION.md` carries the entity change if a new column lands on
      ARC entities (target sub, change-log, quote-config ARC fields)
