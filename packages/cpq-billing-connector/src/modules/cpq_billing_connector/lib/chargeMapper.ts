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
 * Contract C3 (run plan 2026-11-26 billing/CPQ flex):
 *   - A recurring charge's `billingPeriod` (absent = every 1 month) becomes
 *     the item's own billing period. Every 1 month maps to `null` (follow the
 *     account cycle — unchanged behaviour); `{month,N}` → `monthly`/N,
 *     `{year,N}` → `annually`/N. A month count above billing's monthly cap
 *     that is a whole number of years goes out as `annually` (same period).
 *   - `charges[].phases` (CPQ's merged item schedule) becomes billing price
 *     phases in the same create write: `durationUnit: 'month'`,
 *     `priceType: 'fixed'`, `phasesEnabled: true`.
 *
 * `sourceRef` is built deterministically:
 *   `cpq-<subscriptionId>-<subscriptionItemId>-<charge.type>`
 * plus, for a recurring charge that is not every 1 month, the period key
 * `-<interval><m|y>` (e.g. `…-recurring-1y`). The every-1-month ref is
 * byte-identical to before, so re-firing the same activation event hits the
 * `(tenant_id, bill_account_id, source_ref)` unique constraint and the
 * duplicate is dropped with `deduplicated: true` instead of creating a second
 * item.
 *
 * A charge billing cannot take is **refused**, never trimmed: a missing
 * price, an invalid period, or more phases than billing's cap
 * (`MAX_PHASES_PER_ITEM`). Billing would reject the whole bulk write for one
 * bad entry; dropping phases silently would bill the regular price during a
 * sold promotion. The refusal is returned to the subscriber, which logs it
 * (`reportRejectedCharges`) and creates the item's other charges.
 */
import { BILL_CYCLE_INTERVAL_MAX } from '@dainamite/billing/modules/billing/lib/billCycle'
import { MAX_PHASES_PER_ITEM } from '@dainamite/billing/modules/billing/lib/pricePhases'

export type CpqChargeType = 'one_time' | 'recurring'

/** C2: the price period of a recurring charge; absent = every 1 month. */
export type CpqChargeBillingPeriod = {
  unit: 'month' | 'year'
  interval: number
}

/** C2: one merged phase, back to back from the item start, priced per the charge's period. */
export type CpqChargePhase = {
  name: string | null
  months: number
  priceType: 'fixed'
  value: number
}

export type CpqCharge = {
  type: CpqChargeType
  amount?: number
  unitPrice?: number
  description: string
  billingPeriod?: CpqChargeBillingPeriod
  phases?: CpqChargePhase[]
}

export type CpqSubscriptionItem = {
  subscriptionItemId: string
  /** Sales order line id behind the item (`cpq.subscription.activated` only). */
  orderLineId?: string
  /** The line's service start, `YYYY-MM-DD` (`cpq.subscription.activated` only). */
  startDate?: string
  productName: string
  quantity: number
  charges: CpqCharge[]
}

export type BillingItemPhasePayload = {
  name: string | null
  durationUnit: 'month'
  durationCount: number
  priceType: 'fixed'
  value: number
}

export type BillingItemPayload = {
  type: CpqChargeType
  description: string
  rateJson: { amount: number } | { unit_price: number }
  subscriptionId: string
  subscriptionItemId: string
  sourceRef: string
  billStartDate: string
  /** Own billing period; omitted = follow the account cycle. */
  billingPeriodUnit?: 'monthly' | 'annually'
  billingPeriodInterval?: number
  /** Present only when the charge has phases. */
  phasesEnabled?: true
  phases?: BillingItemPhasePayload[]
}

export type ChargeRejectionReason =
  | 'missing_amount'
  | 'missing_unit_price'
  | 'invalid_billing_period'
  | 'invalid_phase'
  | 'too_many_phases'

export type RejectedCharge = {
  subscriptionId: string
  subscriptionItemId: string
  chargeType: CpqChargeType
  /** The ref the item would have had (identifies the charge in the log). */
  sourceRef: string
  reason: ChargeRejectionReason
  detail: string
}

export type ChargeMapResult =
  | { ok: true; payload: BillingItemPayload }
  | { ok: false; rejection: RejectedCharge }

/** Billing caps a phase name at 120 characters; a merged name ("A + B + …") can be longer. */
const MAX_PHASE_NAME = 120

function isDefaultPeriod(period: CpqChargeBillingPeriod | undefined): boolean {
  return !period || (period.unit === 'month' && period.interval === 1)
}

/** The C3 suffix key: `3m`, `1y` (matches CPQ's `billingPeriodKey`). */
export function billingPeriodSuffix(period: CpqChargeBillingPeriod | undefined): string | null {
  if (isDefaultPeriod(period)) return null
  return `${period!.interval}${period!.unit === 'year' ? 'y' : 'm'}`
}

/**
 * The billing item period of a CPQ charge period: `null` = follow the account
 * (every 1 month), a `{ unit, interval }` billing accepts, or `'invalid'`.
 */
export function mapBillingPeriod(
  period: CpqChargeBillingPeriod | undefined,
): { unit: 'monthly' | 'annually'; interval: number } | null | 'invalid' {
  if (period === undefined || period === null) return null
  if (typeof period !== 'object' || (period.unit !== 'month' && period.unit !== 'year')) return 'invalid'
  const interval = period.interval
  if (!Number.isInteger(interval) || interval < 1) return 'invalid'
  if (isDefaultPeriod(period)) return null
  if (period.unit === 'year') {
    return interval <= BILL_CYCLE_INTERVAL_MAX.annually ? { unit: 'annually', interval } : 'invalid'
  }
  if (interval <= BILL_CYCLE_INTERVAL_MAX.monthly) return { unit: 'monthly', interval }
  // CPQ allows up to 120 months; billing caps monthly at 24. A whole number of
  // years is the same period on billing's annual grid.
  if (interval % 12 === 0 && interval / 12 <= BILL_CYCLE_INTERVAL_MAX.annually) {
    return { unit: 'annually', interval: interval / 12 }
  }
  return 'invalid'
}

export function buildSourceRef(
  subscriptionId: string,
  subscriptionItemId: string,
  chargeType: CpqChargeType,
  billingPeriod?: CpqChargeBillingPeriod,
): string {
  const base = `cpq-${subscriptionId}-${subscriptionItemId}-${chargeType}`
  if (chargeType !== 'recurring') return base
  const suffix = billingPeriodSuffix(billingPeriod)
  return suffix ? `${base}-${suffix}` : base
}

/** Billing phases of a charge, or the reason they cannot be sent. */
export function mapPhases(
  phases: CpqChargePhase[] | undefined,
): { ok: true; phases: BillingItemPhasePayload[] } | { ok: false; reason: 'invalid_phase' | 'too_many_phases'; detail: string } {
  if (phases === undefined || phases === null) return { ok: true, phases: [] }
  if (!Array.isArray(phases)) return { ok: false, reason: 'invalid_phase', detail: 'phases is not an array' }
  if (phases.length > MAX_PHASES_PER_ITEM) {
    return {
      ok: false,
      reason: 'too_many_phases',
      detail: `${phases.length} phases; billing takes at most ${MAX_PHASES_PER_ITEM} per item`,
    }
  }
  const out: BillingItemPhasePayload[] = []
  for (const [index, phase] of phases.entries()) {
    const months = phase?.months
    const value = phase?.value
    if (!Number.isInteger(months) || months < 1) {
      return { ok: false, reason: 'invalid_phase', detail: `phase ${index + 1}: months must be a whole number ≥ 1` }
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return { ok: false, reason: 'invalid_phase', detail: `phase ${index + 1}: value must be a number ≥ 0` }
    }
    const name = typeof phase.name === 'string' && phase.name.trim() ? phase.name.trim().slice(0, MAX_PHASE_NAME) : null
    out.push({ name, durationUnit: 'month', durationCount: months, priceType: 'fixed', value })
  }
  return { ok: true, phases: out }
}

/**
 * Map a single CPQ charge to a billing.items.create payload, or a rejection
 * when billing could not take it (see the module comment).
 */
export function mapCharge(params: {
  subscriptionId: string
  subscriptionItem: CpqSubscriptionItem
  charge: CpqCharge
  /** YYYY-MM-DD; typically the subscription activation date. */
  billStartDate: string
}): ChargeMapResult {
  const { subscriptionId, subscriptionItem, charge, billStartDate } = params
  const itemId = subscriptionItem.subscriptionItemId
  const reject = (reason: ChargeRejectionReason, detail: string, sourceRef: string): ChargeMapResult => ({
    ok: false,
    rejection: { subscriptionId, subscriptionItemId: itemId, chargeType: charge.type, sourceRef, reason, detail },
  })
  const description = `${subscriptionItem.productName} — ${charge.description}`

  if (charge.type === 'one_time') {
    const sourceRef = buildSourceRef(subscriptionId, itemId, 'one_time')
    if (typeof charge.amount !== 'number') return reject('missing_amount', 'one-time charge without amount', sourceRef)
    return {
      ok: true,
      payload: {
        type: 'one_time',
        description,
        rateJson: { amount: charge.amount },
        subscriptionId,
        subscriptionItemId: itemId,
        sourceRef,
        billStartDate,
      },
    }
  }

  // recurring
  const period = mapBillingPeriod(charge.billingPeriod)
  if (period === 'invalid') {
    return reject(
      'invalid_billing_period',
      `billing period ${JSON.stringify(charge.billingPeriod)} is not supported by billing`,
      buildSourceRef(subscriptionId, itemId, 'recurring'),
    )
  }
  const sourceRef = buildSourceRef(subscriptionId, itemId, 'recurring', charge.billingPeriod)
  if (typeof charge.unitPrice !== 'number') return reject('missing_unit_price', 'recurring charge without unitPrice', sourceRef)
  const phases = mapPhases(charge.phases)
  if (!phases.ok) return reject(phases.reason, phases.detail, sourceRef)

  return {
    ok: true,
    payload: {
      type: 'recurring',
      description,
      rateJson: { unit_price: charge.unitPrice },
      subscriptionId,
      subscriptionItemId: itemId,
      sourceRef,
      billStartDate,
      ...(period ? { billingPeriodUnit: period.unit, billingPeriodInterval: period.interval } : {}),
      ...(phases.phases.length > 0 ? { phasesEnabled: true as const, phases: phases.phases } : {}),
    },
  }
}

/**
 * Map a single CPQ charge to a billing.items.create payload.
 * Returns `null` if the charge is refused (see `mapCharge` for the reason).
 */
export function mapChargeToBillingItem(params: {
  subscriptionId: string
  subscriptionItem: CpqSubscriptionItem
  charge: CpqCharge
  billStartDate: string
}): BillingItemPayload | null {
  const result = mapCharge(params)
  return result.ok ? result.payload : null
}

/**
 * Map every charge on every subscription item in a CPQ payload to billing
 * item payloads. Refused charges are returned in `rejected`; the item's other
 * charges are still mapped, so one bad charge does not fail the whole event.
 */
export function mapSubscriptionItemsWithRejections(params: {
  subscriptionId: string
  items: CpqSubscriptionItem[]
  billStartDate: string
  /** Per-item bill start (every charge of the item); falls back to `billStartDate`. */
  billStartDateFor?: (item: CpqSubscriptionItem) => string
}): { payloads: BillingItemPayload[]; rejected: RejectedCharge[] } {
  const payloads: BillingItemPayload[] = []
  const rejected: RejectedCharge[] = []
  for (const item of params.items) {
    const billStartDate = params.billStartDateFor?.(item) ?? params.billStartDate
    for (const charge of item.charges ?? []) {
      const mapped = mapCharge({ subscriptionId: params.subscriptionId, subscriptionItem: item, charge, billStartDate })
      if (mapped.ok) payloads.push(mapped.payload)
      else rejected.push(mapped.rejection)
    }
  }
  return { payloads, rejected }
}

/**
 * The connector's failure path for a charge billing cannot take: one
 * `console.error` per refused charge, with the event and the ref, so the
 * operator finds it in the worker log. The event itself succeeds (the queue
 * would otherwise retry a payload that can never pass).
 */
export function reportRejectedCharges(event: string, rejected: RejectedCharge[]): void {
  for (const rejection of rejected) {
    console.error('[cpq-billing-connector] charge refused, no billing item created', { event, ...rejection })
  }
}

/**
 * Same as `mapSubscriptionItemsWithRejections`, returning the payloads only;
 * refused charges are reported through `reportRejectedCharges` under `event`.
 */
export function mapSubscriptionItemsToBillingItems(params: {
  subscriptionId: string
  items: CpqSubscriptionItem[]
  billStartDate: string
  billStartDateFor?: (item: CpqSubscriptionItem) => string
  /** Event name used in the failure log. */
  event?: string
}): BillingItemPayload[] {
  const { payloads, rejected } = mapSubscriptionItemsWithRejections(params)
  reportRejectedCharges(params.event ?? 'cpq.subscription', rejected)
  return payloads
}

/** The billing create fields of a mapped payload (period and phases only when set). */
export function billingItemCreateFields(item: BillingItemPayload) {
  return {
    type: item.type,
    billStartDate: item.billStartDate,
    description: item.description,
    rateJson: item.rateJson,
    subscriptionId: item.subscriptionId,
    subscriptionItemId: item.subscriptionItemId,
    sourceRef: item.sourceRef,
    ...(item.billingPeriodUnit ? { billingPeriodUnit: item.billingPeriodUnit, billingPeriodInterval: item.billingPeriodInterval } : {}),
    ...(item.phases ? { phasesEnabled: item.phasesEnabled, phases: item.phases } : {}),
  }
}
