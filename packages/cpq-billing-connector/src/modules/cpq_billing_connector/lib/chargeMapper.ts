/**
 * CPQ charge → billing item create payload mapping.
 *
 * CPQ subscription events carry an `items[].charges[]` array where
 * each charge has `type: 'one_time' | 'recurring'`, an optional
 * `amount` (for one-time) or `unitPrice` (for recurring), and a
 * description. This module turns each charge into the
 * `billing.items.create` payload shape (one Billing Item per charge,
 * not per CPQ subscription item — per the spec: "If a CPQ
 * subscription item has both a one-time charge … and a recurring
 * charge …, the connector creates two separate Billing Items").
 *
 * `sourceRef` is built deterministically:
 *   `cpq-<subscriptionId>-<subscriptionItemId>-<charge.type>`
 * so re-firing the same activation event hits the `(tenant_id,
 * bill_account_id, source_ref)` unique constraint and the duplicate
 * is dropped with `deduplicated: true` instead of creating a second
 * item.
 */

export type CpqChargeType = 'one_time' | 'recurring'

export type CpqCharge = {
  type: CpqChargeType
  amount?: number
  unitPrice?: number
  description: string
}

export type CpqSubscriptionItem = {
  subscriptionItemId: string
  productName: string
  quantity: number
  charges: CpqCharge[]
}

export type BillingItemPayload = {
  type: CpqChargeType
  description: string
  rateJson: { amount: number } | { unit_price: number }
  subscriptionId: string
  subscriptionItemId: string
  sourceRef: string
  billStartDate: string
}

export function buildSourceRef(
  subscriptionId: string,
  subscriptionItemId: string,
  chargeType: CpqChargeType,
): string {
  return `cpq-${subscriptionId}-${subscriptionItemId}-${chargeType}`
}

/**
 * Map a single CPQ charge to a billing.items.create payload.
 * Returns `null` if the charge is missing the required price field
 * for its type — surfaces malformed CPQ payloads to the subscriber
 * which can log + skip instead of crashing.
 */
export function mapChargeToBillingItem(params: {
  subscriptionId: string
  subscriptionItem: CpqSubscriptionItem
  charge: CpqCharge
  /** YYYY-MM-DD; typically the subscription activation date. */
  billStartDate: string
}): BillingItemPayload | null {
  const { subscriptionId, subscriptionItem, charge, billStartDate } = params

  if (charge.type === 'one_time') {
    if (typeof charge.amount !== 'number') return null
    return {
      type: 'one_time',
      description: `${subscriptionItem.productName} — ${charge.description}`,
      rateJson: { amount: charge.amount },
      subscriptionId,
      subscriptionItemId: subscriptionItem.subscriptionItemId,
      sourceRef: buildSourceRef(subscriptionId, subscriptionItem.subscriptionItemId, 'one_time'),
      billStartDate,
    }
  }

  // recurring
  if (typeof charge.unitPrice !== 'number') return null
  return {
    type: 'recurring',
    description: `${subscriptionItem.productName} — ${charge.description}`,
    rateJson: { unit_price: charge.unitPrice },
    subscriptionId,
    subscriptionItemId: subscriptionItem.subscriptionItemId,
    sourceRef: buildSourceRef(subscriptionId, subscriptionItem.subscriptionItemId, 'recurring'),
    billStartDate,
  }
}

/**
 * Map every charge on every subscription item in a CPQ payload to
 * billing item payloads. Skips charges that fail the per-charge
 * mapping (returns `null`) — the connector logs those rather than
 * partially-failing the whole event.
 */
export function mapSubscriptionItemsToBillingItems(params: {
  subscriptionId: string
  items: CpqSubscriptionItem[]
  billStartDate: string
}): BillingItemPayload[] {
  const out: BillingItemPayload[] = []
  for (const item of params.items) {
    for (const charge of item.charges) {
      const mapped = mapChargeToBillingItem({
        subscriptionId: params.subscriptionId,
        subscriptionItem: item,
        charge,
        billStartDate: params.billStartDate,
      })
      if (mapped) out.push(mapped)
    }
  }
  return out
}
