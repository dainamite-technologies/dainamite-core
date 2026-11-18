/**
 * Where a billing account stands against today (accounts list + workspace
 * header pill). Pure — computed from the account row and the viewer's day.
 * The account-level counterpart of `itemBillingState`.
 *
 *   inactive    the account is switched off (Bill Runs skip it)
 *   due         `next_bill_date` is today or earlier — a Bill Run (or prepaid
 *               period close) has not processed it yet
 *   not_billed  never billed, next bill is still ahead
 *   current     billed through `last_bill_date`, next bill is still ahead
 *
 * `due` is checked before `not_billed`, so a fresh account whose first run
 * was missed still shows as due.
 */

export type AccountBillingStatus = 'inactive' | 'due' | 'not_billed' | 'current'

export type AccountBillingInput = {
  is_active: boolean
  next_bill_date: string | null
  last_bill_date: string | null
}

export type AccountBillingState = {
  status: AccountBillingStatus
  /** The day shown in the label (YYYY-MM-DD): due-since or billed-through. */
  date: string | null
}

export type AccountBillingTone = 'success' | 'warning' | 'neutral'

function day(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null
}

/** `today` is a YYYY-MM-DD string (the viewer's calendar day). */
export function accountBillingState(account: AccountBillingInput, today: string): AccountBillingState {
  if (!account.is_active) return { status: 'inactive', date: null }
  const next = day(account.next_bill_date)
  if (next && next <= today) return { status: 'due', date: next }
  const last = day(account.last_bill_date)
  if (!last) return { status: 'not_billed', date: null }
  return { status: 'current', date: last }
}

export function accountBillingTone(state: AccountBillingState): AccountBillingTone {
  switch (state.status) {
    case 'current':
      return 'success'
    case 'due':
      return 'warning'
    default:
      return 'neutral'
  }
}
