import { createHash } from 'node:crypto'
import { isArcTerminationLine } from '../arcLineRemoval'
import { isArcMirrorLine, isArcReconfigured, isFrozenMirrorLine } from '../arcPriceFreeze'

/**
 * Supplier cost sourcing rules (feature spec `2026-11-12-cpq-cost-plus-supplier-sourcing`). Pure: no EM, no
 * clock, no I/O. The sourcing service feeds these with already-loaded state and applies the verdicts.
 */

export const REQUEST_HISTORY_CAP = 50
const NOTE_MAX = 500

export type SourcingStatus = 'not_requested' | 'requested' | 'answered' | 'declined' | 'cancelled'
export type CancelReason =
  | 'reconfigured' | 'line_removed' | 'element_deactivated' | 're_requested'
  | 'manual_value' | 'quote_closed' | 'cancelled_by_user'

// ─── Eligibility (Q14) ──────────────────────────────────────────

export type EligibilityLine = { action?: string | null; configuration?: Record<string, unknown> | null }
export type EligibilityCost = { origin: string; role: string }
export type Eligibility = { eligible: true } | { eligible: false; reason: 'CANCEL_LINE' | 'FROZEN_UNPRICEABLE' }

/**
 * A cost line can be requested / answered unless its quote line is a Cancel line (an ARC termination line) or
 * it is a price-basis cost on a frozen ARC mirror whose charge cannot be re-priced from cost. `carried` cost
 * lines are explicitly eligible (renegotiation-due costs on Renew mirrors, R13).
 */
export function costLineEligibility(line: EligibilityLine, cost: EligibilityCost, quoteType: string | null | undefined): Eligibility {
  if (isArcTerminationLine({ action: line.action ?? null } as never, quoteType)) return { eligible: false, reason: 'CANCEL_LINE' }
  if (cost.origin !== 'carried' && cost.role === 'price_basis' && isFrozenMirrorLine(line.configuration, quoteType)) {
    return { eligible: false, reason: 'FROZEN_UNPRICEABLE' }
  }
  return { eligible: true }
}

export const isCostLineEligible = (line: EligibilityLine, cost: EligibilityCost, quoteType: string | null | undefined): boolean =>
  costLineEligibility(line, cost, quoteType).eligible

// ─── Auto-open predicate (Q12) ──────────────────────────────────

export type AutoOpenInput = {
  /** `cpq.cost_plus` toggle. */
  enabled: boolean
  /** A saved recalculation; a preview never opens requests. */
  saved: boolean
  locked: boolean
  quoteType: string | null | undefined
  line: EligibilityLine
  cost: EligibilityCost & { source: string; valueStatus: string; sourcingStatus: string }
  /** The cost element's `requires_sourcing`. */
  requiresSourcing: boolean
  /** The line was just reset by R1b (a reconfiguration) in the same write. */
  resetByReconfiguration?: boolean
}

export function shouldAutoOpenRequest(input: AutoOpenInput): boolean {
  if (!input.enabled || !input.saved || input.locked) return false
  if (!input.requiresSourcing || input.cost.source !== 'on_request' || input.cost.valueStatus === 'confirmed') return false
  // Unreconfigured mirrors never auto-open (they carry costs, they do not source them).
  if (isArcMirrorLine(input.line.configuration, input.quoteType) && !isArcReconfigured(input.line.configuration)) return false
  if (!isCostLineEligible(input.line, input.cost, input.quoteType)) return false
  return input.cost.sourcingStatus === 'not_requested' || input.resetByReconfiguration === true
}

// ─── Answer normalization and hash (Q9) ─────────────────────────

export type SupplierAnswer = {
  costRequestId: string
  unitAmount: string | number
  currencyCode: string
  valueStatus?: string | null
  supplierQuoteRef: string
  supplierId?: string | null
  supplierName?: string | null
  validUntil?: string | Date | null
  supplierTermEnd?: string | Date | null
  supplierMinTermMonths?: number | null
  note?: string | null
}

export type NormalizedAnswer = {
  costRequestId: string
  unitAmount: string
  currencyCode: string
  valueStatus: 'confirmed' | 'estimated'
  supplierQuoteRef: string
  supplierId: string | null
  supplierName: string | null
  validUntil: string | null
  supplierTermEnd: string | null
  supplierMinTermMonths: number | null
  note: string | null
}

const trimmed = (value: string | null | undefined): string | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : null
}

function isoDate(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  const text = value.trim()
  if (!text) return null
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text
}

/** Amounts as 4-dp strings, so `280`, `"280.0"` and `280.00004` hash alike. */
export function formatAmount4(value: string | number): string {
  const numeric = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(numeric)) throw new Error(`Invalid amount: ${String(value)}`)
  const fixed = numeric.toFixed(4)
  return fixed === '-0.0000' ? '0.0000' : fixed
}

export function normalizeAnswer(answer: SupplierAnswer): NormalizedAnswer {
  return {
    costRequestId: answer.costRequestId.trim(),
    unitAmount: formatAmount4(answer.unitAmount),
    currencyCode: answer.currencyCode.trim().toUpperCase(),
    valueStatus: answer.valueStatus === 'estimated' ? 'estimated' : 'confirmed',
    supplierQuoteRef: answer.supplierQuoteRef.trim(),
    supplierId: trimmed(answer.supplierId),
    supplierName: trimmed(answer.supplierName),
    validUntil: isoDate(answer.validUntil),
    supplierTermEnd: isoDate(answer.supplierTermEnd),
    supplierMinTermMonths: typeof answer.supplierMinTermMonths === 'number' ? answer.supplierMinTermMonths : null,
    note: trimmed(answer.note),
  }
}

/** SHA-256 (hex) of the normalized payload with sorted keys; includes `costRequestId`. */
export function hashAnswer(answer: SupplierAnswer | NormalizedAnswer): string {
  const normalized = normalizeAnswer(answer as SupplierAnswer)
  const sorted = Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

// ─── Answer classification (Q9, Proposed Solution §2) ───────────

export type AnswerVerdict =
  | 'superseded' | 'noop' | 'conflict' | 'not_open'
  | 'applied' | 'confirmed_unchanged' | 'proposed'

export type AnswerClassificationInput = {
  answer: SupplierAnswer
  cost: {
    sourcingStatus: string
    costRequestId: string | null
    lastAnswerHash: string | null
    supplierQuoteRef: string | null
    unitAmount: string | number | null
    currencyCode: string | null
    /** A stored proposal's ref (a locked-quote proposal keeps the line's own `supplierQuoteRef`). */
    proposedAnswer?: { supplierQuoteRef?: string | null } | null
  }
  /** The cost element still exists and is active (manual / carried lines pass `true`). */
  elementActive: boolean
  locked: boolean
}

const sameAmount = (a: string | number | null, b: string | number | null): boolean => a !== null && b !== null && Number(a) === Number(b)

/**
 * The defined check order (all refusals write nothing): stale request id or inactive element -> superseded;
 * same ref + same hash -> noop; same ref + different hash -> conflict; request not open -> not_open; then the
 * value: unlocked -> applied; locked with the same amount + currency -> confirmed_unchanged; else proposed.
 */
export function classifyAnswer(input: AnswerClassificationInput): AnswerVerdict {
  const { answer, cost } = input
  const normalized = normalizeAnswer(answer)
  if (cost.costRequestId === null || cost.costRequestId !== normalized.costRequestId || !input.elementActive) return 'superseded'
  const knownRef = cost.proposedAnswer?.supplierQuoteRef ?? cost.supplierQuoteRef
  // Re-request clears the hash, so a ref reused by a new request is not a conflict until an answer is stored.
  if (cost.lastAnswerHash !== null && knownRef === normalized.supplierQuoteRef) {
    return cost.lastAnswerHash === hashAnswer(normalized) ? 'noop' : 'conflict'
  }
  if (cost.sourcingStatus !== 'requested') return 'not_open'
  if (!input.locked) return 'applied'
  return sameAmount(cost.unitAmount, normalized.unitAmount) && (cost.currencyCode ?? '').toUpperCase() === normalized.currencyCode
    ? 'confirmed_unchanged'
    : 'proposed'
}

// ─── Decline effect (Q3) ────────────────────────────────────────

export type DeclineEffect = {
  valueStatus: 'none' | 'estimated'
  /** Unlocked: the amount is cleared; locked: kept (price unchanged, I-5). */
  clearAmount: boolean
  note: string | null
}

export function declineEffect(cost: { unitAmount: string | number | null; valueStatus: string; note: string | null }, locked: boolean): DeclineEffect {
  const hasAmount = cost.unitAmount !== null && cost.unitAmount !== undefined
  if (locked) return { valueStatus: hasAmount ? 'estimated' : 'none', clearAmount: false, note: cost.note }
  if (!hasAmount) return { valueStatus: 'none', clearAmount: false, note: cost.note }
  const moved = `estimate ${Number(cost.unitAmount)} discarded: declined`
  const note = cost.note && cost.note.trim() ? `${cost.note.trim()} | ${moved}` : moved
  return { valueStatus: 'none', clearAmount: true, note: note.slice(0, NOTE_MAX) }
}

// ─── Request history (Q1) ───────────────────────────────────────

export type RequestHistoryEntry = {
  costRequestId: string
  requestSeq: number
  requestedAt: string | null
  requestedByUserId: string | null
  closedAt: string
  closedByUserId: string | null
  outcome: 'answered' | 'declined' | 'cancelled'
  reason?: string
  supplierId?: string
  supplierQuoteRef?: string
  declineReason?: string
}

export type CloseRequestInput = {
  cost: {
    costRequestId: string | null
    requestSeq: number | null
    requestedAt: Date | string | null
    requestedByUserId: string | null
    requestSupplierId?: string | null
    supplierId?: string | null
    supplierQuoteRef?: string | null
    declineReason?: string | null
  }
  outcome: RequestHistoryEntry['outcome']
  closedAt: Date
  closedByUserId: string | null
  reason?: CancelReason | string | null
}

/** Builds the history entry for a closing request. Never carries an amount. */
export function buildHistoryEntry(input: CloseRequestInput): RequestHistoryEntry | null {
  const { cost } = input
  if (!cost.costRequestId) return null
  const requestedAt = cost.requestedAt instanceof Date ? cost.requestedAt.toISOString() : cost.requestedAt ?? null
  const supplierId = (input.outcome === 'answered' ? cost.supplierId : cost.requestSupplierId) ?? cost.requestSupplierId ?? undefined
  const entry: RequestHistoryEntry = {
    costRequestId: cost.costRequestId,
    requestSeq: cost.requestSeq ?? 1,
    requestedAt,
    requestedByUserId: cost.requestedByUserId,
    closedAt: input.closedAt.toISOString(),
    closedByUserId: input.closedByUserId,
    outcome: input.outcome,
  }
  if (input.reason) entry.reason = input.reason
  if (supplierId) entry.supplierId = supplierId
  if (input.outcome === 'answered' && cost.supplierQuoteRef) entry.supplierQuoteRef = cost.supplierQuoteRef
  if (input.outcome === 'declined' && cost.declineReason) entry.declineReason = cost.declineReason
  return entry
}

/** Appends one closed request (newest last) and drops the oldest beyond the cap. Pure. */
export function appendRequestHistory<T>(history: readonly T[] | null | undefined, entry: T, cap = REQUEST_HISTORY_CAP): T[] {
  const next = [...(history ?? []), entry]
  return next.length > cap ? next.slice(next.length - cap) : next
}

// ─── Working-day age (Q10) ──────────────────────────────────────

const DAY_MS = 86_400_000
const utcDay = (date: Date) => Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS)

/**
 * Working days (Mon-Fri, UTC calendar days, no holiday calendar) elapsed after `from`'s day up to and
 * including `to`'s day: Monday -> next Tuesday is 6, Friday -> next Tuesday is 2. Never negative.
 */
export function workingDaysBetween(from: Date, to: Date): number {
  const start = utcDay(from)
  const end = utcDay(to)
  if (end <= start) return 0
  let count = 0
  for (let day = start + 1; day <= end; day++) {
    const weekday = new Date(day * DAY_MS).getUTCDay()
    if (weekday !== 0 && weekday !== 6) count++
  }
  return count
}

/** Open longer than the threshold (strictly), in working days. */
export const isRequestOverdue = (ageWorkingDays: number, thresholdWorkingDays: number): boolean => ageWorkingDays > thresholdWorkingDays

// ─── State invariants ───────────────────────────────────────────

/** Spec §Data Model state rules; returns the violated rules (empty = consistent). */
export function sourcingStateViolations(cost: {
  sourcingStatus: string
  costRequestId: string | null
  requestedAt: unknown
  answeredAt: unknown
  declineReason: string | null
  proposedAmount: string | number | null
}): string[] {
  const violations: string[] = []
  if (cost.sourcingStatus === 'requested' && (!cost.costRequestId || !cost.requestedAt)) violations.push('requested_needs_request_id_and_requested_at')
  if ((cost.sourcingStatus === 'answered' || cost.sourcingStatus === 'declined') && !cost.answeredAt) violations.push('closed_needs_answered_at')
  if (cost.sourcingStatus === 'declined' && !cost.declineReason) violations.push('declined_needs_reason')
  if (cost.proposedAmount !== null && cost.sourcingStatus !== 'answered') violations.push('proposal_needs_answered_status')
  return violations
}
