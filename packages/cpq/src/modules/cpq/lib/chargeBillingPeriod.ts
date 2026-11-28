/**
 * Billing period of a recurring (MRC) charge — spec
 * `.ai/specs/2026-11-26-billing-line-period-and-status.md` (D5).
 *
 * A charge's fixed or table price is the price per `interval × unit`
 * (e.g. 480,000 every 1 year). Every 1 month is the default and today's
 * behaviour. MRC totals and deal value use the **monthly equivalent**
 * (480,000 / year → 40,000), so lines with different periods stay comparable;
 * the activation / ARC payloads carry the price per period.
 *
 * Pure helpers (no ORM, no DI): shared by services, routes and client pages.
 * A resolved charge carries `billingPeriod` only when it is not every 1 month,
 * so snapshots and payloads saved before this change read as monthly.
 */

import { mergeRecurringPhases, type PayloadPhase } from './payloadPhases'

export const CHARGE_BILLING_PERIOD_UNITS = ['month', 'year'] as const
export type ChargeBillingPeriodUnit = (typeof CHARGE_BILLING_PERIOD_UNITS)[number]

/** Upper bound for `billingPeriodInterval` (10 years of months). */
export const CHARGE_BILLING_PERIOD_MAX_INTERVAL = 120

export interface ChargeBillingPeriod {
  unit: ChargeBillingPeriodUnit
  interval: number
}

export const DEFAULT_CHARGE_BILLING_PERIOD: ChargeBillingPeriod = Object.freeze({ unit: 'month', interval: 1 }) as ChargeBillingPeriod

function isUnit(value: unknown): value is ChargeBillingPeriodUnit {
  return value === 'month' || value === 'year'
}

/**
 * Normalizes a stored period: a `{ unit, interval }` object (charge JSON) or
 * the entity columns. Anything unknown or invalid reads as every 1 month.
 */
export function normalizeBillingPeriod(value: unknown): ChargeBillingPeriod {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CHARGE_BILLING_PERIOD }
  const record = value as Record<string, unknown>
  const unit = record.unit ?? record.billingPeriodUnit
  const intervalRaw = Number(record.interval ?? record.billingPeriodInterval ?? 1)
  const interval = Number.isInteger(intervalRaw) && intervalRaw >= 1 ? intervalRaw : 1
  return { unit: isUnit(unit) ? unit : 'month', interval }
}

/** The period of a stored charge (`charge.billingPeriod`, absent = monthly). */
export function chargeBillingPeriod(charge: { billingPeriod?: unknown } | Record<string, unknown>): ChargeBillingPeriod {
  return normalizeBillingPeriod((charge as Record<string, unknown>).billingPeriod)
}

export function isDefaultBillingPeriod(period: ChargeBillingPeriod): boolean {
  return period.unit === 'month' && period.interval === 1
}

/** Length of the period in months (every 1 year = 12). */
export function billingPeriodMonths(period: ChargeBillingPeriod): number {
  return period.unit === 'year' ? period.interval * 12 : period.interval
}

/** Stable key for grouping: `1m`, `3m`, `1y`. Matches the connector's sourceRef suffix (contract C3). */
export function billingPeriodKey(period: ChargeBillingPeriod): string {
  return `${period.interval}${period.unit === 'year' ? 'y' : 'm'}`
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/** Price per period → monthly equivalent (480,000 per 1 year → 40,000). */
export function toMonthlyEquivalent(amountPerPeriod: number, period: ChargeBillingPeriod): number {
  const months = billingPeriodMonths(period)
  return months === 1 ? amountPerPeriod : round4(amountPerPeriod / months)
}

/**
 * The value a charge contributes to MRC totals: its total converted to the
 * monthly equivalent. Only meaningful for `mrc` charges; others are returned
 * unchanged (an NRC has no period).
 */
export function chargeMonthlyTotal(charge: { chargeType?: unknown; totalPrice?: unknown; billingPeriod?: unknown }, amount?: number | null): number {
  const value = amount !== undefined ? Number(amount ?? 0) : Number(charge.totalPrice ?? 0)
  if (!Number.isFinite(value)) return 0
  if (charge.chargeType !== 'mrc') return value
  return toMonthlyEquivalent(value, chargeBillingPeriod(charge))
}

/** Sum of the monthly equivalents of a line's MRC charges (one instance). */
export function sumMonthlyRecurring(charges: ReadonlyArray<{ chargeType?: unknown; totalPrice?: unknown; billingPeriod?: unknown }>): number {
  let total = 0
  for (const charge of charges) {
    if (charge.chargeType !== 'mrc' || charge.totalPrice == null) continue
    total += chargeMonthlyTotal(charge)
  }
  return round4(total)
}

/** Builds the `billingPeriod` field to store on a resolved charge (omitted for every 1 month). */
export function billingPeriodField(period: ChargeBillingPeriod): { billingPeriod?: ChargeBillingPeriod } {
  return isDefaultBillingPeriod(period) ? {} : { billingPeriod: { unit: period.unit, interval: period.interval } }
}

export interface RecurringChargeByPeriod {
  billingPeriod: ChargeBillingPeriod
  /** Price per that period for the whole line (quantity applied). */
  unitPrice: number
}

/**
 * Splits a line's recurring amount into one entry per distinct billing period
 * (contract C2: one recurring charge per period per item).
 *
 * `monthlyTotal` is the line's MRC total (monthly equivalent, quantity
 * applied) as stored on the line / subscription item. When every MRC charge is
 * monthly the result is exactly `[{ every 1 month, monthlyTotal }]`, i.e.
 * today's payload. Otherwise every period's amount is built directly from
 * its own charges — Σ price per period × quantity, summed unrounded and
 * rounded once — so the monthly entry never absorbs the (quantity-multiplied)
 * rounding of a non-monthly charge's monthly equivalent (review F1) and
 * matches its own phases (`lib/payloadPhases.ts`). Entries with no positive
 * amount are dropped. Order: monthly first, then by period length.
 */
export function recurringChargesByPeriod(
  charges: ReadonlyArray<Record<string, unknown>> | null | undefined,
  quantity: number,
  monthlyTotal: number,
): RecurringChargeByPeriod[] {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
  const groups = new Map<string, RecurringChargeByPeriod>()
  let monthlyCharges = 0
  for (const charge of charges ?? []) {
    if (charge.chargeType !== 'mrc' || charge.totalPrice == null) continue
    const period = chargeBillingPeriod(charge)
    const perPeriod = Number(charge.totalPrice)
    if (!Number.isFinite(perPeriod)) continue
    if (isDefaultBillingPeriod(period)) { monthlyCharges += perPeriod; continue }
    const key = billingPeriodKey(period)
    const group = groups.get(key) ?? { billingPeriod: period, unitPrice: 0 }
    group.unitPrice += perPeriod
    groups.set(key, group)
  }
  // Monthly only: the stored line MRC, exactly today's payload.
  if (groups.size === 0) {
    const monthly = round4(Number(monthlyTotal) || 0)
    return monthly > 0 ? [{ billingPeriod: { ...DEFAULT_CHARGE_BILLING_PERIOD }, unitPrice: monthly }] : []
  }
  const out: RecurringChargeByPeriod[] = []
  const monthly = round4(monthlyCharges * qty)
  if (monthly > 0) out.push({ billingPeriod: { ...DEFAULT_CHARGE_BILLING_PERIOD }, unitPrice: monthly })
  const others = [...groups.values()]
    .map((group) => ({ ...group, unitPrice: round4(group.unitPrice * qty) }))
    .filter((group) => group.unitPrice > 0)
    .sort((a, b) => billingPeriodMonths(a.billingPeriod) - billingPeriodMonths(b.billingPeriod))
  return out.concat(others)
}

/**
 * The C2 recurring charges of a line: `billingPeriod` is omitted for every 1
 * month (absent = monthly), so today's payload is unchanged. A period whose
 * charges have price phases also carries the merged `phases`
 * (`lib/payloadPhases.ts`); `unitPrice` stays the regular price.
 */
export function buildRecurringPayloadCharges(
  charges: ReadonlyArray<Record<string, unknown>> | null | undefined,
  quantity: number,
  monthlyTotal: number,
): Array<{ type: 'recurring'; unitPrice: number; description: string; billingPeriod?: ChargeBillingPeriod; phases?: PayloadPhase[] }> {
  return recurringChargesByPeriod(charges, quantity, monthlyTotal).map((entry) => {
    const key = billingPeriodKey(entry.billingPeriod)
    const ofPeriod = (charges ?? []).filter((charge) => charge.chargeType === 'mrc' && billingPeriodKey(chargeBillingPeriod(charge)) === key)
    const phases = mergeRecurringPhases(ofPeriod, quantity)
    return {
      type: 'recurring' as const,
      unitPrice: entry.unitPrice,
      description: 'Recurring charge',
      ...billingPeriodField(entry.billingPeriod),
      ...(phases.length ? { phases } : {}),
    }
  })
}
