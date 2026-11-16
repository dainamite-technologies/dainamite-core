/**
 * Where an item stands against today (account Items tab): has it been billed,
 * and through which date? Pure — computed from the item row and today's date.
 *
 *   inactive      the item is switched off
 *   cancelled     ends before it starts (end < start) — never bills
 *   metered       usage item (billed from usage records, no watermark)
 *   scheduled     starts after today, nothing billed yet
 *   awaiting_run  started, but no Bill Run has charged it yet
 *   billed        one-time item already charged
 *   current       recurring, charged through today or later (paid ahead)
 *   due           recurring, charged only through a past date — the next
 *                 Bill Run will charge the rest
 *   fully_billed  recurring with an end date, charged through that end
 */

export type ItemBillingStatus =
  | 'inactive'
  | 'cancelled'
  | 'metered'
  | 'scheduled'
  | 'awaiting_run'
  | 'billed'
  | 'current'
  | 'due'
  | 'fully_billed'

export type ItemBillingInput = {
  type: 'one_time' | 'recurring' | 'usage'
  is_active: boolean
  bill_start_date: string
  bill_end_date?: string | null
  billed_to_date?: string | null
}

export type ItemBillingState = {
  status: ItemBillingStatus
  /** The relevant date for the label: start, billed-through or due-since day (YYYY-MM-DD). */
  date: string | null
}

function day(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null
}

function nextDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/** `today` is a YYYY-MM-DD string (the viewer's calendar day). */
export function itemBillingState(item: ItemBillingInput, today: string): ItemBillingState {
  if (!item.is_active) return { status: 'inactive', date: null }
  const startDay = day(item.bill_start_date)
  const endDay = day(item.bill_end_date)
  if (startDay && endDay && endDay < startDay) return { status: 'cancelled', date: null }
  if (item.type === 'usage') return { status: 'metered', date: null }
  const start = day(item.bill_start_date) ?? today
  const billedTo = day(item.billed_to_date)
  const end = day(item.bill_end_date)

  if (item.type === 'one_time') {
    if (billedTo) return { status: 'billed', date: null }
    return start > today ? { status: 'scheduled', date: start } : { status: 'awaiting_run', date: null }
  }

  if (!billedTo) return start > today ? { status: 'scheduled', date: start } : { status: 'awaiting_run', date: null }
  if (end && billedTo >= end) return { status: 'fully_billed', date: billedTo }
  if (billedTo >= today) return { status: 'current', date: billedTo }
  return { status: 'due', date: nextDay(billedTo) }
}
