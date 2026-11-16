import { toUtcMidnight } from './dateOnly'

/**
 * Will ending an item on `newEndDate` credit already-billed days? Predicts
 * the Spec A credit path of `computeRecurringLines` (an ended recurring item
 * with `prorate` gets negative lines for `[end + 1, billed_to_date]`) — the
 * engine is unchanged; this only tells the operator / API in advance.
 */

export type CreditPreviewItem = {
  type: string
  prorate?: boolean | null
  billStartDate: Date | string
  billedToDate?: Date | string | null
}

export type CreditPreview =
  | { credited: false }
  | { credited: true; from: Date; to: Date; days: number }

const DAY_MS = 86_400_000

export function previewCredit(item: CreditPreviewItem, newEndDate: Date | string | null | undefined): CreditPreview {
  if (item.type !== 'recurring' || item.prorate === false) return { credited: false }
  if (!item.billedToDate || !newEndDate) return { credited: false }
  const end = toUtcMidnight(newEndDate)
  const billedTo = toUtcMidnight(item.billedToDate)
  if (end.getTime() >= billedTo.getTime()) return { credited: false }
  const start = toUtcMidnight(item.billStartDate)
  const dayAfterEnd = new Date(end.getTime() + DAY_MS)
  const from = dayAfterEnd.getTime() > start.getTime() ? dayAfterEnd : start
  const days = Math.round((billedTo.getTime() - from.getTime()) / DAY_MS) + 1
  return days > 0 ? { credited: true, from, to: billedTo, days } : { credited: false }
}

/** Would ending the item on `newEndDate` credit days at all (with prorate off: days stay billed). */
export function billedBeyond(item: CreditPreviewItem, newEndDate: Date | string | null | undefined): boolean {
  if (item.type !== 'recurring' || !item.billedToDate || !newEndDate) return false
  return toUtcMidnight(newEndDate).getTime() < toUtcMidnight(item.billedToDate).getTime()
}
