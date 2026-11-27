import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'
import {
  planStatusWrites,
  type ChargeBehavior,
  type CpqItemStatus,
  type ExistingStatusPeriod,
  type StatusTargetItem,
} from '../lib/itemStatus'
import { resolveBillingItemKeys } from '../lib/subscriptionItemTargets'

/**
 * Subscriber: `cpq.subscription_item.status_changed` → billing line status
 * periods (spec `2026-11-26-billing-line-period-and-status.md` §4.3, D6,
 * contract C3).
 *
 * CPQ pauses, suspends, puts in grace or resumes a whole subscription or one
 * item (`cpqInventoryService.applyStatusAction`, emitted after commit). For
 * every Billing Item of the affected items (and of their devices) the
 * connector:
 *   - paused / suspended / grace → creates a status period from `fromDate`
 *     (to `toDate`, or open) with the charge behaviour and reason;
 *   - active (resume) → sets `toDate = fromDate − 1` on the open period.
 * The rules, including replay idempotency, live in `lib/itemStatus.ts`.
 * The writes go through `billing.items.status_periods.*` with a system
 * context (`auth: null`) — the only path billing accepts for CPQ lines.
 *
 * The Bill Run does the money: no-charge days not yet billed are skipped,
 * days already billed are credited on the next run (and re-charged when a
 * resume shortens a pause).
 */

export const metadata = {
  event: 'cpq.subscription_item.status_changed',
  persistent: true,
  id: 'cpq-billing-connector:subscription-item-status-changed',
}

export type StatusChangedPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  subscriptionItemIds: string[]
  status: CpqItemStatus
  /** YYYY-MM-DD; for a resume the first day running again. */
  fromDate: string
  toDate?: string | null
  chargeBehavior?: ChargeBehavior
  reason?: string | null
}

const STATUSES: ReadonlySet<string> = new Set(['paused', 'suspended', 'grace', 'active'])
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export type StatusBillingPort = Pick<
  BillingApiClient,
  'findItemsBySubscriptionItem' | 'findStatusPeriods' | 'createStatusPeriod' | 'updateStatusPeriod' | 'deleteStatusPeriod'
>

function isOverlap(err: unknown): boolean {
  const body = (err as { body?: { code?: unknown } } | null)?.body
  return body?.code === 'billing.item.status_period_overlap'
}

/** Applies the status change to the Billing Items keyed by `keys`. Exported for tests. */
export async function applyStatusChange(
  billing: StatusBillingPort,
  scope: Scope,
  payload: StatusChangedPayload,
  keys: string[],
): Promise<void> {
  const byId = new Map<string, StatusTargetItem>()
  for (const key of keys) {
    for (const item of (await billing.findItemsBySubscriptionItem(scope, key)) as StatusTargetItem[]) byId.set(item.id, item)
  }
  const items = [...byId.values()]
  if (items.length === 0) return
  const periods = (await billing.findStatusPeriods(scope, items.map((item) => item.id))) as ExistingStatusPeriod[]
  const plan = planStatusWrites(items, periods, payload)

  for (const conflict of plan.conflicts) {
    console.error('[cpq-billing-connector] status period not created: another status already starts in that range', {
      event: metadata.event,
      subscriptionId: payload.subscriptionId,
      requestedStatus: payload.status,
      requestedFromDate: payload.fromDate,
      ...conflict,
    })
  }

  for (const write of plan.writes) {
    if (write.kind === 'update') await billing.updateStatusPeriod(scope, { id: write.id, toDate: write.toDate })
    else if (write.kind === 'delete') await billing.deleteStatusPeriod(scope, write.id)
    else {
      const { kind: _kind, ...input } = write
      try {
        await billing.createStatusPeriod(scope, input)
      } catch (err) {
        // A concurrent delivery got there first: billing's overlap check is
        // the backstop of the replay rule, not a failure of the event.
        if (!isOverlap(err)) throw err
        console.warn('[cpq-billing-connector] status period already present (overlap), skipped', {
          billingItemId: write.billingItemId,
          status: write.status,
          fromDate: write.fromDate,
        })
      }
    }
  }
}

export default async function handle(payload: StatusChangedPayload): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId || !payload.subscriptionId) return
  if (!STATUSES.has(payload.status) || !ISO_DAY.test(payload.fromDate ?? '')) return
  const itemIds = Array.isArray(payload.subscriptionItemIds) ? payload.subscriptionItemIds.filter(Boolean) : []
  if (itemIds.length === 0) return

  const container = await createRequestContainer()
  const billingApi = new BillingApiClient(container)
  const scope: Scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const keys = await resolveBillingItemKeys(container, scope, payload.subscriptionId, itemIds)
  await applyStatusChange(billingApi, scope, payload, keys)
}
