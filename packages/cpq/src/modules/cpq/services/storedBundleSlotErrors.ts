import type { CpqQuoteConfiguration } from '../data/entities'
import type { ValidationError } from './types'

/**
 * #124 — bundle slot errors (V-QBUN-*) recorded on the quote by its last
 * recalculation. Every quote write recalculates and persists
 * `validationResult`, so conversion reads the stored state instead of
 * re-pricing (the same approach as `storedAdjustmentFailure`).
 *
 * A quote last recalculated before slot validation existed has no such
 * errors stored, so it is not retro-blocked until its next write — the same
 * trade-off as the stored adjustment snapshot.
 *
 * Only bundle slot errors block conversion: an incomplete bundle would become
 * a subscription missing required components. Other invalid states convert as
 * they did before.
 */
export function storedBundleSlotErrors(quote: Pick<CpqQuoteConfiguration, 'validationResult'>): ValidationError[] {
  const errors = (quote.validationResult as { errors?: unknown } | null | undefined)?.errors
  if (!Array.isArray(errors)) return []
  return errors.filter((error): error is ValidationError =>
    !!error && typeof error === 'object' && (error as ValidationError).type === 'bundle_slot' &&
    typeof (error as ValidationError).message === 'string')
}
