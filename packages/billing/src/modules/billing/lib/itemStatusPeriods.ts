import { cloneAtMidnight } from './billPeriod'

/**
 * Dated line status on a billing item (line-period-and-status spec §4.3).
 *
 *   paused     the customer asked to stop — no recurring charge for paused
 *              days (default `no_charge`; `charge` keeps billing)
 *   suspended  the provider cut the service — keeps charging by default;
 *              `no_charge` per suspension
 *   grace      payment overdue, service on — a flag only, billed normally
 *
 * A status is a period `[from, to]` (`to` null = open). Periods on one item
 * never overlap; resuming = setting `to` on the open period. Usage lines are
 * never affected. Pure helpers — the engine and commands share them.
 */

export const ITEM_STATUSES = ['paused', 'suspended', 'grace'] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]

export const STATUS_CHARGE_BEHAVIORS = ['charge', 'no_charge'] as const
export type StatusChargeBehavior = (typeof STATUS_CHARGE_BEHAVIORS)[number]

export const STATUS_PERIOD_OVERLAP = 'billing.item.status_period_overlap'
export const STATUS_PERIOD_READ_ONLY = 'billing.item.status_period_read_only'
export const STATUS_PERIOD_RECURRING_ONLY = 'billing.item.status_period_recurring_only'
export const STATUS_PERIOD_END_BEFORE_START = 'billing.item.status_period_end_before_start'

export function defaultChargeBehavior(status: ItemStatus): StatusChargeBehavior {
  return status === 'paused' ? 'no_charge' : 'charge'
}

export type StatusPeriodLike = {
  id?: string | null
  status: ItemStatus | string
  fromDate: Date | string
  toDate?: Date | string | null
  chargeBehavior?: StatusChargeBehavior | string | null
  deletedAt?: Date | string | null
}

/** True when the period removes the recurring charge for its days. */
export function isNoCharge(period: Pick<StatusPeriodLike, 'status' | 'chargeBehavior'>): boolean {
  if (period.status === 'grace') return false
  const behavior = period.chargeBehavior ?? defaultChargeBehavior(period.status as ItemStatus)
  return behavior === 'no_charge'
}

function ms(value: Date | string | null | undefined, open: number): number {
  return value ? cloneAtMidnight(value).getTime() : open
}

/** First period on the item (ignoring `excludeId` and deleted rows) overlapping `[from, to]`. */
export function findOverlap<T extends StatusPeriodLike>(
  existing: readonly T[],
  candidate: { fromDate: Date | string; toDate?: Date | string | null },
  excludeId?: string | null,
): T | null {
  const from = ms(candidate.fromDate, -Infinity)
  const to = ms(candidate.toDate, Infinity)
  for (const row of existing) {
    if (row.deletedAt) continue
    if (excludeId && row.id === excludeId) continue
    const rFrom = ms(row.fromDate, -Infinity)
    const rTo = ms(row.toDate, Infinity)
    if (rFrom <= to && from <= rTo) return row
  }
  return null
}

/** The status in force on `today` (YYYY-MM-DD or Date), or null when active. */
export function statusOn<T extends StatusPeriodLike>(periods: readonly T[], today: Date | string): T | null {
  const t = ms(today, 0)
  return periods.find((p) => !p.deletedAt && ms(p.fromDate, -Infinity) <= t && t <= ms(p.toDate, Infinity)) ?? null
}

/**
 * D6: CPQ owns the status of CPQ lines (items with a `subscriptionId`).
 * Billing UI / REST callers are refused; the connector calls the commands
 * with a system context (`auth: null`).
 */
export function isStatusWriteAllowed(item: { subscriptionId?: string | null }, auth: unknown): boolean {
  if (!item.subscriptionId) return true
  return auth === null || auth === undefined
}
