/**
 * D6 (spec 2026-11-26 line status) — subscription / item status actions.
 * Pure constants (no ORM / server imports) so client pages can use them;
 * re-exported from `services/types.ts`.
 */
import type { InventorySubscriptionStatus } from '../services/types'

export const SUBSCRIPTION_STATUS_ACTIONS = ['pause', 'suspend', 'grace', 'resume', 'terminate'] as const
export type SubscriptionStatusAction = (typeof SUBSCRIPTION_STATUS_ACTIONS)[number]

export const SUBSCRIPTION_STATUS_ACTION_TARGET: Record<SubscriptionStatusAction, InventorySubscriptionStatus> = {
  pause: 'paused',
  suspend: 'suspended',
  grace: 'grace',
  resume: 'active',
  terminate: 'terminated',
}

/** Statuses an action can be taken from (resume only leaves a stop status). */
export const SUBSCRIPTION_STATUS_ACTION_FROM: Record<SubscriptionStatusAction, InventorySubscriptionStatus[]> = {
  pause: ['active'],
  suspend: ['active', 'grace'],
  grace: ['active'],
  resume: ['paused', 'suspended', 'grace'],
  terminate: ['pending', 'active', 'paused', 'suspended', 'grace'],
}

export const STATUS_CHARGE_BEHAVIORS = ['charge', 'no_charge'] as const
export type StatusChargeBehavior = (typeof STATUS_CHARGE_BEHAVIORS)[number]

/** Billing default per stop status (spec §4.3): paused = no charge; suspended / grace = charge. */
export function defaultChargeBehavior(status: 'paused' | 'suspended' | 'grace'): StatusChargeBehavior {
  return status === 'paused' ? 'no_charge' : 'charge'
}
