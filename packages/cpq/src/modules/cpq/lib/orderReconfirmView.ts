/**
 * Pure view helpers for the order line cost Re-confirm dialog (ARC costs spec §UI/UX, `PATCH /api/cpq/orders/{orderId}/costs/{orderLineCostId}`).
 * Client-safe. The API stays the authority (it enforces the status, the evidence and the exchange rate); this only decides what to
 * offer and mirrors the evidence rules so most mistakes are caught before the call.
 */
import type { FullCostRow } from './orderInventoryCostView'
import { parseAmount } from './quoteCostView'

/** Order statuses in which a line cost may still be re-confirmed (before activation). */
export const RECONFIRM_ORDER_STATUSES = ['draft', 'pending_activation'] as const

/** Re-confirm: a full cost row (values visible), on a draft / pending order, for a holder of `cpq.costs.manage` + `cpq.orders.manage`. */
export function canReconfirm(orderStatus: string, granted: readonly string[]): boolean {
  return (RECONFIRM_ORDER_STATUSES as readonly string[]).includes(orderStatus)
    && granted.includes('cpq.costs.manage') && granted.includes('cpq.orders.manage') && granted.includes('cpq.costs.view')
}

export type ReconfirmForm = {
  unitAmount: string
  currencyCode: string
  supplierName: string
  supplierQuoteRef: string
  validUntil: string
  supplierTermEnd: string
  supplierMinTermMonths: string
  note: string
}

export type ReconfirmIssue = 'AMOUNT_INVALID' | 'CURRENCY_INVALID' | 'DATE_INVALID' | 'TERM_INVALID' | 'NO_CHANGE' | 'NOTE_REQUIRED' | 'VALIDITY_EVIDENCE_REQUIRED'

type ReconfirmSource = Pick<FullCostRow, 'unitAmount' | 'currencyCode' | 'supplierName' | 'supplierQuoteRef' | 'validUntil' | 'supplierTermEnd' | 'supplierMinTermMonths'>

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const text = (value: string): string | null => (value.trim() === '' ? null : value.trim())

/** Starts from the stored cost; the note starts empty (only a note typed now counts as the reason). */
export const reconfirmFormFromCost = (cost: ReconfirmSource, orderCurrency: string): ReconfirmForm => ({
  unitAmount: cost.unitAmount ?? '',
  currencyCode: cost.currencyCode ?? orderCurrency,
  supplierName: cost.supplierName ?? '',
  supplierQuoteRef: cost.supplierQuoteRef ?? '',
  validUntil: cost.validUntil ?? '',
  supplierTermEnd: cost.supplierTermEnd ?? '',
  supplierMinTermMonths: cost.supplierMinTermMonths === null || cost.supplierMinTermMonths === undefined ? '' : String(cost.supplierMinTermMonths),
  note: '',
})

const sameAmount = (before: string | null, after: number | null) => (before === null ? null : Number(before)) === after

/** True when the value (amount or currency) differs from the stored cost. */
function valueChanged(form: ReconfirmForm, cost: ReconfirmSource): boolean {
  const amount = parseAmount(form.unitAmount)
  const next = amount === null || Number.isNaN(amount) ? null : amount
  return !sameAmount(cost.unitAmount, next) || (cost.currencyCode !== null && text(form.currencyCode) !== null && text(form.currencyCode) !== cost.currencyCode)
}

/** Validation the dialog can do before calling the API, mirroring the server's evidence rules (R11). */
export function reconfirmIssues(form: ReconfirmForm, cost: ReconfirmSource): ReconfirmIssue[] {
  const issues: ReconfirmIssue[] = []
  const amount = parseAmount(form.unitAmount)
  if (Number.isNaN(amount)) issues.push('AMOUNT_INVALID')
  if (form.currencyCode.trim() && !/^[A-Z]{3}$/.test(form.currencyCode.trim())) issues.push('CURRENCY_INVALID')
  if ((form.validUntil && !ISO_DATE.test(form.validUntil)) || (form.supplierTermEnd && !ISO_DATE.test(form.supplierTermEnd))) issues.push('DATE_INVALID')
  if (form.supplierMinTermMonths.trim() && !/^\d+$/.test(form.supplierMinTermMonths.trim())) issues.push('TERM_INVALID')
  if (issues.length > 0) return issues
  if (Object.keys(buildReconfirmPatch(form, cost)).length === 0) return ['NO_CHANGE']
  const note = text(form.note)
  const newRef = text(form.supplierQuoteRef)
  const evidence = Boolean(note) || Boolean(newRef && newRef !== (cost.supplierQuoteRef ?? ''))
  if (valueChanged(form, cost) && !evidence) issues.push('NOTE_REQUIRED')
  const extended = (form.validUntil && (!cost.validUntil || form.validUntil > cost.validUntil))
    || (form.supplierTermEnd && (!cost.supplierTermEnd || form.supplierTermEnd > cost.supplierTermEnd))
  if (extended && !evidence) issues.push('VALIDITY_EVIDENCE_REQUIRED')
  return issues
}

/** `PATCH` body: only what changed (an untouched value is never written back), plus the note when typed. Empty when nothing changed. */
export function buildReconfirmPatch(form: ReconfirmForm, cost: ReconfirmSource): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const amount = parseAmount(form.unitAmount)
  const next = amount === null || Number.isNaN(amount) ? null : amount
  if (next !== null && !sameAmount(cost.unitAmount, next)) patch.unitAmount = next
  const currency = text(form.currencyCode)
  if (currency && cost.currencyCode !== null && currency !== cost.currencyCode) patch.currencyCode = currency
  if (text(form.supplierName) !== cost.supplierName) patch.supplierName = text(form.supplierName)
  if (text(form.supplierQuoteRef) !== cost.supplierQuoteRef) patch.supplierQuoteRef = text(form.supplierQuoteRef)
  if (text(form.validUntil) !== cost.validUntil) patch.validUntil = text(form.validUntil)
  if (text(form.supplierTermEnd) !== cost.supplierTermEnd) patch.supplierTermEnd = text(form.supplierTermEnd)
  const months = text(form.supplierMinTermMonths) === null ? null : Number(form.supplierMinTermMonths)
  if (months !== (cost.supplierMinTermMonths ?? null)) patch.supplierMinTermMonths = months
  if (Object.keys(patch).length > 0 && text(form.note)) patch.note = text(form.note)
  return patch
}

export const RECONFIRM_ISSUE_FALLBACKS: Record<ReconfirmIssue, string> = {
  AMOUNT_INVALID: 'Enter an amount of zero or more with at most 4 decimals',
  CURRENCY_INVALID: 'Use a three-letter currency code, for example EUR',
  DATE_INVALID: 'Use the date format YYYY-MM-DD',
  TERM_INVALID: 'Enter the minimum term as a whole number of months',
  NO_CHANGE: 'Change at least one value to re-confirm',
  NOTE_REQUIRED: 'A changed value needs a new supplier quote reference or a note',
  VALIDITY_EVIDENCE_REQUIRED: 'Extending the validity needs a new supplier quote reference or a note',
}

/** Server error codes of the re-confirm write (`409 ORDER_ACTIVATED` / `ORDER_CANCELLED`, `422 …`). */
export const RECONFIRM_ERROR_FALLBACKS: Record<string, string> = {
  ORDER_ACTIVATED: 'The order was activated — its costs can no longer be re-confirmed',
  ORDER_CANCELLED: 'The order was cancelled',
  CURRENCY_NO_RATE: 'No exchange rate is available for this currency',
  NOTE_REQUIRED: RECONFIRM_ISSUE_FALLBACKS.NOTE_REQUIRED,
  VALIDITY_EVIDENCE_REQUIRED: RECONFIRM_ISSUE_FALLBACKS.VALIDITY_EVIDENCE_REQUIRED,
  LINE_NOT_ELIGIBLE: 'This cost cannot be re-confirmed',
  FORBIDDEN: 'You do not have permission to re-confirm costs',
  VALIDATION: 'Check the highlighted values',
  UNKNOWN: 'The change could not be saved',
}

export const reconfirmErrorFallback = (code: string): string => RECONFIRM_ERROR_FALLBACKS[code] ?? code

/** Error code of a failed re-confirm: a SCREAMING_CASE `error`, else by HTTP status. */
export function reconfirmErrorCode(status: number, body: unknown): string {
  const record = (body ?? {}) as { error?: unknown }
  if (typeof record.error === 'string' && /^[A-Z][A-Z_]+$/.test(record.error)) return record.error
  if (status === 403) return 'FORBIDDEN'
  if (status === 409) return 'ORDER_ACTIVATED'
  if (status === 400) return 'VALIDATION'
  return 'UNKNOWN'
}
