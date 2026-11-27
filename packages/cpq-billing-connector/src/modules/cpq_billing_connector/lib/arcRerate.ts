import {
  billingItemCreateFields,
  billingPeriodSuffix,
  mapCharge,
  reportRejectedCharges,
  type CpqChargeBillingPeriod,
  type CpqSubscriptionItem,
  type RejectedCharge,
} from './chargeMapper'
import type { BillingApiClient, CreditReasonCode, ItemCreatePayload, ItemUpdatePayload, Scope } from './billingApiClient'
import { buildArcEndDateUpdate } from './arcEndDate'

/**
 * Re-rating of a subscription item whose recurring price changed on an ARC
 * quote (`changedItems` of `cpq.subscription.amended` / `renewed`, #126).
 * Pure.
 *
 * The item's current recurring Billing Items end the day before the change
 * takes effect, and new recurring Billing Items at the new price start on
 * that day — one per billing period of the item (contract C2/C3: a changed
 * item is split per period, each with its own period and phases). One-time
 * charges are never re-billed. If billing cannot take one of the new charges
 * (e.g. more than 12 phases), the item is left on its current price and the
 * refusal is logged: ending the old items would stop billing that period. The new item's source ref
 * carries the order id (or the effective date), so a re-delivered event is
 * deduplicated by billing and never ends the item it created itself.
 */

export type RerateExistingItem = {
  id: string
  type: string
  sourceRef?: string | null
  billStartDate: Date | string
  billEndDate?: Date | string | null
}

export type RerateChange = {
  subscriptionId: string
  /** YYYY-MM-DD the new price applies from. */
  effectiveDate: string
  /** CPQ order id; falls back to the effective date in the source ref. */
  sourceOrderId?: string | null
  code: CreditReasonCode
  reference?: string | null
}

/**
 * Source ref of a re-rated recurring Billing Item. The every-1-month charge
 * keeps the original ref byte-identical (idempotency of events delivered
 * before line periods existed); a charge with its own period appends the C3
 * period key (`…-rerate-<key>-1y`).
 */
export function reratedSourceRef(
  subscriptionId: string,
  subscriptionItemId: string,
  key: string,
  billingPeriod?: CpqChargeBillingPeriod,
): string {
  const base = `cpq-${subscriptionId}-${subscriptionItemId}-recurring-rerate-${key}`
  const suffix = billingPeriodSuffix(billingPeriod)
  return suffix ? `${base}-${suffix}` : base
}

function rerateKey(change: RerateChange): string {
  return change.sourceOrderId || change.effectiveDate
}

function recurringCharges(item: CpqSubscriptionItem) {
  return (item.charges ?? []).filter((charge) => charge.type === 'recurring')
}

/** Refs of every item this re-rate creates (one per billing period). */
export function ownRerateRefs(item: CpqSubscriptionItem, change: RerateChange): Set<string> {
  return new Set(
    recurringCharges(item).map((charge) =>
      reratedSourceRef(change.subscriptionId, item.subscriptionItemId, rerateKey(change), charge.billingPeriod),
    ),
  )
}

/**
 * End-date updates for the item's current recurring Billing Items — every
 * period of the item: the changed item's charges replace all of them.
 */
export function buildRerateEndUpdates(
  existing: RerateExistingItem[],
  item: CpqSubscriptionItem,
  change: RerateChange,
): ItemUpdatePayload[] {
  const ownRefs = ownRerateRefs(item, change)
  return existing
    .filter((candidate) => candidate.type === 'recurring' && !(candidate.sourceRef && ownRefs.has(candidate.sourceRef)))
    .map((candidate) =>
      buildArcEndDateUpdate(candidate, { effectiveDate: change.effectiveDate, code: change.code, reference: change.reference }),
    )
    .filter((update): update is ItemUpdatePayload => update !== null)
}

/**
 * The new recurring Billing Items at the changed price, one per billing
 * period (contract C2: a changed item is split per period too), each with
 * its own period and phases. A charge with a zero price is not billed.
 * `rejected` lists charges billing cannot take (see `mapCharge`).
 */
export function buildReratedItems(
  billAccountId: string,
  item: CpqSubscriptionItem,
  change: RerateChange,
): { created: ItemCreatePayload[]; rejected: RejectedCharge[] } {
  const created: ItemCreatePayload[] = []
  const rejected: RejectedCharge[] = []
  for (const charge of recurringCharges(item)) {
    if (typeof charge.unitPrice === 'number' && charge.unitPrice <= 0 && !(charge.phases && charge.phases.length > 0)) continue
    const mapped = mapCharge({
      subscriptionId: change.subscriptionId,
      subscriptionItem: item,
      charge,
      billStartDate: change.effectiveDate,
    })
    const sourceRef = reratedSourceRef(change.subscriptionId, item.subscriptionItemId, rerateKey(change), charge.billingPeriod)
    if (!mapped.ok) {
      rejected.push({ ...mapped.rejection, sourceRef })
      continue
    }
    created.push({ billAccountId, ...billingItemCreateFields(mapped.payload), sourceRef })
  }
  return { created, rejected }
}

/**
 * The new recurring Billing Item at the changed price of the item's first
 * recurring charge, or null when there is none (or it is refused / zero).
 * Kept for callers of the single-period API; `buildReratedItems` covers
 * every period.
 */
export function buildReratedItemPayload(
  billAccountId: string,
  item: CpqSubscriptionItem,
  change: RerateChange,
): ItemCreatePayload | null {
  const first = recurringCharges(item)[0]
  if (!first) return null
  return buildReratedItems(billAccountId, { ...item, charges: [first] }, change).created[0] ?? null
}

/**
 * Applies the re-rating of every changed item: the new recurring Billing Item
 * first (deduplicated on re-delivery), then the end dates of the old ones.
 */
export async function applyRerates(
  billingApi: Pick<BillingApiClient, 'findItemsBySubscriptionItem' | 'bulkCreateItems' | 'updateItem'>,
  scope: Scope,
  billAccountId: string,
  changedItems: CpqSubscriptionItem[],
  change: RerateChange,
  event = 'cpq.subscription.amended',
): Promise<void> {
  for (const item of changedItems) {
    const existing = (await billingApi.findItemsBySubscriptionItem(scope, item.subscriptionItemId)) as RerateExistingItem[]
    const { created, rejected } = buildReratedItems(billAccountId, item, change)
    if (rejected.length > 0) {
      // A refused charge would leave its period unbilled once the old items
      // end: keep the item on its current price and report it instead.
      reportRejectedCharges(event, rejected)
      continue
    }
    if (created.length > 0) await billingApi.bulkCreateItems(scope, created)
    for (const update of buildRerateEndUpdates(existing, item, change)) {
      await billingApi.updateItem(scope, update)
    }
  }
}
