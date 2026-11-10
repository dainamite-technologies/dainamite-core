import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'

/** Feature required to write a quote's prices (recalculate, line edits). */
export const QUOTE_MANAGE_FEATURE = 'cpq.quotes.manage'

/**
 * Terminal quote statuses, mirrored from `TERMINAL_STATUSES` in
 * `services/types.ts` so client components can use this helper without
 * pulling the service layer into the browser bundle. A unit test keeps the
 * two lists identical.
 */
export const TERMINAL_QUOTE_STATUSES: readonly string[] = ['accepted', 'rejected', 'cancelled']

/**
 * Whether the quote page may offer "Recalculate": the user can manage quotes
 * (wildcard-aware) and the quote is not terminal — a saved recalculation on a
 * terminal quote is refused by the API (409).
 */
export function canRecalculateQuote(grantedFeatures: readonly string[], cpqStatus: string): boolean {
  if (TERMINAL_QUOTE_STATUSES.includes(cpqStatus)) return false
  return hasAllFeatures([QUOTE_MANAGE_FEATURE], [...grantedFeatures])
}
