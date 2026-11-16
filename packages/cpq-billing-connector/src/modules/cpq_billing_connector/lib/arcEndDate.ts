import type { CreditReasonCode, CreditReasonParams, ItemUpdatePayload } from './billingApiClient'
import { toIsoDate } from './orderSetupResolution'

/**
 * End dates the ARC subscribers (`amended`, `cancelled`, `superseded`) write
 * to billing items — spec `2026-11-16-billing-operator-polish-and-bill-cycle-day`
 * Part 2, 6b. Pure.
 *
 * An item ends the day before the change takes effect, but never more than
 * one day before its own bill start: an item that has not started yet ends at
 * `billStartDate − 1` ("cancelled before start"), so it never bills and
 * billing's `end_before_start` check (end < start − 1) never fires.
 */

function minusOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** `max(effectiveDate − 1, billStartDate − 1)` as `YYYY-MM-DD`. */
export function arcItemEndDate(effectiveDate: string, billStartDate: Date | string | null | undefined): string {
  const byEffective = minusOneDay(effectiveDate.slice(0, 10))
  const start = toIsoDate(billStartDate)
  if (!start) return byEffective
  const byStart = minusOneDay(start)
  // ISO dates compare correctly as strings.
  return byStart > byEffective ? byStart : byEffective
}

export type ArcEndDateItem = {
  id: string
  billStartDate: Date | string
  billEndDate?: Date | string | null
}

export type ArcEndDateChange = {
  /** YYYY-MM-DD the change takes effect (the CPQ event's effective date). */
  effectiveDate: string
  code: CreditReasonCode
  /** Order number, when known. */
  reference?: string | null
}

/**
 * The billing-item update that ends `item` for an ARC change, or `null` when
 * there is nothing to write: the item already ends on or before that date
 * (a re-delivered event, or an earlier end set by an operator — the
 * connector never pushes an end date later).
 *
 * Every write carries the generated credit reason; billing stores it only
 * when the new end date actually credits already-billed days.
 */
export function buildArcEndDateUpdate(item: ArcEndDateItem, change: ArcEndDateChange): ItemUpdatePayload | null {
  const endDate = arcItemEndDate(change.effectiveDate, item.billStartDate)
  const currentEnd = toIsoDate(item.billEndDate)
  if (currentEnd && currentEnd <= endDate) return null
  const params: CreditReasonParams = { effectiveDate: change.effectiveDate.slice(0, 10) }
  if (change.reference) params.reference = change.reference
  return {
    id: item.id,
    billEndDate: endDate,
    creditReasonCode: change.code,
    creditReasonParams: params,
  }
}

/** Updates for many items; items with nothing to write are left out. */
export function buildArcEndDateUpdates(items: ArcEndDateItem[], change: ArcEndDateChange): ItemUpdatePayload[] {
  const out: ItemUpdatePayload[] = []
  for (const item of items) {
    const update = buildArcEndDateUpdate(item, change)
    if (update) out.push(update)
  }
  return out
}
