# Carry quote costs to orders and subscriptions (no billing impact) with ARC safety

- Date: 2026-11-11
- Category: feature
- Priority signal: high — §7 Phase 1 (completes WF5; makes WF6 safe before carry-over)
- Risk signal: medium — touches conversion and activation transactions and the ARC freeze; billing byte-identity (I-9) must hold
- Routing: om-spec-writing "Carry quote costs to orders and subscriptions (no billing impact) with ARC safety — brief: .ai/specs/briefs/2026-11-11-cpq-cost-plus-order-subscription-costs.md"
- App Spec: .ai/specs/2026-11-11-app-spec-cpq-cost-plus-pricing.md — sections §1.4 (R7, R12, R13 Phase 1 safety, I-6, I-7, I-9, I-10), §3 (WF5, WF6 reality check), §3.5, §5 (US-3.5, US-5.1, US-5.3, US-6.5), §7 Phase 1
- Depends on: `2026-11-11-cpq-cost-plus-quote-pricing-margin.md`

## Problem

Costs priced on a quote vanish after conversion. Renewals then start blind, and nobody knows what a live subscription costs to deliver. WF5 ROI: 100% of activated costed items have their contracted cost recorded, with 0 billing changes. Without a safety net, a Renew would re-price cost-plus mirror lines with no costs, and Cancel would leave live costs on dead items.

## Agreed direction

- Commits #17b–#20a (user decision 2026-11-12: orders and subscriptions have their own cost entities):
  - The conversion guard R7 and the post-conversion price freeze moved to the quote pricing and margin feature on 2026-11-12.
  - `CpqOrderLineCost`: every quote cost line is copied at conversion, in the same transaction (same `cost_key`, `source_quote_line_cost_id`).
  - `CpqSubscriptionItemCost`: **one row per item and `cost_key`, whose id stays the same for the life of the purchase**. It is created at the first activation (unique `(subscription_item_id, cost_key)`), updated in place by later changes, re-pointed on merge, and ended on cancel / removal.
  - **Cost history uses the existing `CpqSubscriptionChangeLog`, with no new entity.** That log is already the history of subscription items: one row per subscription per order, with full before / after snapshots and quote / order links. `snapshotSubscription` (`cpqInventoryService.ts:1506`) adds `items[].costs[]`, and the change-log API strips `costs` for users without `cpq.costs.view`. `CpqOrderLineCost.subscription_item_cost_id` links each order cost to the item cost it set. Each created / changed / ended item cost emits `cpq.subscription.item_cost_changed`.
  - Order and subscription UI: order costs and margin; item costs and margin; cost before → after per order inside the existing Change History (`backend/cpq/inventory/subscriptions/[id]/page.tsx:754-790`, `ChangeLogLineDetails`). Gated server-side on `cpq.costs.view` (reps read-only).
  - ARC safety:
    - Renew mirror lines with cost-plus charges are frozen, with a banner.
    - Minimal activation write-back: Cancel / removal ends item costs; a re-priced mirror updates them in place. Ids are kept, and the changes show in the change-log snapshots.
- **Ladder:** conversion / activation services and `arcPriceFreeze` (rung 1, grounded C7, C8); new entity and UI (rung 5).
- **Rejected:** orders reading quote cost lines (architect #1 proposal, overruled by the user on 2026-11-12); close-and-reopen item cost rows (ids would change per purchase); costs in billing payloads.

## Resolved unknowns

| Question | Answer (from the App Spec) |
|----------|----------------------------|
| Billing | Unchanged payloads, byte-identical (I-9) |
| Index revaluation of item costs | No — frozen until the next ARC (Q-D9) |
| Item margin | Item MRC amount − Σ open MRC item costs × quantity; NRC once at activation (WF5) |
| Entity fields | §1.4.6 last paragraphs (`CpqOrderLineCost`, `CpqSubscriptionItemCost`, cost history in `CpqSubscriptionChangeLog`) |
| Acceptance criteria | §7 Phase 1 I-6 / R7 and I-7 / I-9 / I-10 domain criteria; business criteria on conversion, activation, Renew, Cancel |

## Non-goals

- Carried costs on ARC quotes, price lock, Re-price from cost, renegotiation (ARC feature); post-conversion re-confirmation (ARC feature, Q-D13).

## Affected areas (if known)

- `packages/cpq/src/modules/cpq/services/cpqOrderService.ts`, `services/cpqInventoryService.ts`, `services/arcPriceFreeze.ts`, `data/entities.ts`, `migrations/`, `events.ts`, `backend/cpq/orders/[id]`, `backend/cpq/inventory/subscriptions/[id]`, `widgets/injection/order-cpq-tab`.
- No upstream dependencies.
