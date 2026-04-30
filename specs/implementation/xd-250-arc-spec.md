# XD-250 — CPQ Amend / Renew / Cancel (ARC)

**Date**: 2026-04-24
**Status**: Approved — ready for implementation
**Owner**: Kamil

> **Domain parents**: [Quoting](../domains/quoting.md), [Product Inventory](../domains/product-inventory.md)
> **Blueprint ref**: `specs/blueprint.md` — Quoting and Product Inventory domains (extends their post-sale lifecycle surface)
> **Derives from**: XD-215 statement "future Modify/Add/Change/Delete flows require an inventory record to reference" — this spec is that MACD foundation, reframed as Amend/Renew/Cancel (ARC)
> **Dependencies**: XD-201 (Quoting — clone + approval), XD-215 (Customer Inventory — subscription lifecycle), XD-187 (Product Specification), XD-186 (Pricing Tables)
> **Supersedes**: the inline statement in XD-215 that "Amendments are modelled by adding new items to an existing subscription." This spec replaces that informal assumption with a formal **chain-based Amendment workflow** (see DD-ARC-1).
> **Existing implementation**: partial — see "What already works" below
> **New entities**: `CpqAmendmentRequest`, `CpqAmendmentChange`, `CpqRenewalTransaction`, `CpqCancellationRequest` in `src/modules/cpq/data/entities.ts`
> **New events**: `src/modules/cpq/events.ts` (NEW file — first events for CPQ module)
> **New services**: `cpqAmendmentService`, `cpqRenewalService`, `cpqCancellationService` in `src/modules/cpq/services/`
> **New APIs**: `src/modules/cpq/api/amendments/`, `src/modules/cpq/api/cancellations/`, `src/modules/cpq/api/renewals/`, subscription extensions under `src/modules/cpq/api/inventory/subscriptions/`
> **Packages consumed**: `@open-mercato/events`, `@open-mercato/scheduler`, `@open-mercato/queue`, `@open-mercato/shared` (all 0.4.10, already installed)
> **Out of scope (v1)**: refund execution (billing), dunning, bulk amendments, customer self-service UI, customer emails (separate notification module subscribes to events)

---

## TLDR

**Key Points:**
- Formalize **Amend**, **Renew**, and **Cancel** lifecycle operations for post-sale CPQ entities (active orders / subscriptions).
- Build on existing primitives: `cloneQuote` + `parentQuoteId`, line-level `action: add|modify|cancel`, subscription `currentTermEnd` + `autoRenew`, terminal `cancelled` status. Add: dedicated request entities, **chain model for both Amend and Renew**, scheduled execution, ETF support, proration event data, full audit trail.

**Scope (confirmed decisions from Q&A):**
- **Amend — chain model.** Amendment produces a new Quote → new Order → **new Subscription** linked to predecessor via `previous_subscription_id`. Predecessor subscription transitions to terminal status `amended`. Predecessor order transitions to `superseded` **only if it was `active`**; if `fulfilled`, it stays fulfilled (linkage recorded via `supersedes_order_id` on new order). Reuses existing quote lifecycle — cloned quote flows through `new → ready → in_approval → approved → with_customer → accepted`. Amendment executes when quote reaches `accepted` AND `effective_date ≤ now`. Amendment.executed event carries **proration data** (old MRC, new MRC, billing cycle info) for billing module to compute refund/charge deltas. (Q1, Q2, Q7)
- **Renew — chain model.** Every renewal creates a new subscription linked via `previous_subscription_id`. Predecessor transitions to `renewed`. Attached amendments modify terms of the NEW subscription. (Q3)
- **Cancel — two policies + ETF.** Supports `immediate` and `end-of-term` cancellation. Fixed ETF formula: `min(remaining_months × MRC × 0.5, 3 × MRC)`. No arbitrary-date scheduling, no proration/refund execution (billing downstream). (Q4, Q5.a)
- **Change tracking — snapshots + delta.** Cloned Quote (snapshot) + explicit `CpqAmendmentChange` records per line (delta). (Q5)
- **Scheduled effective dates.** Amendments support future `effective_date`; approving amendment with `effective_date ≤ now` executes inline (single transaction), future dates deferred to scheduler. Renewals scheduled by `currentTermEnd`. Cancellations execute immediately or at term end. (Q6)
- **Pricing strategy — per-transaction configurable.** `rate-lock` / `current-catalog` / `mixed`. Default on subscription (`default_renewal_pricing_strategy`), overridable per operation. (Q6, Q7)
- **Historic subscription visibility.** Chain preserved: old subscriptions queryable with items frozen at transition. Assets migrate forward by default; history via chain walk. (Q4)
- **Asset lifecycle on amendment** (Q2): `add-line` → new Asset `pending`; `remove-line` → existing Asset → `cancelled` (stays on OLD subscription for trace); `modify-line` / unchanged-line → Asset migrates FK to new subscription.
- **Subscription item lifecycle** (Q3): snapshot-per-subscription; new subscription gets new items from amended quote; old subscription's items transition to terminal (`amended` / `renewed` matching parent).
- **Single currency / single tenant per subscription** — no multi-currency ARC in v1. (Q8)

**Out of scope (v1):**
- Refund execution (billing owns math; CPQ emits proration data)
- Dunning / delinquency
- Bulk amendments
- Customer self-service UI (backoffice-only)
- Pre-sale quote revisions (handled by existing `cloneQuote`)
- Customer-facing notifications/emails (separate notification module listens to events)
- Advanced multi-step amendment (e.g., "change now + change again in 3 months") — single effective_date per amendment

---

## Current State (reference)

### Existing entities ([src/modules/cpq/data/entities.ts](../../src/modules/cpq/data/entities.ts))

| Entity | Relevant fields | Current lifecycle |
|--------|----------------|-------------------|
| `CpqQuoteConfiguration` | `quoteId`, `parentQuoteId` (self-ref), `cpqStatus`, `version` | `new → incomplete → ready → in_approval → pre_approved/approved → with_customer → accepted \| rejected \| cancelled` |
| `CpqQuoteLineConfiguration` | `action: add\|modify\|cancel`, `startDate`, `endDate`, `termMonths` | No standalone lifecycle |
| `CpqOrderConfiguration` | `orderId`, `sourceQuoteId`, `cpqStatus` | `draft → pending_activation → active → fulfilled \| cancelled` |
| `CpqOrderLineConfiguration` | `action: add\|modify\|cancel` | No standalone lifecycle |
| `CpqInventorySubscription` | `sourceQuoteId`, `sourceOrderId`, `status` (text), `billingCycle` (text, default 'monthly'), `currentTermEnd` (date), `autoRenew` (bool, default true), `termMonths` (int), `mrcAmount` (numeric(18,4) as string), `nrcAmount` (numeric(18,4) as string), `currencyCode` (text, default 'USD'), `customerId`, `activatedAt`, `suspendedAt`, `terminatedAt` | `pending → active ↔ suspended → terminated \| expired` (enforced by `INVENTORY_SUBSCRIPTION_TRANSITIONS` in types.ts) |
| `CpqInventorySubscriptionItem` | `subscriptionId`, `parentItemId`, `status` (text), `mrcAmount`/`nrcAmount`/`currencyCode`, `sourceQuoteLineId` | No formal transition map; item.status is cascaded from parent subscription by `transitionSubscriptionStatus` |
| `CpqInventoryAsset` | `subscriptionId`, `subscriptionItemId`, `status` (text), `sourceQuoteId`/`sourceOrderId`/`sourceQuoteLineId` | `pending → delivered → active → returned \| cancelled` (enforced by `INVENTORY_ASSET_TRANSITIONS` in types.ts) |

Important conventions discovered from code verification:
- Status columns are plain `text` with defaults — enums enforced by constants in [src/modules/cpq/services/types.ts](../../src/modules/cpq/services/types.ts), not DB-level
- Numeric amounts stored as string via `numeric(18,4)` — arithmetic requires parsing (e.g., `parseFloat` or Decimal library)
- Column naming: snake_case in DB (`mrc_amount`), camelCase in TS (`mrcAmount`)
- All entities are tenant-scoped via `organizationId` + `tenantId` FKs and soft-deleted via `deletedAt`
- Existing `version` column on Quote/Spec/Wizard is a plain integer counter (user-managed, e.g., `original.version + 1` in `cloneQuote`) — NOT MikroORM optimistic lock

### What already works (partial ARC, verified against code)

- **Amend (partial):** `cpqQuotingService.cloneQuote(quoteId, scope)` at [src/modules/cpq/services/cpqQuotingService.ts:501](../../src/modules/cpq/services/cpqQuotingService.ts#L501) — creates new `SalesQuote` (cross-module) + `CpqQuoteConfiguration` with `parentQuoteId = original.id`, `version = original.version + 1`, `cpqStatus = 'new'`. Copies all `CpqQuoteLineConfiguration` (and corresponding `SalesQuoteLine`). Recomputes pricing internally.
- **Renew (data only):** `autoRenew` (default `true`), `currentTermEnd` (nullable date), `termMonths` (nullable int) exist on `CpqInventorySubscription`; no execution logic, no scheduler.
- **Cancel (partial):** `cpqInventoryService.transitionSubscriptionStatus(id, 'terminated', scope)` at [src/modules/cpq/services/cpqInventoryService.ts:350](../../src/modules/cpq/services/cpqInventoryService.ts#L350) — transitions subscription status, cascades to items (`item.status = targetStatus`) and assets (→ `cancelled` on termination). No reason, effective date, policy, or ETF.
- **Quote approval flow (existing):** full quote lifecycle is `new → incomplete → ready → in_approval → pre_approved/approved → with_customer → accepted | rejected | cancelled`. Terminal states: `accepted`, `rejected`, `cancelled` (per `TERMINAL_STATUSES` in types.ts). `approved` is NOT terminal — it transitions to `with_customer → accepted`.

### Gaps filled by this spec

1. Dedicated ARC entities for auditable request/approval/execution cycle with retry + failure tracking
2. Renewal & Amendment automation (scheduler + chain model)
3. Cancellation metadata (reason, policy, effective date, ETF)
4. Explicit delta tracking (per-line amendment changes)
5. Proration data on amendment/renewal events
6. Two new terminal subscription statuses: `amended`, `renewed`
7. New terminal order status: `superseded`
8. Optimistic locking via `version` column on subscription (replaces ambiguous `term_version`)

---

## Proposed Solution

Three processes, each with a dedicated request entity, service, API, state machine, and event stream. Amend and Renew both use chain model; Cancel is terminal.

### Process 1: Amendment (post-sale modification, chain model)

```
Active Subscription ──► AmendmentRequest (draft)
                            │  user edits target lines, picks pricing_strategy, saves
                            ▼
                       AmendmentChange records created (delta)
                            │
                            ├─ type: 'change-config' | 'add-line' | 'remove-line' | 'change-term' | 'other'
                            ├─ effectiveDate (immediate or future)
                            ├─ pricing_strategy: 'rate-lock' | 'current-catalog' | 'mixed'
                            ├─ reason (code + text)
                            ▼
                       Cloned Quote generated (snapshot) via extended cloneQuote
                            │  amendment_request_id set, parentQuoteId = original CpqQuoteConfiguration.id
                            │  creates new SalesQuote (cross-module) + SalesQuoteLines
                            │  price computation respects pricing_strategy
                            │  quote starts in cpqStatus='new', user drives through approval:
                            │     new → incomplete → ready → in_approval → approved → with_customer → accepted
                            │  (short path also valid: ready → with_customer → accepted)
                            ▼
                       Amendment lifecycle tracks but is separate from quote:
                            AmendmentRequest.submit-for-approval → quote: ready → in_approval
                            AmendmentRequest.approve              → quote: in_approval → approved
                                                                  → quote: approved → with_customer → accepted
                                                                  (user-driven or auto in trusted flows)
                            When quote reaches 'accepted' AND effectiveDate ≤ now:
                            ├─ execute() called inline
                            └─ else deferred; scheduler picks up
                            ▼
                       execute() (atomic, transactional):
                            ├─ New Order created (amendment_request_id, supersedes_order_id = original)
                            ├─ Original Order: if 'active' → 'superseded'; if 'fulfilled' → stays fulfilled
                            ├─ New Subscription created:
                            │    previous_subscription_id = original, source_amendment_id = amendment
                            │    items snapshot from amended quote
                            │    currentTermEnd inherited from source
                            │    status = active, version = 1
                            │    inherits: customer_id, org/tenant_id, currency, billingCycle,
                            │              autoRenew, default_renewal_pricing_strategy
                            ├─ Original Subscription: status = amended
                            ├─ Assets handled per line-change rules (see Asset & Item Handling)
                            ├─ Items handled per line-change rules (see Asset & Item Handling)
                            ├─ AmendmentRequest.status = executed
                            ▼
                       Event: cpq.amendment.executed (with proration payload)
```

### Process 2: Renewal (chain model)

```
Scheduler (daily cron)
  └─► scans subscriptions where currentTermEnd within lookahead window (default 7 days)
      AND autoRenew = true AND status = 'active' AND no non-terminal cancellation/amendment
         │
         ▼
      RenewalTransaction created (status=scheduled, scheduled_for=currentTermEnd)
         │   pricing_strategy = attached amendment's strategy OR
         │                      subscription.default_renewal_pricing_strategy
         │
         │  If amendment attached (manual renewal path):
         │     AmendmentRequest linked, amended terms applied to NEW subscription
         │
         ▼  At scheduled_for:
      Scheduler re-validates target subscription.status = 'active' (Fix #4 — execution-time check).
      If not active → renewal.status = 'failed', failure_reason = 'target_not_active'. Alert ops.
         │
         ▼
      executeRenewal() (atomic):
         ├─ New Subscription created (inherits same fields as amendment):
         │    previous_subscription_id = original
         │    source_renewal_id = renewal
         │    currentTermEnd = old.currentTermEnd + termMonths
         │    status = active, version = 1
         │    items snapshot from old subscription (or amended quote if attached)
         │
         ├─ Old Subscription:
         │    status = renewed
         │    items transition to 'renewed' terminal
         │    assets migrate (FK → new subscription + new item IDs)
         │
         └─ RenewalTransaction.status = executed
         ▼
      Event: cpq.renewal.executed (with proration payload)

Manual Renewal ──► POST /subscriptions/:id/renew → same RenewalTransaction path
                   (may include amendmentId + pricing_strategy override)
```

### Process 3: Cancellation

```
CancellationRequest (requested)
   │  requested by user, reason code + text
   │  policy = 'immediate' | 'end-of-term'
   │  effectiveDate computed:
   │     immediate → now
   │     end-of-term → subscription.currentTermEnd
   │  ETF computed at creation (not recomputed at execution):
   │     min(remaining_months × MRC × 0.5, 3 × MRC)
   │
   ▼  approval:
CancellationRequest.status = approved
   │  If effectiveDate ≤ now: execute() inline (same transaction)
   │  Else: scheduler picks up at effectiveDate
   │
   ▼  At effectiveDate:
execute() (atomic):
   ├─ Subscription: status = terminated, cancellation_request_id set
   ├─ Items: status = terminated (cascaded via transitionSubscriptionStatus)
   ├─ Assets: status = cancelled (matches existing cascade behavior)
   ├─ Order: status = cancelled (only if order in 'draft', 'pending_activation', or 'active' — per real CPQ_ORDER_TRANSITIONS; if 'fulfilled', order stays)
   │
   Event: cpq.cancellation.executed (billing listens → compute refund if needed)
```

### Validation Constraints

Cross-process rules enforced at API and service layer:

| Rule | Enforced where |
|------|----------------|
| Amendment target subscription must be `active` | API (creation) + service (execution re-check) |
| Amendment `effective_date` must be ≤ source subscription's `currentTermEnd` (waived if amendment attached to RenewalTransaction) | API |
| Amendment blocked if subscription has another amendment in `pending` or `approved` status (drafts allowed) | API (409) |
| Amendment blocked if subscription has a non-terminal CancellationRequest | API (409) |
| Amendment `lineChanges` must not be empty | API (400) |
| Renewal target subscription must be `active` at execution time (not only at scheduling) | Service (scheduler at scan + at execution) |
| Cancellation target must be in `pending`, `active`, or `suspended` | API (400) |
| Cancellation `end-of-term` policy requires `currentTermEnd` set | API |
| Concurrent modification detected via `version` — 409 Conflict | Service (MikroORM `@Property({ version: true })`) |
| Execute operations are idempotent — re-call on already-executed request is a no-op returning 200 | Service |

---

## Asset & Item Handling (chain transitions)

Critical because Amend and Renew both create new subscriptions.

### On Amendment execution

**Items** (contract-level, snapshot-per-subscription, immutable subscription_id FK):
| Line change | New subscription | Old subscription's item |
|-------------|-----------------|-------------------------|
| Unchanged | Item copied with same config | → `amended` terminal |
| Added | New item, status `pending` | (n/a) |
| Removed | (no new item) | → `terminated` terminal (not `amended`, since removed entirely) |
| Modified | Item copied with updated config | → `amended` terminal |

**Assets** (physical; FK migrated on chain):
| Line change | Asset behavior |
|-------------|----------------|
| Unchanged | `subscriptionId` + `subscriptionItemId` updated to new subscription/item |
| Added | New Asset `pending` on new subscription |
| Removed | Existing Asset → `cancelled`; stays linked to OLD subscription (historical trace) |
| Modified | Migrates FK (like unchanged); configuration updated if applicable |

### On Renewal execution

**Items:**
- All items from old subscription copied to new subscription (fresh instances derived from old or attached amendment).
- Old subscription's items transition to `renewed` terminal.

**Assets:**
- All assets migrate FK (`subscriptionId` → new, `subscriptionItemId` → corresponding new item).
- Old subscription has no assets after migration; historical view via chain walk.

### On Cancellation execution

**Items:** all → `terminated` (matches existing `transitionSubscriptionStatus` behavior where item.status is cascaded from parent).

**Assets:** all → `cancelled` (matches existing cascade at [src/modules/cpq/services/cpqInventoryService.ts:391-395](../../src/modules/cpq/services/cpqInventoryService.ts#L391) — current code uses single terminal `cancelled` regardless of asset type).

Note: the original draft of this spec proposed per-type cascade (physical → `returned`, digital → `cancelled`), but verification of `cpqInventoryService.transitionSubscriptionStatus` shows existing behavior is uniform `cancelled`. Per-type logic would require additional `assetType` handling — deferred to future enhancement. V1 preserves current cascade.

### Historic visibility

Answering "what did old subscription X contain at time T":
1. Items: `SELECT * FROM cpq_inventory_subscription_items WHERE subscription_id = X` — snapshot frozen when subscription transitioned to terminal.
2. Assets that were there: walk forward chain (`WHERE previous_subscription_id = X`) and inspect assets migrated from X. Assets terminated on remove-line stay linked to X. Future: dedicated `CpqAssetHistory` log (out of v1 scope).

### Amendment attached to renewal (special case)

When an amendment is attached to a RenewalTransaction via `attached_amendment_id` (manual renewal path), the amendment does **not** execute standalone. Its line changes + `pricing_strategy` are applied to the new subscription created by the renewal. Lifecycle implications:

- **Attachment semantics**: on attachment, the amendment's `effective_date` is automatically overridden to match `renewal.scheduled_for` (so it aligns with when renewal will actually fire). The `effective_date ≤ currentTermEnd` creation-time validation is waived for attached amendments.
- **Amendment.status lifecycle**: the amendment stays in `approved` while waiting for the renewal to fire. When the RenewalTransaction executes, the amendment transitions to `executed` in the same transaction; `result_subscription_id` on the amendment is set to the renewal's `new_subscription_id`; `result_order_id` and `result_quote_id` point to the renewal-generated order/quote.
- **No duplicate execution**: amendment scheduler query adds a filter `AND NOT EXISTS (SELECT 1 FROM cpq_renewal_transactions WHERE attached_amendment_id = amendment.id AND status IN ('scheduled','failed'))` to skip amendments owned by a non-executed renewal.
- **Withdrawal**: withdrawing an amendment that's attached to a scheduled renewal detaches it (sets `renewal.attached_amendment_id = null`). The renewal proceeds without amendment (default behavior). Alternative: cancel the renewal too — exposed as explicit user action, not default.

### Subscription attribute inheritance (new subscription in chain)

When a new subscription is created via amendment or renewal, it inherits from predecessor:
- `customer_id`, `organization_id`, `tenant_id`
- `currency` / `currency_code`
- `billingCycle`
- `autoRenew` flag
- `default_renewal_pricing_strategy`

Diverges:
- `id` (new UUID)
- `previous_subscription_id` (→ predecessor)
- `source_amendment_id` / `source_renewal_id` (→ the request that created it; mutually exclusive)
- `sourceQuoteId` / `sourceOrderId` (→ the new quote/order)
- `currentTermEnd` (amendment: inherited; renewal: extended by `termMonths`)
- `version` (starts at 1)
- `status` (starts at `active`)
- `items` (snapshot from quote)

---

## Data Models

Convention note: `enum(...)` notation below describes valid values but fields are stored as `text` columns with defaults. Validation is enforced in service layer (following existing CPQ pattern — see `INVENTORY_SUBSCRIPTION_STATUSES`, `CPQ_ORDER_TRANSITIONS` etc. in [types.ts](../../src/modules/cpq/services/types.ts)). New enum-like values should be added as constants exported from the same file.

### New entities

#### `CpqAmendmentRequest`

```
id: string (UUID, PK)
organization_id: string (tenant-scoped)
tenant_id: string
source_subscription_id: string ──► CpqInventorySubscription
source_order_id: string (nullable) ──► SalesOrder
amendment_type: enum('change-config' | 'add-line' | 'remove-line' | 'change-term' | 'other')
pricing_strategy: text ∈ {'rate-lock', 'current-catalog', 'mixed'}   ← validated in service layer, not DB enum
reason_code: enum('upgrade' | 'downgrade' | 'config-change' | 'price-adjustment' | 'term-extension' | 'term-reduction' | 'customer-request' | 'other') (nullable)
reason_text: string (nullable)
requested_by_user_id: string
effective_date: date
status: enum('draft' | 'pending' | 'approved' | 'executed' | 'failed' | 'rejected' | 'withdrawn')
retry_count: integer (default 0, max 3) — applies on execution failure
failure_reason: string (nullable)
result_quote_id: string (nullable) ──► CpqQuoteConfiguration
result_order_id: string (nullable) ──► CpqOrderConfiguration
result_subscription_id: string (nullable) ──► CpqInventorySubscription (new chained subscription)
approved_by_user_id: string (nullable)
approved_at: timestamp (nullable)
executed_at: timestamp (nullable)
rejection_reason: string (nullable)
created_at, updated_at: timestamp
version: integer @Property({ version: true })   ← MikroORM optimistic lock; auto-increments on every UPDATE. Distinct from existing user-managed `version` counter on Quote/Spec/Wizard entities.
```

Indexes: `(organization_id, status)`, `(source_subscription_id)`, `(effective_date, status)` for scheduler.

Scheduler query: `WHERE status = 'approved' AND effective_date <= now()`.

#### `CpqAmendmentChange` *(delta tracking)*

```
id: string (UUID, PK)
organization_id: string
amendment_request_id: string ──► CpqAmendmentRequest
change_type: enum('line-added' | 'line-removed' | 'line-modified' | 'attribute-changed' | 'charge-changed' | 'term-changed')
target_line_id: string (nullable) ──► CpqQuoteLineConfiguration
before_snapshot: jsonb (nullable)
after_snapshot: jsonb (nullable)
field_path: string (nullable) — dotted path for attribute/charge changes
created_at: timestamp
```

#### `CpqRenewalTransaction`

```
id: string (UUID, PK)
organization_id: string
tenant_id: string
source_subscription_id: string ──► CpqInventorySubscription
new_subscription_id: string (nullable until executed) ──► CpqInventorySubscription
trigger_type: enum('auto' | 'manual' | 'amendment-driven')
attached_amendment_id: string (nullable) ──► CpqAmendmentRequest
pricing_strategy: text ∈ {'rate-lock', 'current-catalog', 'mixed'}   ← validated in service layer, not DB enum
term_months: integer
scheduled_for: timestamp
executed_at: timestamp (nullable)
executed_by_user_id: string (nullable — null for auto)
status: enum('scheduled' | 'executed' | 'failed' | 'cancelled')
failure_reason: string (nullable)
retry_count: integer (default 0, max 3)
created_at, updated_at: timestamp
version: integer @Property({ version: true })   ← MikroORM optimistic lock; auto-increments on every UPDATE. Distinct from existing user-managed `version` counter on Quote/Spec/Wizard entities.
```

Indexes: `(scheduled_for, status)` for scheduler, `(source_subscription_id)` for history.

#### `CpqCancellationRequest`

```
id: string (UUID, PK)
organization_id: string
tenant_id: string
target_type: enum('subscription' | 'order')
target_id: string (polymorphic FK)
reason_code: enum('customer-request' | 'non-payment' | 'contract-breach' | 'upgrade' | 'downgrade' | 'other')
reason_text: string (nullable)
requested_by_user_id: string
cancellation_policy: enum('immediate' | 'end-of-term')
effective_date: date
etf_applies: boolean
etf_amount: decimal (nullable)
etf_currency: string (3-char, nullable)
status: enum('requested' | 'approved' | 'executed' | 'failed' | 'rejected' | 'withdrawn')
retry_count: integer (default 0, max 3)
failure_reason: string (nullable)
approved_by_user_id: string (nullable)
approved_at: timestamp (nullable)
executed_at: timestamp (nullable)
rejection_reason: string (nullable)
created_at, updated_at: timestamp
version: integer @Property({ version: true })   ← MikroORM optimistic lock; auto-increments on every UPDATE. Distinct from existing user-managed `version` counter on Quote/Spec/Wizard entities.
```

Indexes: `(organization_id, status)`, `(target_type, target_id)`, `(effective_date, status)`.

### Modifications to existing entities

**`CpqInventorySubscription`** — add:
```
version: integer @Property({ version: true })   ← MikroORM optimistic lock; auto-increments on every UPDATE. Distinct from existing user-managed `version` counter on Quote/Spec/Wizard entities.   ← renamed from term_version; row version for optimistic locking
previous_subscription_id: string (nullable) ──► CpqInventorySubscription (chain predecessor)
source_amendment_id: string (nullable) ──► CpqAmendmentRequest (amendment that created THIS subscription)
source_renewal_id: string (nullable) ──► CpqRenewalTransaction (renewal that created THIS subscription)
cancellation_request_id: string (nullable) ──► CpqCancellationRequest
default_renewal_pricing_strategy: text default 'rate-lock' ∈ {'rate-lock', 'current-catalog', 'mixed'} — validated in service layer, not DB enum
last_billing_date: date (nullable) — set by billing module integration; used by CPQ for proration cycle bounds
```

Inverse lookups (no back-reference columns stored):
- Chain successor: `WHERE previous_subscription_id = $currentId LIMIT 1`
- Termination reason: fetch from linked `CancellationRequest`

Note: `source_amendment_id` and `source_renewal_id` are mutually exclusive — a subscription is created by exactly one of (original order, amendment, renewal).

**Subscription status enum** — add two terminal statuses:
```
amended   ← NEW, chain predecessor via amendment
renewed   ← NEW, chain predecessor via renewal
```

**Subscription state machine** (verified against [types.ts `INVENTORY_SUBSCRIPTION_TRANSITIONS`](../../src/modules/cpq/services/types.ts#L168)):

| From | Existing transitions | This spec adds |
|------|---------------------|----------------|
| `pending` | `active`, `terminated` | — |
| `active` | `suspended`, `terminated`, `expired` | **`amended`**, **`renewed`** ← NEW |
| `suspended` | `active`, `terminated` | — |
| `terminated`, `expired` | (terminal) | — |
| `amended`, `renewed` | — | terminal (NEW) |

Migration: update `INVENTORY_SUBSCRIPTION_STATUSES` constant to include `'amended'`, `'renewed'`; extend `INVENTORY_SUBSCRIPTION_TRANSITIONS.active` with these; add `amended: []` and `renewed: []` entries.

Notes:
- Subscription enum has NO `cancelled` status — cancellation-driven termination uses `terminated`. `cancelled` exists on items/assets/orders but never on subscription.
- `suspended` cannot transition directly to `amended` or `renewed` — validation blocks amendment/renewal on suspended; reactivate first.

**`CpqInventorySubscriptionItem`** — status enum extended and state machine:

Existing enum: `pending | active | suspended | terminated | expired`. Add: `amended`, `renewed` (mirror parent subscription terminals). Note: `cancelled` is NOT a valid item status (only `CpqInventoryAsset` has `cancelled`).

| From | Allowed transitions |
|------|---------------------|
| `pending` | `active`, `terminated` (if parent subscription terminated/cancelled before item activated) |
| `active` | `suspended`, `terminated`, `expired`, `amended`, `renewed` |
| `suspended` | `active`, `terminated` |
| `terminated`, `expired`, `amended`, `renewed` | (terminal — no outgoing) |

Item transitions are driven by parent subscription transitions (never independent).

**`CpqQuoteConfiguration`** — add:
```
amendment_request_id: string (nullable) ──► CpqAmendmentRequest
```

Successor lookup: `WHERE parent_quote_id = $currentId`.

Additional rule: when an AmendmentRequest is withdrawn or rejected, the linked result Quote (if any) transitions to existing `cancelled` status — prevents orphaned quotes in limbo.

**`CpqOrderConfiguration`** — add:
```
amendment_request_id: string (nullable) ──► CpqAmendmentRequest
supersedes_order_id: string (nullable) ──► CpqOrderConfiguration
```

Successor lookup: `WHERE supersedes_order_id = $currentId`.

**Order status enum** — add:
```
superseded  ← NEW TERMINAL, order replaced by amendment successor (only from 'active'; 'fulfilled' orders keep status)
```

**Order state machine** (verified against [types.ts `CPQ_ORDER_TRANSITIONS`](../../src/modules/cpq/services/types.ts#L192)):

| From | Existing transitions | This spec adds |
|------|---------------------|----------------|
| `draft` | `pending_activation`, `active`, `cancelled` | — |
| `pending_activation` | `active`, `cancelled` | — |
| `active` | `fulfilled`, `cancelled` | **`superseded`** ← NEW |
| `fulfilled`, `cancelled` | (terminal) | — |
| `superseded` | — | terminal (NEW) |

Migration: update `CPQ_ORDER_STATUSES` constant to include `'superseded'`; extend `CPQ_ORDER_TRANSITIONS.active` with `'superseded'`; add `superseded: []` entry.

### Cross-module FK rule

Per [.ai/enforcement-rules.md](../../.ai/enforcement-rules.md): **all FKs above are `string` columns, NO ORM relations cross-module.** Intra-module (e.g., `CpqAmendmentChange` → `CpqAmendmentRequest`) may use ORM relations.

### ETF Formula (Q5.a — fixed default)

Pure function, codified in `cpqCancellationService.computeETF`:

```
input: subscription { currentTermEnd: Date|null, termMonths: number|null, mrcAmount: string, currencyCode: string }, effectiveDate: Date

if cancellation_policy = 'end-of-term' OR currentTermEnd === null OR effectiveDate >= currentTermEnd OR termMonths === null:
    return { etf_applies: false, etf_amount: null, etf_currency: null }

// mrcAmount is stored as string (numeric(18,4)); parse carefully
mrc = parseNumeric(subscription.mrcAmount)  // e.g., Decimal.js or BigDecimal
remaining_months = ceil((currentTermEnd - effectiveDate).days / 30)
raw_etf = remaining_months × mrc × 0.5
capped_etf = min(raw_etf, 3 × mrc)

return { etf_applies: true, etf_amount: formatNumeric(capped_etf), etf_currency: subscription.currencyCode }
```

Implementation notes:
- `mrcAmount` on `CpqInventorySubscription` is `numeric(18,4)` stored as string (e.g., `'99.9900'`). Use `Decimal.js` (or MikroORM's `Decimal` type helper) for arithmetic; avoid `parseFloat` for financial calculations.
- `etf_amount` on `CpqCancellationRequest` should also be `numeric(18,4)` string for consistency.
- `ceil(days / 30)` is simple approximation; tests must cover month-boundary edge cases (e.g., effectiveDate = 15th of 30-day month vs 15th of 31-day month).

Unit tests cover: zero term, exact currentTermEnd, past currentTermEnd, null termMonths, null currentTermEnd, month boundary edges, large term with cap triggering.

Future: swap for configurable `CpqEtfPolicy` entity (out of scope v1).

### Configuration Defaults

| Setting | Default | Notes |
|---------|---------|-------|
| Renewal scheduler lookahead window | 7 days | Configurable via env / module config |
| Renewal scheduler look-behind window | 3 days | Catches missed cron runs |
| Renewal retry count max | 3 | After max → terminal `failed`, alert ops |
| Cancellation scheduler look-behind | 3 days | Same rationale |
| Amendment scheduler poll interval | 15 min | Balances UX latency for future-dated amendments with scheduler load |
| Amendment retry count max | 3 | Same as renewal |
| Cancellation retry count max | 3 | Same as renewal |
| Default subscription renewal pricing strategy | `rate-lock` | Configurable per subscription, per renewal |
| ETF multiplier | 0.5 | Fixed v1; configurable in future |
| ETF cap (× MRC) | 3 | Fixed v1 |
| Numeric amount representation | `numeric(18,4)` stored as string | Matches existing CPQ convention (e.g., `mrcAmount`, `nrcAmount`); all arithmetic via Decimal library |

---

## ACL Features

| Feature | Scope |
|---------|-------|
| `cpq.arc.amendment.view` | Read amendment requests and delta records |
| `cpq.arc.amendment.manage` | Create, submit for approval, withdraw, retry-failed amendment |
| `cpq.arc.amendment.approve` | Approve / reject amendment (also needs `cpq.quote.approve`) |
| `cpq.arc.renewal.view` | Read renewal history |
| `cpq.arc.renewal.manage` | Manual renewal, autoRenew toggle, cancel scheduled renewal, retry-failed |
| `cpq.arc.cancellation.view` | Read cancellation requests |
| `cpq.arc.cancellation.manage` | Create, withdraw, retry-failed cancellation |
| `cpq.arc.cancellation.approve` | Approve / reject cancellation |

Declared in [src/modules/cpq/acl.ts](../../src/modules/cpq/acl.ts).

---

## API Contracts

### Amendment

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/cpq/amendments` | Create AmendmentRequest (draft). Body: `{ sourceSubscriptionId, amendmentType, pricingStrategy, reasonCode?, reasonText?, effectiveDate, lineChanges: [...] }`. Validates rules. Side-effect: generates cloned Quote + AmendmentChange records. Returns `{ amendmentId, resultQuoteId }`. |
| GET | `/api/cpq/amendments/[id]` | Fetch amendment with changes, linked quote, status |
| POST | `/api/cpq/amendments/[id]/submit-for-approval` | `draft → pending` |
| POST | `/api/cpq/amendments/[id]/approve` | Drives linked quote through its approval flow (requires `cpq.quote.approve`). AmendmentRequest.status → `approved` when quote reaches `accepted`. If `effective_date ≤ now`, also `approved → executed` inline in same transaction. |
| POST | `/api/cpq/amendments/[id]/reject` | `pending → rejected` with reason |
| POST | `/api/cpq/amendments/[id]/withdraw` | Withdraw (allowed in `draft`, `pending`, `approved`). Also cancels linked result Quote. |
| POST | `/api/cpq/amendments/[id]/retry` | Retry execution after failure (allowed in `failed` status, resets retry_count-driven gate) |
| GET | `/api/cpq/subscriptions/[id]/amendments` | List amendments for subscription |
| Internal | Cron `cpq:execute-amendments` | Every 15 min: picks up `approved` amendments where `effective_date ≤ now` |

### Renewal

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/cpq/subscriptions/[id]/renew` | Manual renewal. Body: `{ termMonths?, amendmentId?, pricingStrategy? }` |
| GET | `/api/cpq/subscriptions/[id]/renewals` | Renewal history for subscription chain |
| GET | `/api/cpq/subscriptions/[id]/chain` | Full chain walk (ancestors + descendants) for historic view |
| PATCH | `/api/cpq/subscriptions/[id]/auto-renew` | Toggle autoRenew. Body: `{ enabled: boolean }` |
| PATCH | `/api/cpq/subscriptions/[id]/renewal-pricing-strategy` | Set `default_renewal_pricing_strategy` |
| POST | `/api/cpq/renewals/[id]/cancel` | Cancel scheduled renewal (only when `status=scheduled`) |
| POST | `/api/cpq/renewals/[id]/retry` | Retry after failure |
| Internal | Cron `cpq:renew-subscriptions` | Daily scan for due renewals |

### Cancellation

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/cpq/cancellations` | Create CancellationRequest. Body: `{ targetType, targetId, reasonCode, reasonText?, cancellationPolicy }`. Computes `effective_date` + ETF at creation. |
| GET | `/api/cpq/cancellations/[id]` | Fetch cancellation |
| POST | `/api/cpq/cancellations/[id]/approve` | `requested → approved`; executes inline if `effective_date ≤ now` |
| POST | `/api/cpq/cancellations/[id]/reject` | `requested → rejected` with reason |
| POST | `/api/cpq/cancellations/[id]/withdraw` | Withdraw before execution |
| POST | `/api/cpq/cancellations/[id]/retry` | Retry after failure |
| Internal | Cron `cpq:execute-cancellations` | Daily scan for end-of-term cancellations due today |

### Events

All events carry: `tenantId`, `organizationId`, `timestamp`, entity IDs. Emission pattern follows Open Mercato convention: `withAtomicFlush` commits DB state, THEN `emitCpqEvent(...)` fires (outside the atomic block). Persistent subscribers queued via `@open-mercato/queue` (BullMQ when `QUEUE_STRATEGY=async`, local file queue otherwise) provide reliable delivery + retries. No custom outbox table needed — framework handles it.

**Amendment events:**
- `cpq.amendment.created`
- `cpq.amendment.submitted`
- `cpq.amendment.approved`
- `cpq.amendment.rejected`
- `cpq.amendment.withdrawn`
- `cpq.amendment.executed` ← billing listens; **payload includes proration data**
- `cpq.amendment.failed`

Amendment executed payload:
```
{
  amendmentId, sourceSubscriptionId, newSubscriptionId, newOrderId,
  effectiveDate,
  proration: {
    oldMrcAmount, newMrcAmount, currency,
    billingCycleStart, billingCycleEnd,     ← derived from last_billing_date + billingCycle
    daysElapsedInCycle, daysRemainingInCycle
  }
}
```

**Cancellation events:**
- `cpq.cancellation.created`
- `cpq.cancellation.approved`
- `cpq.cancellation.rejected`
- `cpq.cancellation.withdrawn`
- `cpq.cancellation.executed` ← billing listens (ETF + refund flag in payload)
- `cpq.cancellation.failed`

**Renewal events:**
- `cpq.renewal.scheduled`
- `cpq.renewal.executed` ← billing listens; **payload includes proration data**
- `cpq.renewal.failed`
- `cpq.renewal.cancelled`

---

## UI Integration

All ARC UI lives under `/backend/cpq/` and integrates with existing CPQ admin surface. Uses `@open-mercato/ui` primitives + existing CPQ UI patterns (see `src/modules/cpq/backend/cpq/` for reference style).

### Subscription Detail Page Extensions (injection widgets)

Inject into existing [src/modules/cpq/backend/cpq/inventory/](../../src/modules/cpq/backend/cpq/inventory/) subscription detail:
- **"Amend" action button** — opens Amendment Wizard (new modal/drawer)
- **"Cancel" action button** — opens Cancellation Dialog with reason selector + policy radio + ETF preview
- **"Renew now" action button** — opens Manual Renew Dialog (pricing strategy selector + attach amendment option)
- **"Auto-renew" toggle** — inline toggle for `autoRenew` flag
- **"Renewal History" tab** — timeline of past renewals in the subscription chain
- **"Chain" tab** — full lineage tree (ancestors + descendants) walking `previous_subscription_id` both directions
- **"Amendments" tab** — list of AmendmentRequests targeting this subscription, with status badges

Injection target: `detail:cpq.inventory.subscription:tabs` and `detail:cpq.inventory.subscription:actions` spots. If those don't exist yet, declare them in this spec's Phase 2 deliverables.

### Amendment Wizard (new standalone page)

`/backend/cpq/amendments/new` — multi-step wizard:
1. **Scope selection** — pick source subscription (or arrive pre-selected from subscription detail)
2. **Change set** — line-by-line add/modify/remove with inline product picker
3. **Pricing strategy** — radio: `rate-lock` / `current-catalog` / `mixed` (with explainer tooltips)
4. **Reason + effective date** — reason code (enum) + free text + date picker (default: today)
5. **Preview** — render cloned quote totals + AmendmentChange delta table (human-readable diff)
6. **Submit** — creates AmendmentRequest in `draft`, redirects to detail page

### Amendment Detail Page

`/backend/cpq/amendments/[id]`:
- Status badge + transition actions: Submit for Approval / Approve / Reject / Withdraw / Retry (conditional on status + ACL)
- Change delta table
- Linked quote (click-through to standard quote detail)
- Linked orders (predecessor + successor once executed)
- Linked subscriptions (source + result once executed)
- Proration payload preview (read from `result_*` after execution)

### Cancellations List + Detail

`/backend/cpq/cancellations` — paginated list with filters (status, target_type, reason_code, date range).

`/backend/cpq/cancellations/[id]` — detail with ETF breakdown, target link, transition actions.

### Renewals List

`/backend/cpq/renewals` — list of scheduled/executed/failed renewals with link to parent subscription.

### Navigation

Menu entries under existing CPQ navigation group (sidebar): "Amendments", "Cancellations", "Renewals" — guarded by `cpq.arc.*.view` features.

### Component Replacement / Overrides

Client-specific customer apps can override wizard steps, ETF display widget, or reason code picker via `widgets/components.ts` `componentOverrides` mechanism (see [@open-mercato/core AGENTS.md](../../node_modules/@open-mercato/core/AGENTS.md#component-replacement)).

---

## State Machines

### AmendmentRequest

Transitions listed explicitly as `from → to (trigger)`:

| From | To | Trigger |
|------|-----|---------|
| `draft` | `pending` | submitForApproval |
| `draft` | `withdrawn` | withdraw |
| `pending` | `approved` | approve |
| `pending` | `rejected` | reject |
| `pending` | `withdrawn` | withdraw |
| `approved` | `executed` | execute (inline if `effective_date ≤ now`, else scheduler) |
| `approved` | `failed` | execute error (retry_count++) |
| `approved` | `withdrawn` | withdraw (only before execution starts) |
| `failed` | `approved` | POST /retry (allowed when retry_count < 3; beyond that 409) |
| `failed` | `withdrawn` | manual abort |
| `executed`, `rejected`, `withdrawn` | — | terminal |

Note: `failed` is a non-terminal holding status. `retry_count` gates POST /retry eligibility but does not change the status itself. Operator can always use /withdraw to force-terminate a `failed` amendment.

### CancellationRequest

| From | To | Trigger |
|------|-----|---------|
| `requested` | `approved` | approve |
| `requested` | `rejected` | reject |
| `requested` | `withdrawn` | withdraw |
| `approved` | `executed` | execute (inline if `effective_date ≤ now`, else scheduler) |
| `approved` | `failed` | execute error (retry_count++) |
| `approved` | `withdrawn` | withdraw (only before execution starts) |
| `failed` | `approved` | POST /retry (when retry_count < 3) |
| `failed` | `withdrawn` | manual abort |
| `executed`, `rejected`, `withdrawn` | — | terminal |

### RenewalTransaction

| From | To | Trigger |
|------|-----|---------|
| `scheduled` | `executed` | executeRenewal (success) |
| `scheduled` | `failed` | executeRenewal error (retry_count++) |
| `scheduled` | `cancelled` | POST /renewals/[id]/cancel (only while `scheduled`) |
| `failed` | `scheduled` | POST /retry or auto-retry (when retry_count < 3) |
| `failed` | `cancelled` | manual abort |
| `executed`, `cancelled` | — | terminal |

Notes:
- `failed` is non-terminal holding status (same semantics as Amendment/Cancellation); `retry_count ≥ 3` blocks further /retry but does not transition status.
- `cancelled` only reachable from `scheduled` or `failed`. A renewal in `executed` state cannot be undone — must create a CancellationRequest on the resulting subscription.
- No `executing` intermediate state; execution is synchronous within one DB transaction.

### CpqInventorySubscription (extended)

See tabular form in Data Models section above.

### CpqInventorySubscriptionItem (extended)

See tabular form in Data Models section above.

### CpqOrderConfiguration (extended)

See tabular form in Data Models section above.

---

## Services

New services in [src/modules/cpq/services/](../../src/modules/cpq/services/):

- **`cpqAmendmentService.ts`**
  - `createAmendment({ subscriptionId, type, pricingStrategy, reasonCode, reasonText, effectiveDate, lineChanges })` → validates, creates AmendmentRequest + AmendmentChange[] + cloned Quote (price per pricing_strategy)
  - `submitForApproval(amendmentId)` → delegates to existing quote approval flow
  - `approve(amendmentId)` → transitions to `approved`; if `effective_date ≤ now`, calls `execute()` inline
  - `reject(amendmentId, reason)` / `withdraw(amendmentId)` → also cancels linked result Quote if present
  - `execute(amendmentId)` → **idempotent**; no-op if already `executed`. Atomic: creates new Order, new Subscription (chain), migrates assets/items per rules, transitions old entities, writes event to outbox
  - `retry(amendmentId)` → only on `failed` status; resets execution attempt
  - `processDueAmendments()` → scanner (every 15 min)

- **`cpqRenewalService.ts`**
  - `scheduleRenewal({ subscriptionId, termMonths?, amendmentId?, pricingStrategy?, trigger })` → creates RenewalTransaction
  - `executeRenewal(renewalId)` → **idempotent**; re-validates `subscription.status = active` (Fix #4); chain creation, asset migration, item snapshot, event emission
  - `retry(renewalId)` / `cancelScheduled(renewalId)`
  - `processDueRenewals()` → scanner (daily)
  - `walkChain(subscriptionId)` → returns full chain (ancestors + descendants)

- **`cpqCancellationService.ts`**
  - `createCancellation({ targetType, targetId, reasonCode, policy, reasonText? })` → validates, computes `effective_date` + ETF (codified formula)
  - `computeETF(subscription, effectiveDate)` → pure function (per ETF Formula section)
  - `approve(cancellationId)` → if `effective_date ≤ now`, calls `execute()` inline
  - `reject` / `withdraw` / `retry`
  - `execute(cancellationId)` → **idempotent**; atomic transitions on target + items + assets
  - `processDueCancellations()` → scanner (daily)

All `execute()` methods wrap multi-phase mutations in `withAtomicFlush(em, phases, { transaction: true })` (from `@open-mercato/shared/lib/commands/flush`). After successful commit, events are emitted via `emitCpqEvent(...)` — outside the atomic block. Persistent subscribers via `@open-mercato/events` + `@open-mercato/queue` provide reliable delivery to downstream listeners (billing, notifications). Service/event sequencing is guaranteed because events fire only after DB commit.

---

## Implementation Conventions

This section codifies **how** to implement ARC in conformance with Open Mercato framework patterns and existing CPQ module conventions. All patterns here are verified against node_modules/@open-mercato/* documentation and current CPQ code.

### Migration Workflow (MUST)

> **Never hand-write migration files.** (Per [@open-mercato/core AGENTS.md](../../node_modules/@open-mercato/core/AGENTS.md))

Workflow:
1. Define/modify MikroORM entity in [src/modules/cpq/data/entities.ts](../../src/modules/cpq/data/entities.ts)
2. Run `yarn db:generate` — framework emits SQL in `src/modules/cpq/migrations/MigrationYYYYMMDDHHMMSS_*.ts`
3. Review generated migration
4. Run `yarn db:migrate` to apply
5. Run `yarn generate` (aka `npm run modules:prepare`) to refresh `.mercato/generated/*` files

Migration file structure (verified against [Migration20260411000000_cpq_orders.ts](../../src/modules/cpq/migrations/Migration20260411000000_cpq_orders.ts)):
```typescript
import { Migration } from '@mikro-orm/migrations'

export class Migration20260XXXXXXXXXX_cpq_arc_base extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table if not exists "cpq_amendment_requests" (...)`)
    this.addSql(`create index if not exists "..." on "..." ("organization_id", "tenant_id", ...)`)
  }
  async down(): Promise<void> {
    this.addSql(`drop table if exists "cpq_amendment_requests" cascade;`)
  }
}
```

Conventions from existing CPQ migrations:
- All tables have `organization_id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at` columns
- `id uuid not null default gen_random_uuid()`
- Timestamps: `timestamptz`
- Numeric: `numeric(18, 4)` for monetary
- Unique index per scope: `(organization_id, tenant_id, code)` pattern
- Indexes on `(organization_id, tenant_id, <filtered-field>)` for tenant-scoped queries
- No DB-level FKs to cross-module tables (per enforcement rules)

### DI Registration (MUST)

> Container uses `InjectionMode.CLASSIC`. Turbopack breaks destructured arrow-function params in Awilix's parser. Use `container.resolve('name')` inside factory body, NOT destructuring. (Per comment in [src/modules/cpq/di.ts:12-18](../../src/modules/cpq/di.ts#L12))

Add ARC services to `src/modules/cpq/di.ts`:
```typescript
cpqCancellationService: asFunction(() => {
  return new DefaultCpqCancellationService({
    em: container.resolve('em'),
    cpqInventoryService: container.resolve('cpqInventoryService'),
  })
}).scoped(),

cpqRenewalService: asFunction(() => {
  return new DefaultCpqRenewalService({
    em: container.resolve('em'),
    cpqInventoryService: container.resolve('cpqInventoryService'),
    cpqOrderService: container.resolve('cpqOrderService'),
  })
}).scoped(),

cpqAmendmentService: asFunction(() => {
  return new DefaultCpqAmendmentService({
    em: container.resolve('em'),
    cpqQuotingService: container.resolve('cpqQuotingService'),
    cpqInventoryService: container.resolve('cpqInventoryService'),
    cpqOrderService: container.resolve('cpqOrderService'),
    cpqPricingService: container.resolve('cpqPricingService'),
  })
}).scoped(),
```

Use `.scoped()` — EntityManager is request-scoped. Use `.proxy()` only if factory accepts named deps (we're using closures, so no).

### Events (MUST)

**Current state: CPQ has NO `events.ts`.** ARC will introduce the first events for the CPQ module. Create `src/modules/cpq/events.ts`:

```typescript
import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  // Amendment lifecycle
  { id: 'cpq.amendment.created', label: 'Amendment Created', entity: 'amendment', category: 'lifecycle' },
  { id: 'cpq.amendment.submitted', label: 'Amendment Submitted for Approval', entity: 'amendment', category: 'lifecycle' },
  { id: 'cpq.amendment.approved', label: 'Amendment Approved', entity: 'amendment', category: 'lifecycle' },
  { id: 'cpq.amendment.rejected', label: 'Amendment Rejected', entity: 'amendment', category: 'lifecycle' },
  { id: 'cpq.amendment.withdrawn', label: 'Amendment Withdrawn', entity: 'amendment', category: 'lifecycle' },
  { id: 'cpq.amendment.executed', label: 'Amendment Executed', entity: 'amendment', category: 'lifecycle', clientBroadcast: true },
  { id: 'cpq.amendment.failed', label: 'Amendment Execution Failed', entity: 'amendment', category: 'lifecycle' },

  // Cancellation lifecycle
  { id: 'cpq.cancellation.created', label: 'Cancellation Created', entity: 'cancellation', category: 'lifecycle' },
  { id: 'cpq.cancellation.approved', label: 'Cancellation Approved', entity: 'cancellation', category: 'lifecycle' },
  { id: 'cpq.cancellation.rejected', label: 'Cancellation Rejected', entity: 'cancellation', category: 'lifecycle' },
  { id: 'cpq.cancellation.withdrawn', label: 'Cancellation Withdrawn', entity: 'cancellation', category: 'lifecycle' },
  { id: 'cpq.cancellation.executed', label: 'Cancellation Executed', entity: 'cancellation', category: 'lifecycle', clientBroadcast: true },
  { id: 'cpq.cancellation.failed', label: 'Cancellation Failed', entity: 'cancellation', category: 'lifecycle' },

  // Renewal lifecycle
  { id: 'cpq.renewal.scheduled', label: 'Renewal Scheduled', entity: 'renewal', category: 'lifecycle' },
  { id: 'cpq.renewal.executed', label: 'Renewal Executed', entity: 'renewal', category: 'lifecycle', clientBroadcast: true },
  { id: 'cpq.renewal.failed', label: 'Renewal Failed', entity: 'renewal', category: 'lifecycle' },
  { id: 'cpq.renewal.cancelled', label: 'Renewal Cancelled', entity: 'renewal', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'cpq', events })
export const emitCpqEvent = eventsConfig.emit
export type CpqEventId = typeof events[number]['id']
export default eventsConfig
```

Run `yarn generate` after creating/modifying `events.ts`.

**Emission rule (MUST):** emit events AFTER `withAtomicFlush` completes — never inside. Example:
```typescript
await withAtomicFlush(em, [
  () => { /* state changes */ },
  () => { /* more state changes */ },
], { transaction: true })

// AFTER commit:
await emitCpqEvent('cpq.amendment.executed', { amendmentId, ..., proration: { ... } })
```

### Subscribers (Billing Integration Point)

Future billing module will subscribe to execution events. For V1, create placeholder subscriber(s) to validate the flow. File: `src/modules/cpq/subscribers/amendment-executed-log.ts`:
```typescript
export const metadata = {
  event: 'cpq.amendment.executed',
  persistent: true,
  id: 'cpq-amendment-executed-log',
}

export default async function handler(payload, ctx) {
  console.info('[cpq.arc] Amendment executed', payload.amendmentId, payload.proration)
  // Future: call billing service, emit notification, etc.
}
```

**Persistent subscribers MUST be idempotent** — they may be retried on failure. Use amendmentId/cancellationId/renewalId as dedup key.

### Scheduler (Cron Jobs)

Use `@open-mercato/scheduler` — not custom cron. Pattern: define commands, schedule via DB-backed jobs with `targetType: 'command'`, `targetCommand: '<id>'`. See [scheduler test-echo](../../node_modules/@open-mercato/scheduler/src/modules/scheduler/commands/test-echo.ts) for minimal example.

Create `src/modules/cpq/commands/arc-schedulers.ts`:
```typescript
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'

registerCommand({
  id: 'cpq.arc.execute-cancellations',
  async execute(input, ctx) {
    const service = ctx.container.resolve('cpqCancellationService')
    return service.processDueCancellations(ctx.scope)
  },
})

registerCommand({
  id: 'cpq.arc.renew-subscriptions',
  async execute(input, ctx) {
    const service = ctx.container.resolve('cpqRenewalService')
    return service.processDueRenewals(ctx.scope)
  },
})

registerCommand({
  id: 'cpq.arc.execute-amendments',
  async execute(input, ctx) {
    const service = ctx.container.resolve('cpqAmendmentService')
    return service.processDueAmendments(ctx.scope)
  },
})
```

Schedule via scheduler UI at `/backend/config/scheduled-jobs` or programmatically in `setup.ts`:
- `cpq.arc.execute-cancellations` — daily at 00:15
- `cpq.arc.renew-subscriptions` — daily at 00:30
- `cpq.arc.execute-amendments` — every 15 minutes

### API Routes (MUST follow CPQ pattern)

Verified against [src/modules/cpq/api/quotes/route.ts](../../src/modules/cpq/api/quotes/route.ts):

```typescript
// src/modules/cpq/api/amendments/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCpqRouteContext } from '../context'
import { cpqCreateAmendmentSchema } from '../../data/validators'
import { AmendmentError } from '../../services/cpqAmendmentService'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cpq.arc.amendment.manage'] },
  GET: { requireAuth: true, requireFeatures: ['cpq.arc.amendment.view'] },
}

export async function POST(req: Request) {
  try {
    const ctx = await resolveCpqRouteContext(req)
    if (!ctx.auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = cpqCreateAmendmentSchema.parse(await req.json())
    const scope = { organizationId: ctx.organizationId, tenantId: ctx.tenantId }

    const service = ctx.container.resolve('cpqAmendmentService')
    const result = await service.createAmendment(body, scope)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return handleError(err, 'cpq/amendments.POST')
  }
}

function handleError(err: unknown, context: string) {
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 })
  }
  if (err instanceof AmendmentError) {
    return NextResponse.json({ error: err.message, ...(err.details ?? {}) }, { status: err.status })
  }
  console.error(`[${context}]`, err)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}
```

Conventions:
- Named exports `POST`, `GET`, `PUT`, `DELETE` — NOT `export default`
- `export const metadata` declares per-method auth + `requireFeatures`
- Always call `resolveCpqRouteContext(req)` to get DI container + auth + scope
- Validation via Zod schemas in `src/modules/cpq/data/validators.ts`
- Service-specific error class extends base with `status` property (pattern: `QuotingError`)
- `handleError` helper for consistent error responses

For list endpoints, consider `makeCrudRoute` from `@open-mercato/shared/lib/crud/factory` (used in core modules but not yet in CPQ — optional modernization).

### Multi-phase Mutations (MUST use `withAtomicFlush`)

> MikroORM's identity-map and subscriber infrastructure can silently discard pending scalar changes when a query runs on the same `EntityManager` before an explicit `em.flush()`. (Per [@open-mercato/core AGENTS.md SPEC-018](../../node_modules/@open-mercato/core/AGENTS.md))

`execute()` methods in ARC services MUST use `withAtomicFlush`:

```typescript
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'

async execute(amendmentId: string, scope: TenantScope) {
  const em = this.em
  // Read phase — BEFORE withAtomicFlush
  const amendment = await em.findOne(CpqAmendmentRequest, { id: amendmentId, ...scope })
  if (!amendment) throw new AmendmentError('Not found', 404)
  if (amendment.status === 'executed') return amendment // idempotent no-op

  const sourceSubscription = await em.findOne(CpqInventorySubscription, { id: amendment.sourceSubscriptionId })
  const clonedQuote = await em.findOne(CpqQuoteConfiguration, { id: amendment.resultQuoteId })

  // Atomic phase
  await withAtomicFlush(em, [
    () => {
      // Phase 1: create new order from cloned quote
      // (this may internally use cpqOrderService which does its own em operations)
    },
    () => {
      // Phase 2: create new subscription (chain)
    },
    () => {
      // Phase 3: migrate/snapshot items per rules
    },
    () => {
      // Phase 4: transition old entities
      if (sourceOrder.cpqStatus === 'active') sourceOrder.cpqStatus = 'superseded'
      sourceSubscription.status = 'amended'
      amendment.status = 'executed'
      amendment.executedAt = new Date()
    },
  ], { transaction: true })

  // AFTER commit — emit event
  await emitCpqEvent('cpq.amendment.executed', {
    amendmentId,
    sourceSubscriptionId: sourceSubscription.id,
    newSubscriptionId: amendment.resultSubscriptionId,
    newOrderId: amendment.resultOrderId,
    effectiveDate: amendment.effectiveDate,
    proration: { oldMrcAmount, newMrcAmount, ... },
  })

  return amendment
}
```

### ACL Features (MUST follow CPQ format)

Existing CPQ uses object form `{ id, title, module }` in [src/modules/cpq/acl.ts](../../src/modules/cpq/acl.ts). Match exactly:
```typescript
// Append to features[]
{ id: 'cpq.arc.amendment.view', title: 'View Amendment Requests', module: 'cpq' },
{ id: 'cpq.arc.amendment.manage', title: 'Manage Amendment Requests', module: 'cpq' },
{ id: 'cpq.arc.amendment.approve', title: 'Approve Amendment Requests', module: 'cpq' },
{ id: 'cpq.arc.renewal.view', title: 'View Renewal History', module: 'cpq' },
{ id: 'cpq.arc.renewal.manage', title: 'Manage Renewals', module: 'cpq' },
{ id: 'cpq.arc.cancellation.view', title: 'View Cancellation Requests', module: 'cpq' },
{ id: 'cpq.arc.cancellation.manage', title: 'Manage Cancellations', module: 'cpq' },
{ id: 'cpq.arc.cancellation.approve', title: 'Approve Cancellations', module: 'cpq' },
```

Also update `src/modules/cpq/setup.ts` `defaultRoleFeatures` to grant appropriate roles (e.g., `admin: 'cpq.*'` already wildcard-covers; employee roles need explicit `cpq.arc.*.view`).

### Dependencies Verified

All required packages already in [package.json](../../package.json):
- `@open-mercato/events` (0.4.10) ✓
- `@open-mercato/scheduler` (0.4.10) ✓
- `@open-mercato/queue` (0.4.10) ✓
- `@open-mercato/shared` (0.4.10) — contains `withAtomicFlush`, `createModuleEvents`, `registerCommand` ✓

No new dependencies needed.

---

## Implementation Plan

### Phase 1 — Cancellation (foundation)

Concrete step-by-step (following Open Mercato workflow):

1. **Entities** — Define in [src/modules/cpq/data/entities.ts](../../src/modules/cpq/data/entities.ts):
   - `CpqCancellationRequest` entity (per spec schema; all fields with `@Property` decorators)
   - Additions to `CpqInventorySubscription`: `version` (MikroORM `@Property({ version: true })`), `cancellation_request_id` (nullable), `last_billing_date` (nullable)
2. **Generate migration** — `yarn db:generate` produces `Migration20260XXXXXXXXXX_cpq_cancellation.ts`. Review generated SQL, verify indexes on `(organization_id, tenant_id, status)`, `(target_type, target_id)`, `(effective_date, status)`.
3. **Apply migration** — `yarn db:migrate`.
4. **Events declaration** — Create [src/modules/cpq/events.ts](../../src/modules/cpq/events.ts) (NEW file — first events for CPQ module) with `cpq.cancellation.*` event set. Run `yarn generate` to register.
5. **Validators** — Add Zod schemas to `src/modules/cpq/data/validators.ts`: `cpqCreateCancellationSchema`, `cpqApproveCancellationSchema`, etc.
6. **Service** — Implement `src/modules/cpq/services/cpqCancellationService.ts`:
   - `DefaultCpqCancellationService` class with `AmendmentError` equivalent (`CancellationError` with `status` property)
   - `createCancellation`, `computeETF` (pure), `approve`, `reject`, `withdraw`, `retry`, `execute`, `processDueCancellations`
   - Use `withAtomicFlush` for `execute()` multi-phase
   - Emit `cpq.cancellation.*` events AFTER commit
7. **DI registration** — Add `cpqCancellationService` to [src/modules/cpq/di.ts](../../src/modules/cpq/di.ts) using `asFunction + container.resolve` pattern.
8. **ACL** — Append 3 features to [src/modules/cpq/acl.ts](../../src/modules/cpq/acl.ts): `cpq.arc.cancellation.view/manage/approve`. Update `setup.ts` `defaultRoleFeatures` if needed.
9. **API routes**:
   - `src/modules/cpq/api/cancellations/route.ts` — POST (create) + GET (list)
   - `src/modules/cpq/api/cancellations/[id]/route.ts` — GET (fetch)
   - `src/modules/cpq/api/cancellations/[id]/approve/route.ts`, `/reject`, `/withdraw`, `/retry`
   - All follow `metadata` + `resolveCpqRouteContext` + Zod + `handleError` pattern
10. **Scheduled command** — Register `cpq.arc.execute-cancellations` in `src/modules/cpq/commands/arc-schedulers.ts`. Add schedule to `setup.ts` `onTenantCreated` (daily at 00:15).
11. **Subscriber placeholder** — `src/modules/cpq/subscribers/cancellation-executed-log.ts` with persistent metadata.
12. **Backend UI** — Cancel action on subscription detail + standalone cancellations list page. Use existing CPQ UI patterns (React + @open-mercato/ui).
13. **Tests** — Unit tests for `computeETF` pure function (all edge cases per spec); integration tests for state transitions, idempotency, validation blocks, scheduler.
14. **Run `yarn generate`** after all files are added to refresh `.mercato/generated/*`.

### Phase 2 — Renewal (automation + chain)
1. Entity + migrations: `CpqRenewalTransaction`, subscription additions (`previous_subscription_id`, `source_renewal_id`, `default_renewal_pricing_strategy`, new `renewed` status, item `renewed` status)
2. `cpqRenewalService` with chain creation + asset migration + item snapshot + execution-time status re-check
3. Cron handler `cpq:renew-subscriptions`
4. API + ACL features (`cpq.arc.renewal.*`)
5. Backend UI: renewal history timeline, manual renew dialog, autoRenew toggle, pricing strategy selector, chain view
6. Events: `cpq.renewal.*` (with proration payload)
7. Tests: auto-renewal, manual renewal, chain walk, failure/retry, asset migration, item snapshot, pricing strategies, execution-time blocked by suspended, idempotency

### Phase 3 — Amendment (chain + proration)
1. Entity + migrations: `CpqAmendmentRequest`, `CpqAmendmentChange`, subscription addition (`source_amendment_id`), quote/order additions (`amendment_request_id`, `supersedes_order_id`), new `amended` status for subscription + item, new `superseded` status for order
2. `cpqAmendmentService` — integrates with `cpqQuotingService.cloneQuote` via `createAmendmentQuote` (tags with amendment_request_id, applies pricing_strategy)
3. Delta computation → AmendmentChange records
4. Chain execution: new order, new subscription, asset migration, item snapshot, old → amended/superseded (conditional on order status)
5. API + ACL features (`cpq.arc.amendment.*`)
6. Amendment scheduler cron (every 15 min)
7. Backend UI: "Amend" action → wizard (select changes → pick pricing strategy → preview delta → preview cloned quote → submit)
8. Events: `cpq.amendment.*` (with proration payload)
9. Tests: billable/non-billable amendments, rejection, withdrawal, scheduled execution, inline execution (immediate effective_date), concurrent modification, pricing strategies, asset/item lifecycle per line-change type, validation blocks (empty changes, past currentTermEnd, suspended, pending cancellation, another non-terminal amendment), idempotency, failure + retry, withdrawal cancels linked quote

### Phase 4 — Lineage & Polish
1. Backfill migration: `version=1` on existing subscriptions (if not already set by MikroORM)
2. Lineage view: subscription detail shows full chain (original order → amendments → renewals → cancellation)
3. Reporting endpoints: amendments by date range, cancellation reasons, ETF totals, renewal churn
4. Migration rollback docs: how to revert each phase's migration if needed (drop new columns, restore status enum constraints)

---

## Risks

### Chain depth grows faster (amendment + renewal both chain) (Severity: Medium)
After 3 years with 4 amendments + 3 renewals, a subscription has 8+ records in chain.
**Mitigation:** always query `WHERE status = 'active' AND customer_id = X` for current. Chain walk only for audit/history. Consider materialized "current subscription" view if performance degrades.

### Proration payload accuracy (Severity: High)
Billing module uses proration data from event. If CPQ miscomputes billing cycle boundaries, proration is wrong.
**Mitigation:** Subscription stores `billingCycle` + `last_billing_date` (fed from billing integration). CPQ derives `billingCycleStart/End` deterministically. Contract test between CPQ and billing for payload shape + math. Amendment execution payload stored on AmendmentRequest for audit.

### Data integrity on concurrent ARC operations (Severity: High)
Two users amending + cancelling the same subscription → race condition.
**Mitigation:** optimistic locking via `version` column (MikroORM `@Property({ version: true })`); 409 Conflict. Additional validation blocks concurrent non-draft amendment (only one `pending`/`approved` at a time per subscription).

### Event ordering for billing (Severity: High)
Billing computes from `cpq.amendment.executed` / `cpq.renewal.executed`. If event arrives before state persisted → wrong values.
**Mitigation:** `withAtomicFlush(em, phases, { transaction: true })` ensures DB state is atomic. Events emitted AFTER commit via `emitCpqEvent(...)`. Persistent subscribers via `@open-mercato/events` (BullMQ-backed when async) provide reliable delivery + retries. In case of post-commit crash before emit, failed amendment record remains queryable with matching state — operator can reconcile via `/retry` endpoint (which is idempotent).

### ETF formula correctness (Severity: High)
Wrong ETF → customer disputes, legal exposure.
**Mitigation:** codified `computeETF` pure function, exhaustive unit tests. Displayed to user before submit. Value stored at creation, not recomputed at execution.

### Renewal scheduler reliability (Severity: High)
Missed renewal → unexpected expiry.
**Mitigation:** idempotent handler, 3-day look-behind, retry up to 3, terminal `failed` + alert after exhaustion, upcoming-renewals dashboard.

### Execution partial failure (Severity: High)
Amendment/renewal `execute()` performs many writes (new subscription, items, assets migration, old status transitions, event). A failure midway could leave partial state.
**Mitigation:** full operation wrapped in single DB transaction. On failure: rollback; status → `failed`; retry via scheduler or manual. Idempotent `execute()` so retry is safe.

### Amendment `effective_date` past `currentTermEnd` (Severity: Medium)
Would collide with renewal window.
**Mitigation:** validation — `effective_date ≤ currentTermEnd`. Customer must attach amendment to renewal instead.

### Asset migration losing history (Severity: Medium)
When asset FK moves forward on chain, old subscription appears to have no assets.
**Mitigation:** chain walk preserves ancestry; UI lineage view makes it obvious. Future: dedicated `CpqAssetHistory` log.

### Scheduler double-execution race (Severity: Medium)
Two scheduler instances (replicated cron) could pick up same approved amendment.
**Mitigation:** execute transitions status atomically via `UPDATE ... WHERE status='approved' RETURNING`; rowcount check. Second instance gets 0 rows → no-op. Plus idempotent `execute()` as belt-and-suspenders.

### Terminology drift: cloneQuote vs amendment (Severity: Low)
Developers conflate generic `cloneQuote` with post-sale `createAmendmentQuote`.
**Mitigation:** dedicated method + tests + developer docs.

### Notifications out of scope v1 (Severity: Low)
Customer won't receive emails for renewal/cancellation/amendment unless separate notification module listens to events.
**Mitigation:** events are ready for notification module to consume. Flag to ops/product for follow-up SPEC.

---

## Acceptance Criteria

### Cancellation
- [ ] Can cancel active subscription with `immediate` policy → `terminated`, `cancellation_request_id` set
- [ ] Can cancel with `end-of-term` policy → scheduler executes at `currentTermEnd`
- [ ] ETF computed per formula: `min(remaining_months × MRC × 0.5, 3 × MRC)`
- [ ] ETF = 0 for end-of-term or past-term cancellation or `termMonths = null`
- [ ] Cancellation emits `cpq.cancellation.executed` event via outbox
- [ ] Approved-but-not-executed cancellation can be withdrawn before `effective_date`
- [ ] Cancellation against already-terminal target → 400
- [ ] Cancellation works on `suspended` subscription
- [ ] `execute()` is idempotent (no-op on already-executed)
- [ ] Failure → status `failed`, retry via POST /retry

### Renewal
- [ ] Subscription with `autoRenew=true` and `currentTermEnd` within 7 days → chain created; old = `renewed`, new = `active`, version=1
- [ ] Manual renew creates new subscription with term extended
- [ ] Renewal with attached amendment applies amended terms to NEW subscription
- [ ] Pricing strategy respected (rate-lock / current-catalog / mixed)
- [ ] Items snapshotted on new subscription; old items → `renewed`
- [ ] Assets migrate FK to new subscription and new item IDs
- [ ] Chain walk returns ancestors + descendants correctly
- [ ] Failed renewal retries up to 3, then terminal `failed` + alert
- [ ] Renewal blocked on `suspended` subscription (scheduler skips at scan AND at execution)
- [ ] New subscription inherits attributes (customer, currency, billingCycle, etc.) per rules
- [ ] `execute()` is idempotent

### Amendment
- [ ] Can create amendment against active subscription → cloned Quote + AmendmentChange records
- [ ] Empty `lineChanges` → 400
- [ ] `effective_date > currentTermEnd` → 400
- [ ] Amendment on `suspended` subscription → 400
- [ ] Amendment blocked when pending cancellation exists → 409
- [ ] Amendment blocked when another amendment is `pending` or `approved` (drafts allowed) → 409
- [ ] Pricing strategy respected in cloned quote price computation
- [ ] Amendment goes through quote approval flow: cloned quote flows `new → ready → in_approval → approved → with_customer → accepted`
- [ ] Quote `accepted` + `effective_date ≤ now` → AmendmentRequest executes inline (same transaction)
- [ ] Quote `accepted` + `effective_date > now` → scheduler executes within 15 min of effective date
- [ ] Upon execution (triggered by linked quote reaching `accepted` + effectiveDate ≤ now): new Order created (`supersedes_order_id` populated); original Order: if `active` → `superseded`, if `fulfilled` → stays `fulfilled`; new Subscription created (chain); original Subscription → `amended`; version=1 on new
- [ ] Asset lifecycle correct per line change type (add→pending on new, remove→cancelled on old, modify/keep→migrate)
- [ ] Subscription item snapshot on new subscription; old items → `amended` (kept/modified) or `terminated` (removed)
- [ ] Amendment.executed event carries proration payload with `billingCycleStart/End` derived from `last_billing_date` + `billingCycle`
- [ ] Withdrawn amendment also cancels linked result Quote
- [ ] Amendment can be withdrawn in `draft`, `pending`, `approved`
- [ ] `execute()` is idempotent; failure → `failed`; retry works

### Cross-cutting
- [ ] All ARC operations emit events via `emitCpqEvent(...)` AFTER successful `withAtomicFlush` commit (not before); persistent subscribers registered for billing integration
- [ ] No ORM relations cross-module (string FKs)
- [ ] Concurrent modification → 409 via `version` column
- [ ] Backoffice shows full chain on subscription detail
- [ ] Tests cover happy + rejection + withdrawal + concurrency + scheduler + failure+retry + idempotency for each process

---

## Requirements Traceability

| Domain Requirement | Implementation |
|-------------------|----------------|
| R-ARC-1: Auditable post-sale changes | `CpqAmendmentRequest`, `CpqCancellationRequest`, `CpqRenewalTransaction` record who/when/why for every change. `CpqAmendmentChange` logs line-level delta. |
| R-ARC-2: Chain history | `previous_subscription_id` on subscription + new terminal statuses `amended`/`renewed` preserve predecessors. `GET /subscriptions/[id]/chain` exposes full ancestry. |
| R-ARC-3: Proration for mid-term changes | Amendment + Renewal `executed` events carry `proration: { oldMrcAmount, newMrcAmount, billingCycleStart/End, daysElapsedInCycle, daysRemainingInCycle }`. Billing module computes refund/charge deltas. |
| R-ARC-4: Early Termination Fee | Codified formula `min(remaining_months × MRC × 0.5, 3 × MRC)` in `cpqCancellationService.computeETF` pure function. Value stored at creation for audit; never recomputed at execution. |
| R-ARC-5: Scheduled execution | Amendment + Cancellation support `effective_date`. Amendment scheduler polls every 15 min; Cancellation scheduler daily. Renewal scheduled via `currentTermEnd`. |
| R-ARC-6: Approval workflow integration | Amendment reuses existing quote approval flow (XD-201 state machine). Cancellation has own approval (`requested → approved`). |
| R-ARC-7: Retry + failure handling | `retry_count` field (max 3) + `failed` holding status + `/retry` endpoint on all three request entities. Auto-retry in scheduler within max, manual `/retry` bypasses after exhaustion. |
| R-ARC-8: Prevent concurrent conflict | Validation blocks concurrent non-draft amendment / pending cancellation on same subscription. Optimistic locking via MikroORM `version` column → 409 Conflict. |
| R-ARC-9: Pricing strategy per operation | `pricing_strategy` enum field (rate-lock / current-catalog / mixed) on Amendment and Renewal entities. Subscription-level default (`default_renewal_pricing_strategy`) overridable per operation. |
| R-GEN-1: Product agnostic | No product-specific logic. Operates on generic configuration snapshots from quote lines. |
| R-GEN-2: Open-Close Principle | No modifications to `@open-mercato/*` packages. Extensions via DI, widget injection, event subscribers. |
| R-GEN-3: Multi-tenancy | All queries scoped by `organizationId` + `tenantId`. All entities include both columns. |
| R-GEN-4: Standard integration | References standard `SalesQuote` / `SalesOrder` / `CustomerEntity` IDs. No direct ORM relations cross-module. |
| R-GEN-5: Extensibility via DI | All three new services registered in Awilix, overridable by downstream consumers (customer apps can eject). |

---

## File Changes Summary

### New files

| File | Purpose |
|------|---------|
| `src/modules/cpq/events.ts` | NEW — event declarations via `createModuleEvents` (first events in CPQ module) |
| `src/modules/cpq/subscribers/amendment-executed-log.ts` | Placeholder persistent subscriber for `cpq.amendment.executed` |
| `src/modules/cpq/subscribers/cancellation-executed-log.ts` | Placeholder persistent subscriber for `cpq.cancellation.executed` |
| `src/modules/cpq/subscribers/renewal-executed-log.ts` | Placeholder persistent subscriber for `cpq.renewal.executed` |
| `src/modules/cpq/commands/arc-schedulers.ts` | `registerCommand` for `cpq.arc.execute-amendments`, `execute-cancellations`, `renew-subscriptions` |
| `src/modules/cpq/services/cpqAmendmentService.ts` | Service with createAmendment, submitForApproval, approve/reject/withdraw, execute, retry, processDueAmendments |
| `src/modules/cpq/services/cpqRenewalService.ts` | Service with scheduleRenewal, executeRenewal, walkChain, retry, cancelScheduled, processDueRenewals |
| `src/modules/cpq/services/cpqCancellationService.ts` | Service with createCancellation, computeETF (pure), approve/reject/withdraw, execute, retry, processDueCancellations |
| `src/modules/cpq/api/amendments/route.ts` | POST (create) + GET (list) |
| `src/modules/cpq/api/amendments/[id]/route.ts` | GET (fetch) |
| `src/modules/cpq/api/amendments/[id]/submit-for-approval/route.ts` | POST |
| `src/modules/cpq/api/amendments/[id]/approve/route.ts` | POST |
| `src/modules/cpq/api/amendments/[id]/reject/route.ts` | POST |
| `src/modules/cpq/api/amendments/[id]/withdraw/route.ts` | POST |
| `src/modules/cpq/api/amendments/[id]/retry/route.ts` | POST |
| `src/modules/cpq/api/cancellations/route.ts` | POST + GET |
| `src/modules/cpq/api/cancellations/[id]/route.ts` | GET |
| `src/modules/cpq/api/cancellations/[id]/{approve,reject,withdraw,retry}/route.ts` | POST (4 files) |
| `src/modules/cpq/api/inventory/subscriptions/[id]/renew/route.ts` | POST (manual renewal) |
| `src/modules/cpq/api/inventory/subscriptions/[id]/renewals/route.ts` | GET (history) |
| `src/modules/cpq/api/inventory/subscriptions/[id]/chain/route.ts` | GET (chain walk) |
| `src/modules/cpq/api/inventory/subscriptions/[id]/auto-renew/route.ts` | PATCH |
| `src/modules/cpq/api/inventory/subscriptions/[id]/renewal-pricing-strategy/route.ts` | PATCH |
| `src/modules/cpq/api/renewals/[id]/{cancel,retry}/route.ts` | POST (2 files) |
| `src/modules/cpq/backend/cpq/amendments/` | Admin UI pages (list + detail + wizard) |
| `src/modules/cpq/backend/cpq/cancellations/` | Admin UI pages (list + detail) |

### Modified files

| File | Changes |
|------|---------|
| `src/modules/cpq/data/entities.ts` | Add 4 new entities (CpqAmendmentRequest, CpqAmendmentChange, CpqRenewalTransaction, CpqCancellationRequest). Extend CpqInventorySubscription with `version` (@Property version:true), `previous_subscription_id`, `source_amendment_id`, `source_renewal_id`, `cancellation_request_id`, `default_renewal_pricing_strategy`, `last_billing_date`. Extend CpqQuoteConfiguration with `amendment_request_id`. Extend CpqOrderConfiguration with `amendment_request_id`, `supersedes_order_id`. |
| `src/modules/cpq/data/validators.ts` | Add Zod schemas: `cpqCreateAmendmentSchema`, `cpqApproveAmendmentSchema`, `cpqCreateCancellationSchema`, `cpqManualRenewSchema`, etc. |
| `src/modules/cpq/services/types.ts` | Extend `INVENTORY_SUBSCRIPTION_STATUSES` with `'amended'`, `'renewed'`. Extend `INVENTORY_SUBSCRIPTION_TRANSITIONS.active` with these. Add `amended: []`, `renewed: []` terminal entries. Extend `CPQ_ORDER_STATUSES` with `'superseded'`. Extend `CPQ_ORDER_TRANSITIONS.active` with `'superseded'`. Add `superseded: []` entry. Export new constants: `ARC_AMENDMENT_STATUSES`, `ARC_CANCELLATION_STATUSES`, `ARC_RENEWAL_STATUSES`, `ARC_PRICING_STRATEGIES`. |
| `src/modules/cpq/services/cpqInventoryService.ts` | Update `transitionSubscriptionStatus` to accept new target statuses `amended` and `renewed`. Add execution-time status re-check (for Renewal scheduler). |
| `src/modules/cpq/services/cpqQuotingService.ts` | Add `createAmendmentQuote(sourceQuoteId, amendmentId, pricingStrategy, scope)` — variant of `cloneQuote` that tags the new quote with `amendment_request_id` and respects pricing strategy. |
| `src/modules/cpq/di.ts` | Register `cpqAmendmentService`, `cpqRenewalService`, `cpqCancellationService` following `asFunction + container.resolve` pattern. |
| `src/modules/cpq/acl.ts` | Append 8 features: `cpq.arc.amendment.{view,manage,approve}`, `cpq.arc.renewal.{view,manage}`, `cpq.arc.cancellation.{view,manage,approve}`. |
| `src/modules/cpq/setup.ts` | Add ACL role grants; optionally add default cancellation reason codes to `seedDefaults`; schedule the 3 cron commands in `onTenantCreated`. |
| `src/modules/cpq/index.ts` | No change (module metadata stable; entities auto-discovered). |
| `src/modules/cpq/migrations/Migration20260XXXXXXXXXX_cpq_arc.ts` | AUTO-GENERATED via `yarn db:generate` — DO NOT hand-write. |

---

## Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `400 Bad Request` | Request body fails Zod validation | `{ "error": "Validation error", "details": [...ZodIssue] }` |
| `400 Bad Request` | Amendment `lineChanges` empty | `{ "error": "Amendment must include at least one line change" }` |
| `400 Bad Request` | Amendment `effective_date > currentTermEnd` (and not attached to renewal) | `{ "error": "Effective date exceeds subscription term end" }` |
| `400 Bad Request` | Amendment target subscription not `active` | `{ "error": "Amendment target subscription must be active", "status": "<current>" }` |
| `400 Bad Request` | Cancellation target already terminal | `{ "error": "Target is already in terminal status", "status": "<current>" }` |
| `400 Bad Request` | Renewal target not `active` (manual) | `{ "error": "Renewal target must be active" }` |
| `400 Bad Request` | Withdraw attempted on terminal request | `{ "error": "Cannot withdraw from <status>" }` |
| `400 Bad Request` | Retry attempted on non-`failed` status | `{ "error": "Retry only allowed from failed status" }` |
| `401 Unauthorized` | Missing session or lacking required feature | `{ "error": "Unauthorized" }` |
| `404 Not Found` | Amendment / Cancellation / Renewal not found | `{ "error": "Not found" }` |
| `409 Conflict` | Concurrent amendment exists on same subscription (status `pending` or `approved`) | `{ "error": "Another amendment is in progress for this subscription", "amendmentId": "<id>" }` |
| `409 Conflict` | Non-terminal cancellation exists on target subscription | `{ "error": "Subscription has a pending cancellation", "cancellationId": "<id>" }` |
| `409 Conflict` | Invalid status transition | `{ "error": "Cannot transition from '<current>' to '<target>'" }` |
| `409 Conflict` | Optimistic lock failure (stale `version`) | `{ "error": "Concurrent modification detected", "expectedVersion": <n>, "actualVersion": <m> }` |
| `422 Unprocessable Entity` | ETF computation failure (e.g., invalid numeric in `mrc_amount`) | `{ "error": "ETF computation failed", "reason": "<detail>" }` |
| `500 Internal Server Error` | Unexpected error | `{ "error": "Internal error" }` |

---

## Extensibility Points

Client-specific customization patterns (telco tenants, industry verticals):

### EP-ARC-1: Custom ETF Policies
V1 ETF is codified. For tenants needing per-offering rules (contract type, loyalty tier, regulatory), override `cpqCancellationService.computeETF` via DI — register a `DefaultCpqCancellationService` subclass in customer-specific `@app/src/modules/cpq/di.ts`. Future spec may introduce `CpqEtfPolicy` entity for declarative rules.

### EP-ARC-2: Per-Tenant Amendment Approval Routing
By default Amendment reuses Quote approval flow (linear). For multi-step approval (sales → finance → legal), extend via widget injection on amendment detail page (`crud-form:cpq.arc.amendment:fields` spot) or wrap service method. Alternatively, subscribe to `cpq.amendment.submitted` event and implement custom routing.

### EP-ARC-3: Pricing Strategy Extensions
`pricing_strategy` enum is `'rate-lock' | 'current-catalog' | 'mixed'`. Custom strategies (e.g., `loyalty-discount`, `grandfathered-tier`) can extend by intercepting price computation in `cpqPricingService` (existing extensibility via `registerCpqPricingResolver`). Strategy value itself is text, so new values simply need service-layer support.

### EP-ARC-4: Notification Hooks
All ARC executed events have `clientBroadcast: true` → automatically delivered to UI via SSE. For email/SMS, create a notification module that subscribes persistently to these events. Pattern: `src/modules/notifications-arc/subscribers/*.ts`. No modification to ARC module needed.

### EP-ARC-5: Amendment Change Enrichment
`CpqAmendmentChange` records `before_snapshot` / `after_snapshot` as jsonb. Downstream modules (audit, compliance) can subscribe to `cpq.amendment.executed` and enrich with custom fields (reason categorization, risk classification) via separate audit table, without modifying ARC schema.

### EP-ARC-6: Custom Cancellation Policies
V1: `immediate` and `end-of-term`. For `scheduled` (arbitrary future date), extend via ejecting `cpqCancellationService` and adding policy handling. Recommend keeping the DB enum value limited until V2 formalizes scheduled cancellation.

---

## Design Decisions

### DD-ARC-1: Chain model for Amendment (supersedes XD-215 assumption)

**Decision**: Amendment execution creates a NEW subscription (chain via `previous_subscription_id`), predecessor → terminal `amended` status.

**Alternative considered**: In-place subscription update (what XD-215 informally assumed — "add items to existing subscription"). Simpler, fewer records.

**Why chain wins**:
- Proration support requires clean before/after state — chain gives immutable snapshot of pre-amendment state for audit + billing
- Consistent model with Renewal (also chain) — single mental model for developers
- Historic visibility preserved — old subscription queryable with items frozen at transition
- Simple "current subscription" query via `WHERE status = 'active' AND customer_id = X`
- User decision Q1 explicitly chose chain conditional on proration support

**Cost**: More records per subscription lineage (4 amendments + 3 renewals in 3 years = 8+ records). Mitigated by: chain walk is only needed for audit/history, never for hot-path queries.

### DD-ARC-2: Pricing strategy per-operation (not per-subscription)

**Decision**: `pricing_strategy` field lives on each `CpqAmendmentRequest` / `CpqRenewalTransaction`. Subscription has `default_renewal_pricing_strategy` used when renewal schedules automatically.

**Why**: Business reality — same customer may have different pricing intent per change (rate-lock during amendment to reward retention, current-catalog on renewal to capture catalog updates). Subscription-level only default is inflexible.

**Alternative rejected**: Single subscription-level strategy — too coarse.

### DD-ARC-3: Codified ETF formula (not configurable in V1)

**Decision**: ETF = `min(remaining_months × MRC × 0.5, 3 × MRC)` — hardcoded pure function.

**Why**: 
- V1 simplicity — no config entity, no per-tenant rules yet
- Business can validate single formula against real cancellations before we complicate
- Displayed to user before submit + stored at creation = audit-safe

**Future**: `CpqEtfPolicy` entity with rules per offering/tier/jurisdiction — see EP-ARC-1.

### DD-ARC-4: Events AFTER commit (not transactional outbox)

**Decision**: Emit events via `emitCpqEvent(...)` AFTER `withAtomicFlush(..., { transaction: true })` completes. Use `@open-mercato/events` persistent subscribers for delivery reliability.

**Alternative considered**: Transactional outbox pattern (write event to outbox table in same DB tx; publisher reads outbox and emits).

**Why commit-first**: 
- Open Mercato's events package + queue package provide retry + reliability via BullMQ
- No need for custom outbox infrastructure — framework solves it
- Matches existing core module pattern (see `@open-mercato/core/modules/catalog/events.ts`)
- Commit-first trades a tiny window of "DB committed but event not emitted" (mitigated by operator-driven `/retry` on the request record) for massively simpler code

### DD-ARC-5: Subscription items snapshot per subscription (not migrate)

**Decision**: On chain transition, items are COPIED to new subscription. Old subscription retains its items (frozen in terminal status).

**Alternative considered**: Migrate items (update FK) — fewer records, but old subscription appears empty.

**Why snapshot**: Historical visibility is a primary use case (Q4 answer). Old subscription must be queryable with items intact. Snapshot gives audit-grade frozen record.

**Cost**: 2× item records per amendment. Acceptable — items are small (JSONB config, no blobs).

**Assets handled differently** (migrate FK) — physical/digital items don't duplicate; they're unique instances. See DD-ARC-7.

### DD-ARC-6: Two terminal statuses (`amended` + `renewed`), not single `superseded`

**Decision**: Subscription gets TWO new terminal statuses — `amended` (chain via AmendmentRequest) and `renewed` (chain via RenewalTransaction).

**Alternative considered**: Single `superseded` terminal with discriminator field.

**Why two**: 
- Business-meaningful distinction — "amended = terms changed mid-contract" vs "renewed = term extended/restarted"
- Query simplicity for reporting (e.g., "renewal churn", "amendments per customer/month")
- Zero additional discriminator lookup
- Subscription table already has `source_amendment_id` / `source_renewal_id` for forensic backlink

**Cost**: Two new enum values in types.ts — trivial.

### DD-ARC-7: Assets migrate FK, items snapshot

**Decision** (already covered partly in DD-ARC-5):
- Items → snapshot (copy) per subscription, old items → terminal mirroring parent
- Assets → migrate FK (`subscriptionId`, `subscriptionItemId` pointed at new subscription); removed lines → `cancelled` status stays on OLD subscription for trace

**Why asymmetry**: Items are abstract contract-layer records (cheap to duplicate). Assets are physical/digital unique instances (cannot duplicate — a SIM card exists once). Per Q2 answer on remove-line → `cancelled`.

### DD-ARC-8: Withdrawal detaches amendment (does not cancel) renewal

**Decision**: Withdrawing an amendment attached to a scheduled renewal detaches it (sets `renewal.attached_amendment_id = null`). Renewal proceeds without amendment.

**Alternative considered**: Cancel the renewal too.

**Why detach-default**: Renewal is a business-critical cron-driven process (ensures service continuity). Accidentally cancelling a renewal because operator withdrew an amendment would be bad UX. Explicit "cancel renewal" action remains available via `/renewals/[id]/cancel`.

### DD-ARC-9: CPQ pioneers events.ts

**Decision**: Create `src/modules/cpq/events.ts` — first events for CPQ module.

**Why now**: ARC integration with billing REQUIRES events (async cross-module communication). CPQ's historical synchronous style (no events emitted) would force tight coupling if we extended that pattern. This spec introduces the event surface and sets precedent for future CPQ → other-module integration.

**Migration path for existing CPQ**: Gradually add CRUD events (`cpq.quote.created`, `cpq.order.fulfilled`, etc.) as needs arise. Not required by this spec.

### DD-ARC-10: Scheduler via `@open-mercato/scheduler`, not custom cron

**Decision**: 3 scheduled jobs (`cpq.arc.execute-amendments`, `execute-cancellations`, `renew-subscriptions`) declared as `CommandHandler`s and registered via `registerCommand`. Scheduled via Scheduler module's DB-backed jobs.

**Why**: Framework-native. Ops visibility via `/backend/config/scheduled-jobs`. Retry semantics + queue integration for free.

**Alternative rejected**: External cron or Bull directly — bypasses framework ops UI.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-24 | Initial draft — skeleton with Open Questions, current state audit. |
| 2026-04-24 | Open Questions answered (Q1–Q8 first round). Status → Approved. Initial data model. |
| 2026-04-24 | Review cleanup: bidirectional refs removed, `cancelled` → `withdrawn` on requests, `scheduled` status removed (derived), `target_type=quote` removed, Validation Constraints table, ACL Features section, event naming aligned, Configuration Defaults. |
| 2026-04-24 | **Amendment model flipped to chain** (refined Q1 requiring proration support). Added `amended` status for subscription, `superseded` for order. Codified ETF formula (Q5.a). `pricing_strategy` field (Q6, Q7). Asset & Item Handling section. Proration payload on events. Chain walk endpoint (Q4). Subscription gained `source_amendment_id`, `source_renewal_id`, `default_renewal_pricing_strategy`. |
| 2026-04-24 | Second review pass (bug + gap fixes): (1) `term_version` renamed to `version` for optimistic locking semantics; (2) subscription/order/item state machines in tabular form (no ambiguity re: transitions from `suspended`); (3) `last_billing_date` added to Subscription for proration; (4) renewal execution-time status re-check; (5) original Order transition conditional (`active → superseded`, `fulfilled` stays); (6) RenewalTransaction state machine clarified (`cancelled` only from `scheduled`); (7) amendment approval inline-executes when `effective_date ≤ now`; (8) amendment `reason_code` enum added; (9) item state machine added; (10) concurrent amendment block relaxed to `pending`/`approved` (drafts OK); (11) Process 1 "assets reassigned" → "handled per rules"; added explicit subscription attribute inheritance rules; added `failed` status + retry_count + retry endpoint to AmendmentRequest and CancellationRequest; idempotency requirement on all `execute()` methods; added scheduler double-execution race risk with atomic transition mitigation; added withdrawal-cancels-linked-quote rule; added migration rollback as Phase 4 item. |
| 2026-04-24 | Third pass self-review fixes: (A) subscription state machine `pending → cancelled` corrected to `pending → terminated` (subscription enum has no `cancelled`); (B) added "Amendment attached to renewal" subsection covering effective_date override, amendment lifecycle under renewal, no-duplicate-execution SQL filter, withdrawal-detaches-not-cancels default; (C) Order state machine restricted to preserve existing transitions — only `active → superseded` is truly new, removed over-reaching `draft/pending_activation → cancelled` rows; (D) removed stale "executing" mention from RenewalTransaction state machine note (no such state exists; execution is synchronous). |
| 2026-04-24 | Fourth pass (final polish): (A) removed `cancelled` status from `CpqInventorySubscriptionItem` state machine — item enum does not include `cancelled` (only Asset does); items now transition `pending → active \| terminated` instead; (B) reformatted AmendmentRequest, CancellationRequest, RenewalTransaction state machines to explicit `from → to (trigger)` tables — eliminates ambiguity of previous ASCII-tree with dangling arrows; (C) clarified that `failed` is a non-terminal holding status for all three request entities — `retry_count` gates /retry eligibility but does not change the status itself. |
| 2026-04-24 | **Seventh pass — alignment with project spec conventions.** Cross-referenced XD-201, XD-215 structure. Added: (1) metadata blockquote at top (domain parents, dependencies, supersedes notice for XD-215's informal amendment model, new files/entities/packages, out-of-scope); (2) **UI Integration** section — subscription detail injection points, Amendment Wizard flow, Amendment Detail page, list pages for Cancellations/Renewals, navigation entries, component override extensibility; (3) **Requirements Traceability** table mapping R-ARC-1..9 and R-GEN-1..5 to implementation; (4) **File Changes Summary** — explicit list of 30+ new files and 9 modified files, per phase; (5) **Error Responses** matrix — 16 error conditions with HTTP codes and response body shapes; (6) **Extensibility Points** (EP-ARC-1..6) — custom ETF policies, custom approval routing, pricing strategy extensions, notification hooks, amendment change enrichment, custom cancellation policies; (7) **Design Decisions** (DD-ARC-1..10) — chain amendment rationale (supersedes XD-215), per-operation pricing strategy, codified ETF, commit-first event emission, snapshot-vs-migrate for items-vs-assets, two-terminal-statuses vs single, withdrawal-detaches-not-cancels, CPQ-pioneers-events.ts, scheduler-via-framework. |
| 2026-04-24 | **Sixth pass — senior architect review against Open Mercato framework docs.** Verified `@open-mercato/events`, `@open-mercato/scheduler`, `@open-mercato/queue` exist as dependencies (0.4.10). Key realignments: (1) Removed all "transactional outbox" mentions — replaced with Open Mercato's pattern: `withAtomicFlush` for DB atomicity + emit events AFTER commit via `emitCpqEvent`; persistent subscribers (`@open-mercato/events` + `@open-mercato/queue`) provide delivery reliability. (2) Scheduled jobs use `@open-mercato/scheduler` CommandHandler pattern via `registerCommand` — not custom cron. (3) CPQ currently has NO `events.ts` — ARC introduces first events (pioneer role). (4) Added comprehensive **Implementation Conventions** section covering: migration workflow (entities-first, `yarn db:generate`, never hand-write), DI pattern (`asFunction` + `container.resolve` due to Turbopack + CLASSIC mode), events declaration pattern, subscribers contract, scheduler commands, API route pattern (verified against `quotes/route.ts`), `withAtomicFlush` for multi-phase mutations, ACL format (CPQ uses `{id,title,module}` not flat string array). (5) Phase 1 plan rewritten as concrete step-by-step workflow matching Open Mercato dev loop. (6) Confirmed all required packages already in `package.json` — no new deps needed. |
| 2026-04-24 | **Fifth pass — code verification against actual CPQ source.** Verified [entities.ts](../../src/modules/cpq/data/entities.ts), [types.ts](../../src/modules/cpq/services/types.ts), and service files. Corrections: (1) Existing state machines restored to match real `INVENTORY_SUBSCRIPTION_TRANSITIONS` and `CPQ_ORDER_TRANSITIONS` — `draft → pending_activation, active, cancelled` + `pending_activation → active, cancelled` were real transitions I'd previously restricted; (2) Noted numeric amounts (`mrcAmount`, `nrcAmount`) are stored as string via `numeric(18,4)` — ETF formula updated to use Decimal parsing; (3) Status columns are `text`, not DB enum — added convention note; validation enforced by constants in types.ts; (4) Existing `version` columns on Quote/Spec/Wizard are user-managed counters (e.g., `original.version + 1` in cloneQuote) — NEW `version` fields I'm adding use MikroORM `@Property({ version: true })` for true optimistic locking; clarified distinction; (5) Asset cascade on cancellation — existing code sets all to `cancelled`, not per-type `returned/cancelled` — V1 preserves current behavior; (6) Quote approval flow correction — amendment execution triggers on quote `accepted`, NOT `approved` (approved is intermediate; flows `approved → with_customer → accepted`); (7) `cloneQuote` creates both `SalesQuote` and `CpqQuoteConfiguration` cross-module — noted in Process 1; (8) `last_billing_date` confirmed as NEW field (does not exist on current entity); (9) Added citations to actual file paths and line numbers for verifiable references. |
