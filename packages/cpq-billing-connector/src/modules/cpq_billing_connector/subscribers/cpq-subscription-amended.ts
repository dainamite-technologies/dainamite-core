import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { cycleContaining } from '@dainamite/billing/modules/billing/lib/billPeriod'
import type { BillCycle } from '@dainamite/billing/modules/billing/data/validators'
import { BillingApiClient, type Scope } from '../lib/billingApiClient'
import {
  mapSubscriptionItemsToBillingItems,
  type CpqSubscriptionItem,
} from '../lib/chargeMapper'
import {
  computeProration,
  formatProrationDescription,
} from '../lib/prorationHelper'

/**
 * Subscriber: `cpq.subscription.amended` → mid-cycle add / remove.
 *
 * CPQ's amended event carries `addedItems`, `removedSubscriptionItemIds`
 * and the `effectiveDate` of the amendment. The connector:
 *   1. Creates a Billing Item for every added charge — recurring items
 *      start on `effectiveDate`; the engine's mid-cycle rule skips the
 *      current cycle and bills from the next full cycle.
 *   2. For every added RECURRING charge, posts a `one_time` proration
 *      line covering the partial current cycle. The billing cycle is
 *      derived HERE (not in CPQ) — proration is a billing concept, so
 *      the connector computes it from the account's `nextBillDate` +
 *      `billCycle` via billing's `cycleContaining`.
 *   3. End-dates every Billing Item of each removed subscription item
 *      at `effectiveDate - 1 day`.
 */

export const metadata = {
  event: 'cpq.subscription.amended',
  persistent: true,
  id: 'cpq-billing-connector:subscription-amended',
}

type AmendedPayload = {
  tenantId: string
  organizationId: string
  subscriptionId: string
  customerId: string
  /** YYYY-MM-DD; the date the amend takes effect mid-cycle. */
  effectiveDate: string
  addedItems?: CpqSubscriptionItem[]
  removedSubscriptionItemIds?: string[]
}

const DAY_MS = 86_400_000

function toMidnightMs(value: Date | string): number {
  const d =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(`${value}T00:00:00.000Z`)
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

/** Inclusive day count from `from` through `to`. */
function inclusiveDays(from: Date | string, to: Date | string): number {
  return Math.round((toMidnightMs(to) - toMidnightMs(from)) / DAY_MS) + 1
}

function isoDateMinusOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default async function handle(payload: AmendedPayload): Promise<void> {
  if (!payload?.tenantId || !payload.organizationId) return
  if (!payload.subscriptionId || !payload.effectiveDate) return

  const added = payload.addedItems ?? []
  const removed = payload.removedSubscriptionItemIds ?? []
  if (added.length === 0 && removed.length === 0) return

  const container = await createRequestContainer()
  const billingApi = new BillingApiClient(container)
  const scope: Scope = {
    tenantId: payload.tenantId,
    organizationId: payload.organizationId,
  }

  // Activation runs first and creates the account. If it's missing,
  // there is nothing to amend — the queue will have retried activation.
  const account = await billingApi.findAccountByCustomer(scope, payload.customerId)
  if (!account) return

  // 1. New Billing Items for every added charge.
  const itemsToCreate = mapSubscriptionItemsToBillingItems({
    subscriptionId: payload.subscriptionId,
    items: added,
    billStartDate: payload.effectiveDate,
  }).map((item) => ({
    billAccountId: account.id,
    type: item.type,
    billStartDate: item.billStartDate,
    description: item.description,
    rateJson: item.rateJson,
    subscriptionId: item.subscriptionId,
    subscriptionItemId: item.subscriptionItemId,
    sourceRef: item.sourceRef,
  }))

  // 2. Mid-cycle proration. The billing cycle the amend lands in is
  // derived from the account here — CPQ does not own the billing cycle.
  if (added.length > 0) {
    const period = cycleContaining(
      account.nextBillDate,
      account.billCycle as BillCycle,
      payload.effectiveDate,
    )
    const cycleEnd = period.periodEnd.toISOString().slice(0, 10)
    const daysInPeriod = inclusiveDays(period.periodStart, period.periodEnd)
    const daysRemaining = inclusiveDays(payload.effectiveDate, period.periodEnd)

    for (const addedItem of added) {
      for (const charge of addedItem.charges) {
        if (charge.type !== 'recurring' || typeof charge.unitPrice !== 'number') {
          continue
        }
        const { amount } = computeProration({
          unitPrice: charge.unitPrice,
          quantity: addedItem.quantity,
          daysInPeriod,
          daysRemaining,
        })
        if (amount === 0) continue
        itemsToCreate.push({
          billAccountId: account.id,
          type: 'one_time',
          billStartDate: payload.effectiveDate,
          description: formatProrationDescription({
            productName: addedItem.productName,
            effectiveDate: payload.effectiveDate,
            cycleEnd,
          }),
          rateJson: { amount },
          subscriptionId: payload.subscriptionId,
          subscriptionItemId: addedItem.subscriptionItemId,
          sourceRef: `cpq-${payload.subscriptionId}-${addedItem.subscriptionItemId}-proration-${payload.effectiveDate}`,
        })
      }
    }
  }

  await billingApi.bulkCreateItems(scope, itemsToCreate)

  // 3. End-date every Billing Item of each removed subscription item.
  const endDate = isoDateMinusOneDay(payload.effectiveDate)
  for (const removedSubItemId of removed) {
    const items = await billingApi.findItemsBySubscriptionItem(scope, removedSubItemId)
    for (const item of items) {
      await billingApi.updateItem(scope, {
        id: item.id,
        billEndDate: endDate,
      })
    }
  }
}
