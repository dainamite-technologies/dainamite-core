/**
 * Pure view helpers for supplier cost sourcing (feature spec `2026-11-12-cpq-cost-plus-supplier-sourcing`
 * §UI/UX): the Cost requests page, the Answer / Decline dialogs and the quote Costs panel additions.
 * Client-safe (no service imports). The API stays the authority; this only decides what to show.
 */
import { costErrorCode, parseAmount } from './quoteCostView'

export type SourcingStatus = 'not_requested' | 'requested' | 'answered' | 'declined' | 'cancelled'

export const SOURCING_STATUS_FALLBACKS: Record<string, string> = {
  not_requested: 'Not requested',
  requested: 'Requested',
  answered: 'Answered',
  declined: 'Declined',
  cancelled: 'Cancelled',
}
export const SOURCING_STATUS_VARIANTS: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'error'> = {
  not_requested: 'neutral', requested: 'info', answered: 'success', declined: 'error', cancelled: 'neutral',
}

export const CANCEL_REASON_FALLBACKS: Record<string, string> = {
  reconfigured: 'Line reconfigured',
  line_removed: 'Line removed',
  element_deactivated: 'Cost element deactivated',
  re_requested: 'Replaced by a new request',
  manual_value: 'Value entered manually',
  quote_closed: 'Quote closed',
  cancelled_by_user: 'Cancelled by a user',
}

// ─── API shapes (list / detail of GET /api/cpq/cost-requests) ───

export type CostRequestRow = {
  costId: string
  quoteId: string
  quoteConfigurationId: string
  quoteNumber: string | null
  customerName: string | null
  quoteLineId: string
  productName: string | null
  costKey: string
  costName: string
  chargeCode: string | null
  role: string
  origin: string
  keyAttributes: Record<string, unknown>
  sourcingStatus: string
  cancelReason: string | null
  costRequestId: string | null
  requestSeq: number | null
  requestedAt: string | null
  ageWorkingDays: number | null
  overdue: boolean
  requestSupplierId: string | null
  requestSupplierName: string | null
  valueStatus: string
  hasAnswerPending: boolean
  cpqStatus: string
  orderId: string | null
}

export type CostRequestDetail = CostRequestRow & {
  lineConfiguration: Record<string, unknown>
  note: string | null
  requestHistory: Array<Record<string, unknown>>
  current: {
    valueStatus: string; valueOrigin: string | null; unitAmount: string | null; currencyCode: string | null
    supplierId: string | null; supplierName: string | null; supplierQuoteRef: string | null; validUntil: string | null
  }
  proposedAnswer: Record<string, unknown> | null
}

// ─── Quote state ────────────────────────────────────────────────

/** Quote statuses (and conversion) that refuse every sourcing write (`409 QUOTE_CLOSED` / `QUOTE_CONVERTED`). */
export const isSourcingClosed = (cpqStatus: string, orderId?: string | null): boolean =>
  Boolean(orderId) || cpqStatus === 'rejected' || cpqStatus === 'cancelled'

// ─── List filters → query string ────────────────────────────────

/** Select options of the status filter; `closed_by_conversion` is the preset `cancelled` + `quote_closed`. */
export const COST_REQUEST_STATUS_OPTIONS = ['requested', 'answered', 'declined', 'cancelled', 'closed_by_conversion', 'all'] as const
export const COST_REQUEST_STATUS_OPTION_FALLBACKS: Record<string, string> = {
  requested: 'Open',
  answered: 'Answered',
  declined: 'Declined',
  cancelled: 'Cancelled',
  closed_by_conversion: 'Closed by conversion',
  all: 'All',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isOn = (value: unknown): boolean => value === true || value === 'true'
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Maps the FilterBar values to the list query. Status defaults to Open (`requested`). The Overdue toggle only
 * exists for open requests, so it pins the status to `requested`. The cancel reason applies to Cancelled only.
 * Ids that are not UUIDs are dropped (the API would answer 400).
 */
export function buildCostRequestParams(values: Record<string, unknown>, params: URLSearchParams): void {
  const overdue = isOn(values.overdue)
  const picked = str(values.status) || 'requested'
  if (overdue) {
    params.set('status', 'requested')
    params.set('overdue', 'true')
  } else if (picked === 'closed_by_conversion') {
    params.set('status', 'cancelled')
    params.set('cancelReason', 'quote_closed')
  } else {
    params.set('status', (COST_REQUEST_STATUS_OPTIONS as readonly string[]).includes(picked) ? picked : 'requested')
    if (picked === 'cancelled' && str(values.cancelReason)) params.set('cancelReason', str(values.cancelReason))
  }
  if (UUID.test(str(values.supplierId))) params.set('supplierId', str(values.supplierId))
  if (UUID.test(str(values.quoteId))) params.set('quoteId', str(values.quoteId))
}

/** Row actions of the queue: Answer / Decline on open requests of quotes that still accept them. */
export function queueRowActions(row: Pick<CostRequestRow, 'sourcingStatus' | 'cpqStatus' | 'orderId'>): Array<'answer' | 'decline'> {
  return row.sourcingStatus === 'requested' && !isSourcingClosed(row.cpqStatus, row.orderId) ? ['answer', 'decline'] : []
}

// ─── Badges (quote line, every user) ────────────────────────────

export type SourcingBadge = 'requested' | 'overdue' | 'declined' | 'answerPending'
export const SOURCING_BADGE_FALLBACKS: Record<SourcingBadge, string> = {
  requested: 'Cost requested',
  overdue: 'Overdue',
  declined: 'Declined — no supplier',
  answerPending: 'Supplier answered with a different cost',
}

export type SourcingFields = {
  sourcingStatus?: string | null
  hasAnswerPending?: boolean | null
  overdue?: boolean | null
}

/** Sourcing badges of one quote line, stable order, text labels (colour is never the only signal). */
export function sourcingBadges(costs: ReadonlyArray<SourcingFields>): SourcingBadge[] {
  const badges: SourcingBadge[] = []
  if (costs.some((cost) => cost.sourcingStatus === 'requested')) badges.push('requested')
  if (costs.some((cost) => cost.overdue && cost.sourcingStatus === 'requested')) badges.push('overdue')
  if (costs.some((cost) => cost.sourcingStatus === 'declined')) badges.push('declined')
  if (costs.some((cost) => cost.hasAnswerPending)) badges.push('answerPending')
  return badges
}

// ─── Actions on a quote cost row ────────────────────────────────

export type SourcingAction = 'request' | 'rerequest' | 'cancel' | 'answer' | 'decline' | 'apply'

export type SourcingPermissions = {
  /** `cpq.quotes.manage`: Request / Re-request / Cancel request. */
  request: boolean
  /** `cpq.costs.view` + `cpq.costs.manage`: Answer / Decline. */
  answer: boolean
  /** `cpq.quotes.manage` + `cpq.costs.manage` (and the view): Reopen and apply. */
  apply: boolean
}

/**
 * Which sourcing actions a cost row offers. Never on a closed quote; request / re-request / cancel never on a
 * line the server refuses with `LINE_NOT_ELIGIBLE` (`requestEligible === false`).
 */
export function sourcingActions(
  cost: SourcingFields & { requestEligible?: boolean | null },
  context: { closed: boolean; permissions: SourcingPermissions },
): SourcingAction[] {
  if (context.closed) return []
  const { permissions } = context
  const status = cost.sourcingStatus ?? 'not_requested'
  const eligible = cost.requestEligible !== false
  const actions: SourcingAction[] = []
  if (permissions.request && eligible) {
    if (status === 'not_requested') actions.push('request')
    else actions.push('rerequest')
    if (status === 'requested') actions.push('cancel')
  }
  if (permissions.answer && eligible && status === 'requested') actions.push('answer', 'decline')
  if (permissions.apply && cost.hasAnswerPending) actions.push('apply')
  return actions
}

/**
 * Sourcing permissions from the features the current user holds (feature-check result, never a raw role or
 * feature-array compare on the server's behalf: the API still enforces every route).
 */
export function sourcingPermissions(granted: readonly string[]): SourcingPermissions {
  const has = (feature: string) => granted.includes(feature)
  const view = has('cpq.costs.view')
  return {
    request: has('cpq.quotes.manage'),
    answer: view && has('cpq.costs.manage'),
    apply: view && has('cpq.quotes.manage') && has('cpq.costs.manage'),
  }
}

// ─── Reopen and apply confirmation ──────────────────────────────

const amountFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false })

/** "310.00 EUR"; "—" without an amount. */
export function formatCostAmount(amount: string | number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const value = Number(amount)
  if (!Number.isFinite(value)) return '—'
  return `${amountFormat.format(value)}${currency ? ` ${currency}` : ''}`
}

export type ApplyConfirmation = {
  newCost: string
  previousCost: string
  /** The proposal is in another currency than the current value: converted at the quote's rate on apply. */
  differentCurrency: boolean
}

export function applyConfirmation(
  current: { unitAmount: string | null; currencyCode: string | null },
  proposal: Record<string, unknown> | null,
): ApplyConfirmation {
  const amount = proposal && (typeof proposal.unitAmount === 'number' || typeof proposal.unitAmount === 'string') ? proposal.unitAmount : null
  const currency = proposal && typeof proposal.currencyCode === 'string' ? proposal.currencyCode : null
  return {
    newCost: formatCostAmount(amount, currency),
    previousCost: formatCostAmount(current.unitAmount, current.currencyCode),
    differentCurrency: Boolean(currency && current.currencyCode && currency !== current.currencyCode),
  }
}

// ─── Answer dialog ──────────────────────────────────────────────

export type AnswerForm = {
  unitAmount: string
  currencyCode: string
  valueStatus: 'confirmed' | 'estimated'
  supplierName: string
  supplierQuoteRef: string
  validUntil: string
  supplierTermEnd: string
  supplierMinTermMonths: string
  note: string
}

export type AnswerIssue =
  | 'AMOUNT_REQUIRED' | 'AMOUNT_INVALID' | 'CURRENCY_INVALID' | 'REF_REQUIRED' | 'REF_TOO_LONG'
  | 'DATE_INVALID' | 'VALID_UNTIL_IN_PAST' | 'TERM_INVALID' | 'NOTE_TOO_LONG'

export const ANSWER_ISSUE_FALLBACKS: Record<AnswerIssue, string> = {
  AMOUNT_REQUIRED: 'Enter the supplier cost',
  AMOUNT_INVALID: 'Enter an amount of zero or more with at most 4 decimals',
  CURRENCY_INVALID: 'Use a three-letter currency code, for example EUR',
  REF_REQUIRED: 'The supplier quote reference is required',
  REF_TOO_LONG: 'The supplier quote reference can be at most 100 characters',
  DATE_INVALID: 'Use the date format YYYY-MM-DD',
  VALID_UNTIL_IN_PAST: 'The offer must still be valid today',
  TERM_INVALID: 'Enter the minimum term as a whole number of months',
  NOTE_TOO_LONG: 'The note can be at most 500 characters',
}

export const emptyAnswerForm = (currencyCode: string, supplierName: string | null = null): AnswerForm => ({
  unitAmount: '', currencyCode, valueStatus: 'confirmed', supplierName: supplierName ?? '', supplierQuoteRef: '',
  validUntil: '', supplierTermEnd: '', supplierMinTermMonths: '', note: '',
})

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const NOTE_MAX = 500

export function answerFormIssues(form: AnswerForm, today: string): AnswerIssue[] {
  const issues: AnswerIssue[] = []
  const amount = parseAmount(form.unitAmount)
  if (amount === null) issues.push('AMOUNT_REQUIRED')
  else if (Number.isNaN(amount)) issues.push('AMOUNT_INVALID')
  if (!/^[A-Z]{3}$/.test(form.currencyCode.trim())) issues.push('CURRENCY_INVALID')
  const ref = form.supplierQuoteRef.trim()
  if (!ref) issues.push('REF_REQUIRED')
  else if (ref.length > 100) issues.push('REF_TOO_LONG')
  if ((form.validUntil && !ISO_DATE.test(form.validUntil)) || (form.supplierTermEnd && !ISO_DATE.test(form.supplierTermEnd))) issues.push('DATE_INVALID')
  else if (form.validUntil && form.validUntil < today) issues.push('VALID_UNTIL_IN_PAST')
  if (form.supplierMinTermMonths && !/^\d+$/.test(form.supplierMinTermMonths.trim())) issues.push('TERM_INVALID')
  if (form.note.trim().length > NOTE_MAX) issues.push('NOTE_TOO_LONG')
  return issues
}

const optional = (value: string): string | undefined => (value.trim() === '' ? undefined : value.trim())

/** `POST …/answer` body. Call only when `answerFormIssues` is empty. */
export function buildAnswerBody(form: AnswerForm, costRequestId: string, supplierId?: string | null): Record<string, unknown> {
  return {
    costRequestId,
    unitAmount: Number(form.unitAmount.trim()),
    currencyCode: form.currencyCode.trim(),
    valueStatus: form.valueStatus,
    supplierQuoteRef: form.supplierQuoteRef.trim(),
    ...(supplierId ? { supplierId } : {}),
    ...(optional(form.supplierName) ? { supplierName: optional(form.supplierName) } : {}),
    ...(optional(form.validUntil) ? { validUntil: form.validUntil.trim() } : {}),
    ...(optional(form.supplierTermEnd) ? { supplierTermEnd: form.supplierTermEnd.trim() } : {}),
    ...(optional(form.supplierMinTermMonths) ? { supplierMinTermMonths: Number(form.supplierMinTermMonths.trim()) } : {}),
    ...(optional(form.note) ? { note: form.note.trim() } : {}),
  }
}

// ─── Decline dialog ─────────────────────────────────────────────

export type DeclineIssue = 'REASON_REQUIRED' | 'REASON_TOO_LONG'
export const DECLINE_ISSUE_FALLBACKS: Record<DeclineIssue, string> = {
  REASON_REQUIRED: 'Say why the supplier cannot quote',
  REASON_TOO_LONG: 'The reason can be at most 500 characters',
}

export function declineIssues(reason: string): DeclineIssue[] {
  const trimmed = reason.trim()
  if (!trimmed) return ['REASON_REQUIRED']
  return trimmed.length > NOTE_MAX ? ['REASON_TOO_LONG'] : []
}

export const buildDeclineBody = (reason: string, costRequestId: string): Record<string, unknown> => ({ costRequestId, reason: reason.trim() })

// ─── Errors ─────────────────────────────────────────────────────

export const SOURCING_ERROR_FALLBACKS: Record<string, string> = {
  COST_REQUEST_SUPERSEDED: 'This request was replaced — open the current one',
  SUPPLIER_QUOTE_REF_CONFLICT: 'This supplier quote reference was already used with a different answer',
  REQUEST_NOT_OPEN: 'This request is no longer open',
  QUOTE_CLOSED: 'The quote is closed — the request was removed',
  QUOTE_CONVERTED: 'The quote was converted to an order',
  VALID_UNTIL_IN_PAST: 'The offer must still be valid today',
  INVALID_CURRENCY_CODE: 'Use a three-letter currency code, for example EUR',
  STALE_REVISION: 'Quote changed, reload',
  NO_PENDING_ANSWER: 'There is no supplier answer waiting to be applied',
  LINE_NOT_ELIGIBLE: 'This cost line cannot be requested from a supplier',
  COST_PLUS_DISABLED: 'Cost-plus pricing is switched off for this tenant',
  FORBIDDEN: 'You do not have permission to do this',
  VALIDATION: 'Check the highlighted values',
  UNKNOWN: 'The change could not be saved',
}

/** What the caller does after a failed sourcing write: keep the dialog, reload the data, or drop the row. */
export type SourcingErrorEffect = 'stay' | 'refresh' | 'remove'

export type SourcingFailure = { code: string; effect: SourcingErrorEffect; orderId: string | null }

/**
 * Classifies a failed answer / decline / request / apply response (feature spec §UI/UX):
 * superseded / stale / not open -> refresh; closed -> remove the row; converted -> stay with a link to the order
 * when the body carries `orderId`, else remove; everything else stays on the dialog.
 */
export function classifySourcingError(status: number, body: unknown): SourcingFailure {
  const code = costErrorCode(status, body)
  const orderId = typeof (body as { orderId?: unknown } | null)?.orderId === 'string' ? (body as { orderId: string }).orderId : null
  if (code === 'QUOTE_CLOSED') return { code, effect: 'remove', orderId }
  if (code === 'QUOTE_CONVERTED') return { code, effect: orderId ? 'stay' : 'remove', orderId }
  if (code === 'COST_REQUEST_SUPERSEDED' || code === 'STALE_REVISION' || code === 'REQUEST_NOT_OPEN' || code === 'NO_PENDING_ANSWER') {
    return { code, effect: 'refresh', orderId }
  }
  return { code, effect: 'stay', orderId }
}

export const sourcingErrorFallback = (code: string): string => SOURCING_ERROR_FALLBACKS[code] ?? code

export const ANSWER_OUTCOME_FALLBACKS: Record<string, string> = {
  applied: 'Supplier cost applied',
  confirmed_unchanged: 'Supplier confirmed the current cost',
  proposed: 'Supplier answer saved as a proposal — apply it to reprice the quote',
  noop: 'This answer was already recorded',
}

// ─── Row expansion (detail of one cost request) ─────────────────

export type HistoryRow = { seq: string; requested: string; closed: string; outcome: string; reason: string; ref: string }

const day = (value: unknown): string => (typeof value === 'string' && value ? value.slice(0, 10) : '—')

/** Request history (oldest first as stored) shaped for the expansion table. Never an amount. */
export function historyRows(history: ReadonlyArray<Record<string, unknown>> | null | undefined): HistoryRow[] {
  return (history ?? []).map((entry) => ({
    seq: typeof entry.requestSeq === 'number' ? `#${entry.requestSeq}` : '—',
    requested: day(entry.requestedAt),
    closed: day(entry.closedAt),
    outcome: typeof entry.outcome === 'string' ? entry.outcome : '—',
    reason: String(entry.declineReason ?? entry.reason ?? '') || '—',
    ref: typeof entry.supplierQuoteRef === 'string' && entry.supplierQuoteRef ? entry.supplierQuoteRef : '—',
  }))
}

/** `{ key: value }` of the line configuration attributes -> "key: value" pairs, null / empty values shown as "—". */
export function attributePairs(attributes: Record<string, unknown> | null | undefined): Array<[string, string]> {
  return Object.entries(attributes ?? {}).map(([key, value]) => [
    key,
    value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value),
  ])
}
