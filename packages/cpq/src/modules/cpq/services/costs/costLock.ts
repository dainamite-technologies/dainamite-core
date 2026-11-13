import type { CpqStatus } from '../types'

/**
 * Cost lock matrix (App Spec R11). Pure: which quote-cost writes a locked quote
 * still accepts. A quote is locked when its status is outside `new | incomplete |
 * ready` or an order exists (`isQuoteCostLocked`).
 *
 * Always allowed while locked (non-terminal statuses): margin-only cost changes,
 * confirming an unchanged value (`estimated` -> `confirmed`), and supplier
 * validity / term extensions (which need evidence, see `extendsValidity`).
 * Everything that can move the price (create / change / delete of a price-basis
 * cost, any markup override) answers `409 COST_LOCKED`.
 */

/** The fields of a cost line the lock decision looks at. */
export type CostLockState = {
  role: string
  chargeCode: string | null
  costType: string
  costModel: string
  source: string
  unitAmount: string | number | null
  currencyCode: string | null
  valueStatus: string
  validUntil?: string | null
  supplierTermEnd?: string | null
  supplierMinTermMonths?: number | null
}

const sameAmount = (a: string | number | null, b: string | number | null) => (a === null || b === null ? a === b : Number(a) === Number(b))

/**
 * Statuses that close a quote's costs: no cost write at all. This is the App Spec's
 * terminal set (rejected, cancelled, expired — CPQ has no `expired`), NOT the quote
 * state machine's `TERMINAL_STATUSES`: an `accepted` quote is the normal source of
 * conversion, and conversion needs its price-basis costs confirmed (R7), so the R11
 * exemptions (confirming an unchanged value, margin-only, validity extensions) must
 * stay open there. Price-affecting writes on `accepted` are still refused by the lock.
 */
export const COST_CLOSED_STATUSES: readonly CpqStatus[] = ['rejected', 'cancelled']

/** True when the quote's costs are closed: no cost write at all. */
export const isTerminalQuoteStatus = (status: string): boolean => (COST_CLOSED_STATUSES as readonly string[]).includes(status)

/**
 * Whether a write changes what a price-basis cost contributes to the price.
 * `before` null = create, `after` null = delete.
 */
export function affectsPrice(before: CostLockState | null, after: CostLockState | null): boolean {
  const basis = (state: CostLockState | null) => state !== null && state.role === 'price_basis'
  if (!basis(before) && !basis(after)) return false
  if (before === null || after === null) return true
  if (before.role !== after.role || before.chargeCode !== after.chargeCode || before.costType !== after.costType
    || before.costModel !== after.costModel || before.source !== after.source) return true
  if (!sameAmount(before.unitAmount, after.unitAmount) || before.currencyCode !== after.currencyCode) return true
  if (before.valueStatus === after.valueStatus) return false
  // Confirming an unchanged value is the only status change that never moves a price.
  return !(before.valueStatus === 'estimated' && after.valueStatus === 'confirmed')
}

/** Whether `after` extends the supplier validity or term of `before` (later date, longer minimum term). */
export function extendsValidity(before: CostLockState, after: CostLockState): boolean {
  const later = (previous: string | null | undefined, next: string | null | undefined) => Boolean(next) && (!previous || (next as string) > previous)
  return later(before.validUntil, after.validUntil)
    || later(before.supplierTermEnd, after.supplierTermEnd)
    || (after.supplierMinTermMonths != null && (before.supplierMinTermMonths == null || after.supplierMinTermMonths > before.supplierMinTermMonths))
}

/**
 * `409 COST_LOCKED` decision. Terminal quotes accept no cost write; locked
 * quotes accept everything that does not affect the price.
 */
export function isWriteRefused(args: { locked: boolean; status: string; priceAffecting: boolean }): boolean {
  if (isTerminalQuoteStatus(args.status)) return true
  return args.locked && args.priceAffecting
}
