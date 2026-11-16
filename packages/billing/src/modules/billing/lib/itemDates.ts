import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { toUtcMidnight } from './dateOnly'

/**
 * An item may not end before it starts (Part 2, 6a). `end = start − 1` stays
 * valid: it means "cancelled before it began" — the item never bills.
 */
export const ITEM_END_BEFORE_START = 'billing.item.end_before_start'

const DAY_MS = 86_400_000

export function endsBeforeStart(
  start: Date | string,
  end: Date | string | null | undefined,
): boolean {
  if (!end) return false
  return toUtcMidnight(end).getTime() < toUtcMidnight(start).getTime() - DAY_MS
}

export function assertItemDates(start: Date | string, end: Date | string | null | undefined): void {
  if (endsBeforeStart(start, end)) {
    throw new CrudHttpError(422, {
      error: 'The end date cannot be more than one day before the start date',
      code: ITEM_END_BEFORE_START,
    })
  }
}
