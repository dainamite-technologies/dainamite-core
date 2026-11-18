/**
 * Pure view helpers for the ARC cost UI (ARC costs spec §UI/UX): badges, notices, the "Was …" diff, Keep current cost,
 * Refresh from subscription, COST_SOURCE_CHANGED, Cancel exposure and the ArcLineDiff cost rows. Client-safe (no
 * service imports). The API stays the authority; these only decide what to show.
 */
import { isPhase1RenewLine } from './arcRenewBanner'
import type { OrderCostsResponse } from './orderInventoryCostView'
import { formatCostAmount, isSourcingClosed } from './costSourcingView'
import {
  isCostLocked,
  isFullCost,
  type ArcCostsView,
  type CancelExposureView,
  type CostPrevious,
  type FullQuoteCost,
  type QuoteCostLineEntry,
  type QuoteCostsResponse,
  type RedactedQuoteCost,
} from './quoteCostView'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type ArcLineShape = { action?: string | null; configuration?: Record<string, unknown> | null; targetSubscriptionId?: string | null }

// ─── Notices and badges ─────────────────────────────────────────

export type ArcLineNotice = 'phase1' | 'merge'

export const ARC_LINE_NOTICE_FALLBACKS: Record<ArcLineNotice, string> = {
  phase1: 'Created before cost carry-over — costs kept as contracted. Refresh the line to renegotiate.',
  merge: 'Costs are not carried to merged subscriptions',
}

/** The line notice of a Renew mirror line: Phase 1 frozen standalone lines, and merge lines (no single item to carry from). */
export function arcLineNotice(quoteType: string | null | undefined, line: ArcLineShape): ArcLineNotice | null {
  if (quoteType !== 'renew' || line.action === 'cancel') return null
  if (typeof line.configuration?._arcMirroredFromItemId !== 'string') return null
  if (line.targetSubscriptionId === null) return 'merge'
  return isPhase1RenewLine(line) ? 'phase1' : null
}

export type ArcCostBadge = 'carried' | 'renegotiationDue'
export const ARC_COST_BADGE_FALLBACKS: Record<ArcCostBadge, string> = { carried: 'Carried', renegotiationDue: 'Renegotiation due' }

/** Badges for a line's costs, in a stable order. Carried and due are booleans on the status-only projection, so every user sees them. */
export function arcCostBadges(costs: ReadonlyArray<Pick<RedactedQuoteCost, 'carried' | 'renegotiationDue'>>): ArcCostBadge[] {
  const badges: ArcCostBadge[] = []
  if (costs.some((cost) => cost.carried === true)) badges.push('carried')
  if (costs.some((cost) => cost.renegotiationDue === true)) badges.push('renegotiationDue')
  return badges
}

// ─── Line meta from the costs read ──────────────────────────────

export const costLineEntry = (data: QuoteCostsResponse | null | undefined, lineId: string): QuoteCostLineEntry | undefined =>
  data?.lines.find((line) => line.quoteLineId === lineId)

/** The `costs` prop of `ArcLineDiff` for a line: present for `cpq.costs.view` holders only (the server omits it otherwise). */
export const arcCostsOfLine = (data: QuoteCostsResponse | null | undefined, lineId: string): ArcCostsView | undefined =>
  costLineEntry(data, lineId)?.arcCosts

/** Same for an order line (`GET /orders/{id}/costs`; before activation only, holders only). */
export const orderArcCostsOfLine = (response: OrderCostsResponse | null | undefined, orderLineId: string): ArcCostsView | undefined =>
  response?.lines.find((line) => line.orderLineId === orderLineId)?.arcCosts

// ─── "Was …" diff ───────────────────────────────────────────────

const sameNumber = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Number(a) === Number(b))

/** What the "Was …" diff needs of a quote cost line or an order cost (both carry `origin`, the values and `previous`). */
export type CarriedLike = {
  origin?: string
  carried?: boolean
  previous?: CostPrevious
  unitAmount: string | null
  currencyCode: string | null
  supplierName: string | null
  validUntil: string | null
  supplierTermEnd: string | null
}

/** A carried cost whose current value, currency, supplier, validity or supplier term differs from the item cost it was carried from. */
export function carriedChanged(cost: CarriedLike): boolean {
  const before = cost.previous
  if (!(cost.carried === true || cost.origin === 'carried') || !before) return false
  return !sameNumber(before.unitAmount, cost.unitAmount)
    || before.currencyCode !== cost.currencyCode
    || before.supplierName !== cost.supplierName
    || before.validUntil !== cost.validUntil
    || before.supplierTermEnd !== cost.supplierTermEnd
}

export type PreviousParts = { value: string; supplierName: string | null; termEnd: string | null }

/** Parts of "Was 270 EUR · Carrier X · term to 2028-11-30"; `null` unless the carried cost changed. */
export function previousParts(cost: CarriedLike): PreviousParts | null {
  const before = cost.previous
  if (!before || !carriedChanged(cost)) return null
  return { value: formatCostAmount(before.unitAmount, before.currencyCode), supplierName: before.supplierName, termEnd: before.supplierTermEnd }
}

// ─── Cost-only Amend hint ───────────────────────────────────────

export const COST_ONLY_AMEND_FALLBACK = 'Internal change — no customer document needed; move to Accepted when ready.'

/**
 * An Amend whose lines are all untouched frozen mirror lines (no add / cancel / reconfigured line) and whose carried costs
 * changed: a pure cost change with a zero billing diff. Holders only in practice (the "Was" data comes with `cpq.costs.view`).
 */
export function isCostOnlyAmend(quoteType: string | null | undefined, lines: ReadonlyArray<ArcLineShape>, data: QuoteCostsResponse | null | undefined): boolean {
  if (quoteType !== 'amend' || lines.length === 0) return false
  const untouched = lines.every((line) => line.action === 'modify' && line.configuration?._arcPriceFrozen === true && line.configuration?._arcReconfigured !== true)
  if (!untouched) return false
  return (data?.lines ?? []).some((entry) => entry.costs.some((cost) => isFullCost(cost) && carriedChanged(cost)))
}

// ─── Keep current cost ──────────────────────────────────────────

/** Keep current cost: a renegotiation-due carried cost with an amount, to a manager, on a quote that is not closed. */
export function canKeepCurrent(cost: RedactedQuoteCost | FullQuoteCost, context: { canManage: boolean; cpqStatus: string; convertedOrderId?: string | null }): boolean {
  if (!context.canManage || isSourcingClosed(context.cpqStatus, context.convertedOrderId)) return false
  return isFullCost(cost) && cost.carried === true && cost.renegotiationDue === true && cost.unitAmount !== null
}

export type KeepCurrentForm = { validUntil: string; supplierTermEnd: string; rolling: boolean; supplierQuoteRef: string; note: string }
export type KeepCurrentIssue = 'DATE_INVALID' | 'VALIDITY_EVIDENCE_REQUIRED'

export const KEEP_CURRENT_ISSUE_FALLBACKS: Record<KeepCurrentIssue, string> = {
  DATE_INVALID: 'Use the date format YYYY-MM-DD',
  VALIDITY_EVIDENCE_REQUIRED: 'Add a new supplier quote reference or a note as evidence',
}

/** Starts from the stored dates; the supplier quote ref and note start empty (only evidence typed now counts). */
export const keepCurrentFormFromCost = (cost: FullQuoteCost): KeepCurrentForm => ({
  validUntil: cost.validUntil ?? '', supplierTermEnd: cost.supplierTermEnd ?? '', rolling: false, supplierQuoteRef: '', note: '',
})

const clean = (value: string) => (value.trim() === '' ? null : value.trim())

/** What the form can check before calling the API: date format, and the evidence rule (a NEW supplier quote ref, or a note). */
export function keepCurrentIssues(form: KeepCurrentForm, cost: Pick<FullQuoteCost, 'supplierQuoteRef'>): KeepCurrentIssue[] {
  const issues: KeepCurrentIssue[] = []
  const bad = (value: string) => value.trim() !== '' && !ISO_DATE.test(value.trim())
  if (bad(form.validUntil) || (!form.rolling && bad(form.supplierTermEnd))) issues.push('DATE_INVALID')
  const ref = clean(form.supplierQuoteRef)
  if (!(ref && ref !== (cost.supplierQuoteRef ?? '')) && !clean(form.note)) issues.push('VALIDITY_EVIDENCE_REQUIRED')
  return issues
}

/** Kept dates before the renewal's new term end (the server answers `RENEGOTIATION_DATES_SHORT`): shown as a warning. */
export function keepCurrentShortDates(form: KeepCurrentForm, newTermEnd: string | null | undefined): Array<'validUntil' | 'supplierTermEnd'> {
  if (!newTermEnd) return []
  const end = newTermEnd.slice(0, 10)
  const short: Array<'validUntil' | 'supplierTermEnd'> = []
  const valid = clean(form.validUntil)
  if (valid && ISO_DATE.test(valid) && valid < end) short.push('validUntil')
  const term = form.rolling ? null : clean(form.supplierTermEnd)
  if (term && ISO_DATE.test(term) && term < end) short.push('supplierTermEnd')
  return short
}

/** `PATCH /costs/{id}` body for Keep current cost: the flag, the dates, the evidence and `expectedRevision`; never an amount. */
export function buildKeepCurrentBody(form: KeepCurrentForm, expectedRevision: number): Record<string, unknown> {
  const valid = clean(form.validUntil)
  const term = clean(form.supplierTermEnd)
  const ref = clean(form.supplierQuoteRef)
  const note = clean(form.note)
  return {
    keepCurrent: true,
    ...(valid ? { validUntil: valid } : {}),
    // Rolling = no supplier term end: an explicit null clears the stored date.
    ...(form.rolling ? { supplierTermEnd: null } : term ? { supplierTermEnd: term } : {}),
    ...(ref ? { supplierQuoteRef: ref } : {}),
    ...(note ? { note } : {}),
    expectedRevision,
  }
}

// ─── Refresh from subscription ──────────────────────────────────

/**
 * Refresh from subscription: a standalone ARC mirror line (Amend or Renew, not a cancel / merge line, not marked for removal) while the
 * quote's costs are still editable, for a user who may manage quotes and the quote type's ARC feature (`granted` is the feature-check result).
 */
export function canRefreshFromSubscription(
  quoteType: string | null | undefined,
  line: ArcLineShape,
  context: { granted: readonly string[]; cpqStatus: string; convertedOrderId?: string | null; removed?: boolean },
): boolean {
  if (quoteType !== 'amend' && quoteType !== 'renew') return false
  if (context.removed || line.action === 'cancel' || !line.targetSubscriptionId) return false
  if (typeof line.configuration?._arcMirroredFromItemId !== 'string') return false
  if (isCostLocked(context.cpqStatus, context.convertedOrderId)) return false
  return context.granted.includes('cpq.quotes.manage') && context.granted.includes(`cpq.arc.${quoteType}.manage`)
}

export const REFRESH_CONFIRM_FALLBACK = 'Discards renegotiated costs and changes on this line'


// ─── COST_SOURCE_CHANGED ────────────────────────────────────────

export type CostSourceChangedEntry = { quoteLineId: string; subscriptionItemId: string; costKeys: string[] }

/** The lines of a `409 COST_SOURCE_CHANGED` body (`{ error, lines }`); `null` for any other failure. */
export function parseCostSourceChanged(status: number, body: unknown): CostSourceChangedEntry[] | null {
  if (status !== 409) return null
  const record = (body ?? {}) as { error?: unknown; lines?: unknown }
  if (record.error !== 'COST_SOURCE_CHANGED') return null
  const lines = Array.isArray(record.lines) ? record.lines : []
  return lines.flatMap((entry): CostSourceChangedEntry[] => {
    const line = (entry ?? {}) as Partial<CostSourceChangedEntry>
    if (typeof line.quoteLineId !== 'string') return []
    return [{
      quoteLineId: line.quoteLineId,
      subscriptionItemId: typeof line.subscriptionItemId === 'string' ? line.subscriptionItemId : '',
      costKeys: Array.isArray(line.costKeys) ? line.costKeys.filter((key): key is string => typeof key === 'string') : [],
    }]
  })
}

export type CostSourceChangedView = {
  lines: Array<{ quoteLineId: string; name: string; costKeys: string[]; refreshable: boolean }>
  /** Before conversion the lines can be refreshed; after it the only way out is to cancel the order and create a new Amend. */
  phase: 'quote' | 'order'
}

export const COST_SOURCE_CHANGED_FALLBACKS = {
  title: 'The subscription\'s costs changed since this quote was created',
  quote: 'Refresh the lines below from the subscription, then convert again.',
  order: 'Cancel this order and create a new Amend.',
}

/** Which lines changed, by name (the quote line name, else its id), and whether Refresh from subscription is on offer. */
export function costSourceChangedView(entries: ReadonlyArray<CostSourceChangedEntry>, names: ReadonlyMap<string, string>, phase: 'quote' | 'order'): CostSourceChangedView {
  return {
    phase,
    lines: entries.map((entry) => ({ quoteLineId: entry.quoteLineId, name: names.get(entry.quoteLineId) ?? entry.quoteLineId, costKeys: entry.costKeys, refreshable: phase === 'quote' })),
  }
}

// ─── Cancel exposure ────────────────────────────────────────────

export const hasExposure = (exposure: CancelExposureView | null | undefined): exposure is CancelExposureView => Boolean(exposure && exposure.items.length > 0)

export type ExposureRow = { key: string; label: string; termEnd: string | null; months: number | null; termUnknown: boolean }

/** One row per outliving cost: its name (with the supplier) and either the term end and exposure months, or "term unknown". No amounts. */
export function exposureRows(exposure: CancelExposureView | null | undefined): ExposureRow[] {
  if (!hasExposure(exposure)) return []
  return exposure.items.map((item) => ({
    key: item.inventoryCostId,
    label: item.supplierName && !item.name.includes(item.supplierName) ? `${item.supplierName} ${item.name}` : item.name,
    termEnd: item.supplierTermEnd,
    months: item.exposureMonths,
    termUnknown: item.termUnknown,
  }))
}

/** "as of today" while the reference date is today, else "as of {date}". */
export const exposureReference = (referenceDate: string, today: string): { today: boolean; date: string } => ({ today: referenceDate === today, date: referenceDate })

// ─── ArcLineDiff cost rows ──────────────────────────────────────

export type ArcDiffCostRow = { key: 'mrcCost' | 'mrcMargin' | 'nrcCost'; before: number; after: number }

/**
 * "MRC cost" / "MRC margin" / "NRC cost" rows. Margin = the line's price minus its cost (the cancel line's price after is 0).
 * `null` without costs: the rows stay hidden (the server omits `costs` without `cpq.costs.view`).
 */
export function arcDiffCostRows(costs: ArcCostsView | null | undefined, prices: { beforeMrc: number; afterMrc: number }): ArcDiffCostRow[] | null {
  if (!costs) return null
  const round = (value: number) => Math.round(value * 10_000) / 10_000
  return [
    { key: 'mrcCost', before: costs.before.mrcCost, after: costs.after.mrcCost },
    { key: 'mrcMargin', before: round(prices.beforeMrc - costs.before.mrcCost), after: round(prices.afterMrc - costs.after.mrcCost) },
    { key: 'nrcCost', before: costs.before.nrcCost, after: costs.after.nrcCost },
  ]
}

