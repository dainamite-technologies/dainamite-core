import type { BalanceStatus } from '../data/validators'
import { compareMoney, toUnits } from './money'

/**
 * Prepaid funds status & threshold-crossing detection (SPEC-002).
 *
 * Usage is NEVER rejected — we only classify and report. Events fire ONLY on
 * a downward crossing (compare `balance_before` vs `balance_after`), so a
 * client sitting at `exhausted` and still pushing usage is not spammed.
 */

/**
 * Resolve the effective low-balance threshold:
 *   account row's own threshold → tenant config default → 0 (off).
 */
export function resolveLowBalanceThreshold(
  accountThreshold: string | null | undefined,
  configDefault: string | number | null | undefined,
): string {
  if (accountThreshold !== null && accountThreshold !== undefined) {
    return accountThreshold
  }
  if (configDefault !== null && configDefault !== undefined) {
    return String(configDefault)
  }
  return '0'
}

/**
 * | status     | condition                          |
 * |------------|------------------------------------|
 * | exhausted  | balance <= 0 (incl. negative)      |
 * | low        | 0 < balance <= threshold           |
 * | ok         | balance > threshold                |
 */
export function computeBalanceStatus(
  balance: string | number,
  threshold: string | number,
): BalanceStatus {
  if (compareMoney(balance, 0) <= 0) return 'exhausted'
  if (compareMoney(balance, threshold) <= 0) return 'low'
  return 'ok'
}

export type BalanceCrossing = {
  /** Crossed downward from > threshold into the (0, threshold] low band. */
  lowCrossedDown: boolean
  /** Crossed downward from > 0 to <= 0. */
  exhaustedCrossedDown: boolean
}

/**
 * Detect downward threshold crossings between two balances.
 *
 * A single large debit that jumps straight past the low band into exhausted
 * fires ONLY `exhausted` (the customer is already negative — "you're low" is
 * moot). `low` fires only when the balance lands in the (0, threshold] band.
 * When `threshold <= 0` the low band is empty, so `low` never fires (the
 * config default 0 = "off"); `exhausted` still works.
 */
export function detectBalanceCrossing(
  balanceBefore: string | number,
  balanceAfter: string | number,
  threshold: string | number,
): BalanceCrossing {
  const beforeUnits = toUnits(balanceBefore)
  const afterUnits = toUnits(balanceAfter)
  const thresholdUnits = toUnits(threshold)

  const exhaustedCrossedDown = beforeUnits > 0 && afterUnits <= 0
  const lowCrossedDown =
    thresholdUnits > 0 &&
    beforeUnits > thresholdUnits &&
    afterUnits <= thresholdUnits &&
    afterUnits > 0

  return { lowCrossedDown, exhaustedCrossedDown }
}
