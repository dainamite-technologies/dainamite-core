// Centralised CPQ status → OM Tag variant mapping.
//
// All status pills across CPQ must use these maps so the visual contract is
// single-sourced and changes propagate everywhere. Never hand-roll
// `bg-green-100 text-green-800` etc. — the OM design system uses tokenised
// status colors (see `src/app/globals.css` for `--status-{success,warning,
// error,info,neutral}-*`). Reach for `<Tag variant={STATUS_MAP[value]} dot>`.

import type { TagMap } from '@open-mercato/ui/primitives/tag'

// ─── Unified lifecycle (specifications + offerings) ──────────────
//
// Both surfaces collapsed `retired` into `deprecated` after reviewer
// feedback: a single 3-state ladder keeps the UI uniform and the
// "what does retired mean here?" footnote goes away. Existing rows
// were migrated by:
//   - `<timestamp>-merge-spec-retired-into-deprecated.ts`
//   - `<timestamp>-merge-offering-retired-into-deprecated.ts`

export type LifecycleStatus = 'draft' | 'active' | 'deprecated'

export const lifecycleStatusMap: TagMap<LifecycleStatus> = {
  draft: 'neutral',
  active: 'success',
  deprecated: 'warning',
}

/**
 * @deprecated Use `LifecycleStatus` — kept as a re-export to avoid churn
 * in spec detail / list pages that imported this name.
 */
export type SpecificationLifecycleStatus = LifecycleStatus

/** @deprecated Use `lifecycleStatusMap`. */
export const specificationLifecycleStatusMap = lifecycleStatusMap

// ─── Quote CPQ status ────────────────────────────────────────────

export type QuoteCpqStatus =
  | 'new'
  | 'incomplete'
  | 'ready'
  | 'in_approval'
  | 'approved'
  | 'with_customer'
  | 'accepted'
  | 'rejected'
  | 'cancelled'

export const quoteCpqStatusMap: TagMap<QuoteCpqStatus> = {
  new: 'info',
  incomplete: 'warning',
  ready: 'success',
  in_approval: 'brand',
  approved: 'success',
  with_customer: 'info',
  accepted: 'success',
  rejected: 'error',
  cancelled: 'neutral',
}

// ─── Order CPQ status ────────────────────────────────────────────

export type OrderCpqStatus =
  | 'draft'
  | 'pending_activation'
  | 'active'
  | 'fulfilled'
  | 'cancelled'

export const orderCpqStatusMap: TagMap<OrderCpqStatus> = {
  draft: 'info',
  pending_activation: 'warning',
  active: 'success',
  fulfilled: 'success',
  cancelled: 'neutral',
}

// ─── Inventory subscription status ───────────────────────────────

export type SubscriptionStatus =
  | 'pending'
  | 'active'
  | 'suspended'
  | 'terminated'
  | 'expired'
  | 'cancelled'

export const subscriptionStatusMap: TagMap<SubscriptionStatus> = {
  pending: 'info',
  active: 'success',
  suspended: 'warning',
  terminated: 'error',
  expired: 'neutral',
  cancelled: 'neutral',
}

// ─── Inventory asset status ──────────────────────────────────────

export type AssetStatus = 'pending' | 'delivered' | 'active' | 'returned' | 'cancelled'

export const assetStatusMap: TagMap<AssetStatus> = {
  pending: 'info',
  delivered: 'success',
  active: 'success',
  returned: 'warning',
  cancelled: 'neutral',
}

// ─── Pricing rule type ───────────────────────────────────────────

export type PriceRuleType =
  | 'discount_percent'
  | 'discount_absolute'
  | 'surcharge_percent'
  | 'surcharge_absolute'
  | 'price_override'

export const priceRuleTypeMap: TagMap<PriceRuleType> = {
  discount_percent: 'success',
  discount_absolute: 'success',
  surcharge_percent: 'warning',
  surcharge_absolute: 'warning',
  price_override: 'info',
}

// ─── Charge type ─────────────────────────────────────────────────

export type ChargeType = 'mrc' | 'nrc' | 'usage'

export const chargeTypeMap: TagMap<ChargeType> = {
  mrc: 'info',
  nrc: 'success',
  usage: 'brand',
}

// ─── Helper to format a status into a human label ────────────────

/**
 * Normalises a snake_case status to a Title Case display label.
 * `pending_activation` → `Pending Activation`.
 */
export function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
