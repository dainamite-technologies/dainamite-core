import type { BillingMode, CreditStatus } from '../data/validators'
import { compareMoney, fromUnits, subMoney, toUnits } from './money'

/**
 * Credit-line status (both modes, SPEC-002). Billing **computes and reports**
 * where an account stands against its `credit_limit` — it NEVER blocks
 * (assumption #11). A consumer (CPQ order conversion, a dunning job, an
 * operator) decides what to do with an over-limit signal.
 *
 * `credit_used` per mode:
 *   - prepaid:  max(0, −balance) — the portion of the balance gone negative
 *     (drawing on the credit line).
 *   - postpaid: Σ outstanding (posted, not-yet-paid) invoice `outstanding`
 *     amounts from core/sales.
 *
 * `available_credit = credit_limit − credit_used` (unified across both modes;
 * for prepaid this equals `balance + credit_limit` when balance < 0, else
 * `credit_limit`).
 */

/** Prepaid credit drawn = max(0, −balance). */
export function prepaidCreditUsed(balance: string | number): string {
  if (compareMoney(balance, 0) >= 0) return '0.0000'
  return fromUnits(-toUnits(balance))
}

export function computeCreditUsed(
  mode: BillingMode,
  opts: { balance?: string | number | null; outstanding?: string | number | null },
): string {
  if (mode === 'prepaid') {
    return prepaidCreditUsed(opts.balance ?? '0')
  }
  // postpaid
  return fromUnits(toUnits(opts.outstanding ?? '0'))
}

export function computeAvailableCredit(
  creditLimit: string | number,
  creditUsed: string | number,
): string {
  return subMoney(creditLimit, creditUsed)
}

/**
 * | status        | condition                                  |
 * |---------------|--------------------------------------------|
 * | within_limit  | available_credit > near_limit_buffer       |
 * | near_limit    | 0 < available_credit <= near_limit_buffer  |
 * | over_limit    | available_credit <= 0 (and credit is drawn)|
 *
 * `creditUsed` disambiguates the default "no credit line" case: with
 * `credit_limit = 0` and nothing drawn (`credit_used = 0`) the available
 * credit is exactly 0 — that is NOT over-limit (the account simply has no
 * credit line), so it reports `within_limit`. Once any credit is actually
 * drawn (prepaid balance negative, or postpaid outstanding > 0) the formula
 * applies. When `creditUsed` is omitted, a draw is assumed (pure spec
 * formula) — callers that have the figure should pass it.
 */
export function computeCreditStatus(
  availableCredit: string | number,
  nearLimitBuffer: string | number,
  creditUsed?: string | number,
): CreditStatus {
  const hasDraw = creditUsed === undefined ? true : compareMoney(creditUsed, 0) > 0
  if (compareMoney(availableCredit, 0) <= 0) {
    return hasDraw ? 'over_limit' : 'within_limit'
  }
  if (compareMoney(availableCredit, nearLimitBuffer) <= 0) return 'near_limit'
  return 'within_limit'
}

export function resolveNearLimitBuffer(
  configDefault: string | number | null | undefined,
): string {
  if (configDefault !== null && configDefault !== undefined) return String(configDefault)
  return '0'
}

export type CreditSnapshot = {
  mode: BillingMode
  creditLimit: string
  creditUsed: string
  availableCredit: string
  creditStatus: CreditStatus
}

/** Assemble the full credit snapshot reported on consume responses + the API. */
export function computeCreditSnapshot(params: {
  mode: BillingMode
  creditLimit: string | number
  nearLimitBuffer: string | number
  balance?: string | number | null
  outstanding?: string | number | null
}): CreditSnapshot {
  const creditLimit = fromUnits(toUnits(params.creditLimit))
  const creditUsed = computeCreditUsed(params.mode, {
    balance: params.balance,
    outstanding: params.outstanding,
  })
  const availableCredit = computeAvailableCredit(creditLimit, creditUsed)
  return {
    mode: params.mode,
    creditLimit,
    creditUsed,
    availableCredit,
    creditStatus: computeCreditStatus(availableCredit, params.nearLimitBuffer, creditUsed),
  }
}

export type CreditCrossing = {
  /** credit_used crossed upward past credit_limit (available ≤ 0). */
  overLimitCrossedUp: boolean
  /** available_credit crossed downward into (0, buffer] (optional event). */
  nearLimitCrossedUp: boolean
}

/**
 * Detect upward crossings of `credit_used` (i.e. downward crossings of
 * `available_credit`) for the `billing.credit.over_limit` /
 * `billing.credit.near_limit` events. `over_limit` fires once when usage /
 * recurring pushes credit_used from below the limit to at/above it.
 *
 * `credit_limit == 0` (no credit) means available is never > 0 once any
 * credit is "used"; to avoid firing on every prepaid debit while at 0 balance
 * with no credit line, the crossing requires a real limit (> 0).
 */
export function detectCreditCrossing(params: {
  creditLimit: string | number
  nearLimitBuffer: string | number
  usedBefore: string | number
  usedAfter: string | number
}): CreditCrossing {
  const limitUnits = toUnits(params.creditLimit)
  if (limitUnits <= 0) {
    return { overLimitCrossedUp: false, nearLimitCrossedUp: false }
  }
  const usedBefore = toUnits(params.usedBefore)
  const usedAfter = toUnits(params.usedAfter)
  const bufferUnits = toUnits(params.nearLimitBuffer)

  const overLimitCrossedUp = usedBefore < limitUnits && usedAfter >= limitUnits

  const availBefore = limitUnits - usedBefore
  const availAfter = limitUnits - usedAfter
  const nearLimitCrossedUp =
    bufferUnits > 0 &&
    availBefore > bufferUnits &&
    availAfter <= bufferUnits &&
    availAfter > 0

  return { overLimitCrossedUp, nearLimitCrossedUp }
}
