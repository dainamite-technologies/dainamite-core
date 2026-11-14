/**
 * Pure view helpers for the cost-plus parts of the quote page (feature spec
 * §UI/UX). Client-safe: type-only imports from the services. Mirrors the
 * server's lock matrix for display only; the API stays the authority.
 */
import type { MarginFigures, QuoteMargin } from '../services/costs/quoteMargin'

/** Same set `isQuoteCostLocked` uses: costs that change the price are editable only in these statuses. */
export const COST_EDITABLE_STATUSES = ['new', 'incomplete', 'ready'] as const

/** What every user with `cpq.quotes.view` gets for a cost line. */
export type RedactedQuoteCost = {
  id: string
  costKey: string
  name: string
  role: 'price_basis' | 'margin_only' | string
  valueStatus: 'none' | 'estimated' | 'confirmed' | string
  expired: boolean
  error?: string
}

/** The full cost line, `cpq.costs.view` only. Decimals are strings. */
export type FullQuoteCost = RedactedQuoteCost & {
  quoteLineId: string
  chargeCode: string | null
  origin: 'catalog' | 'manual' | string
  costType: 'nrc' | 'mrc' | string
  source: 'fixed' | 'table' | 'on_request' | string
  costModel: string
  /** Where the stored value came from; a `catalog` value needs a note to be overwritten. */
  valueOrigin?: 'catalog' | 'manual' | string | null
  unitAmount: string | null
  instanceAmount: string | null
  currencyCode: string | null
  supplierName: string | null
  supplierQuoteRef: string | null
  validUntil: string | null
  supplierTermEnd: string | null
  supplierMinTermMonths: number | null
  note: string | null
}

export type QuoteMarkupOverride = { id: string; quoteLineId: string; chargeCode: string; markupRule: string; markupValue: string; note: string | null }

export type QuoteCostsResponse = {
  lines: Array<{ quoteLineId: string; costs: Array<RedactedQuoteCost | FullQuoteCost> }>
  pricingRevision: number
  markupOverrides?: QuoteMarkupOverride[]
  margin?: QuoteMargin
}

export const isFullCost = (cost: RedactedQuoteCost | FullQuoteCost): cost is FullQuoteCost => 'unitAmount' in cost

export type CostBadge = 'pending' | 'estimated' | 'expired'

export const COST_BADGE_FALLBACKS: Record<CostBadge, string> = {
  pending: 'Cost pending',
  estimated: 'Estimated',
  expired: 'Expired cost',
}

/** Badges for one line, in a stable order. Text, never colour alone (the caller renders the label). */
export function lineCostBadges(costs: ReadonlyArray<Pick<RedactedQuoteCost, 'valueStatus' | 'expired'>>): CostBadge[] {
  const badges: CostBadge[] = []
  if (costs.some((cost) => cost.valueStatus === 'none')) badges.push('pending')
  if (costs.some((cost) => cost.valueStatus === 'estimated')) badges.push('estimated')
  if (costs.some((cost) => cost.expired)) badges.push('expired')
  return badges
}

/** The quote is indicative while any price-basis cost is only an estimate. */
export function isQuoteIndicative(lines: ReadonlyArray<{ costs: ReadonlyArray<Pick<RedactedQuoteCost, 'role' | 'valueStatus'>> }>): boolean {
  return lines.some((line) => line.costs.some((cost) => cost.role === 'price_basis' && cost.valueStatus === 'estimated'))
}

export const isCostLocked = (cpqStatus: string, convertedOrderId?: string | null): boolean =>
  Boolean(convertedOrderId) || !(COST_EDITABLE_STATUSES as readonly string[]).includes(cpqStatus)

export const COST_STATUS_FALLBACKS: Record<string, string> = { none: 'Cost pending', estimated: 'Estimated', confirmed: 'Confirmed' }
export const COST_ROLE_FALLBACKS: Record<string, string> = { price_basis: 'Price basis', margin_only: 'Margin only' }
export const COST_SOURCE_FALLBACKS: Record<string, string> = { fixed: 'Fixed', table: 'Cost table', on_request: 'On request', manual: 'Manual' }

/** How an unpriced cost-plus charge is shown: "≈ fallback" while a fallback exists, else "Price on request". */
export function unpricedChargeLabel(charge: { fallbackPrice?: number | null }): { kind: 'approx'; amount: number } | { kind: 'on_request' } {
  return typeof charge.fallbackPrice === 'number' ? { kind: 'approx', amount: charge.fallbackPrice } : { kind: 'on_request' }
}

export const isUnpricedCostPlus = (charge: { pricingMethod?: string | null; unitPrice?: number | null }): boolean =>
  charge.pricingMethod === 'cost_plus' && (charge.unitPrice === null || charge.unitPrice === undefined)

/** Percent number (0–100) or null → "42.5%" / "—". */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`
}

export type { MarginFigures, QuoteMargin }

// ─── Margin card view model ─────────────────────────────────────

export function formatMoney(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

export const hasAnyCosts = (lines: ReadonlyArray<{ costs: ReadonlyArray<unknown> }> | undefined): boolean =>
  (lines ?? []).some((line) => line.costs.length > 0)

export type MarginCardView = {
  contractMargin: string
  marginPercent: string
  nrcMargin: string
  mrcMargin: string
  /** Formatted coverage ("80%"), shown as "based on X% coverage". */
  coverage: string
  flags: CostBadge[]
}

/** Pending / estimated / expired flags, in the same stable order as the line badges. */
export function marginFlags(margin: Pick<MarginFigures, 'hasPendingCosts' | 'hasEstimatedCosts' | 'hasExpiredCosts'>): CostBadge[] {
  const flags: CostBadge[] = []
  if (margin.hasPendingCosts) flags.push('pending')
  if (margin.hasEstimatedCosts) flags.push('estimated')
  if (margin.hasExpiredCosts) flags.push('expired')
  return flags
}

export function marginCardView(margin: MarginFigures, currency: string): MarginCardView {
  return {
    contractMargin: formatMoney(margin.contractMargin, currency),
    marginPercent: formatPercent(margin.marginPercent),
    nrcMargin: formatMoney(margin.nrcMargin, currency),
    mrcMargin: formatMoney(margin.mrcMargin, currency),
    coverage: formatPercent(margin.costCoverage),
    flags: marginFlags(margin),
  }
}

export type BundleRollupRow = { lineId: string; name: string; contractMargin: string; marginPercent: string }

/** Roll-up (own + descendants) per bundle parent, in quote order. */
export function bundleRollupRows(margin: Pick<QuoteMargin, 'lines'>, parents: ReadonlyArray<{ lineId: string; name: string }>, currency: string): BundleRollupRow[] {
  const byLine = new Map(margin.lines.map((line) => [line.lineId, line]))
  return parents.flatMap((parent) => {
    const line = byLine.get(parent.lineId)
    return line ? [{ lineId: parent.lineId, name: parent.name, contractMargin: formatMoney(line.rollup.contractMargin, currency), marginPercent: formatPercent(line.rollup.marginPercent) }] : []
  })
}

// ─── Write errors ───────────────────────────────────────────────

export const COST_ERROR_FALLBACKS: Record<string, string> = {
  COST_LOCKED: 'This cost changes the price and the quote is locked — move it back to Ready first',
  STALE_REVISION: 'Prices changed since you opened the quote — reload and try again',
  NOTE_REQUIRED: 'Add a note explaining why the catalog value is overwritten',
  VALIDITY_EVIDENCE_REQUIRED: 'Extending the validity needs a new supplier quote reference or a note',
  PRICE_BASIS_REQUIRES_COST_PLUS: 'A price-basis cost needs a cost-plus charge on this line',
  CHARGE_NOT_COST_PLUS: 'The markup can only be overridden on a cost-plus charge',
  CATALOG_COST_NOT_DELETABLE: 'Catalog costs follow the catalog and cannot be deleted — set the value instead',
  CHARGE_NOT_FOUND: 'The charge no longer exists on this line',
  COST_TYPE_MISMATCH: 'The cost type does not match the charge type',
  LINE_NOT_ELIGIBLE: 'This line cannot carry costs',
  AMOUNT_REQUIRED: 'Enter the cost amount',
  CURRENCY_NO_RATE: 'No exchange rate is available for this currency',
  FIELD_NOT_ALLOWED: 'This field cannot be changed on a catalog cost',
  QUANTITY_ATTRIBUTE_REQUIRED: 'The line has no quantity attribute for a per-unit cost',
  FORBIDDEN: 'You do not have permission to change costs',
  VALIDATION: 'Check the highlighted values',
  UNKNOWN: 'The change could not be saved',
}

/** Error code of a failed cost / markup / status write: a SCREAMING_CASE `error`, then the HTTP status. */
export function costErrorCode(status: number, body: unknown): string {
  const record = (body ?? {}) as { error?: unknown; details?: Array<{ message?: unknown }> }
  if (typeof record.error === 'string' && /^[A-Z][A-Z_]+$/.test(record.error)) return record.error
  if (status === 403) return 'FORBIDDEN'
  if (status === 409) return 'COST_LOCKED'
  if (status === 400) return 'VALIDATION'
  return typeof record.error === 'string' && record.error ? record.error : 'UNKNOWN'
}

export const costErrorFallback = (code: string): string => COST_ERROR_FALLBACKS[code] ?? code

/** Outcome of a status-change attempt: a stale revision is its own case so the page can offer a reload. */
export function statusFailure(status: number, body: unknown): { kind: 'stale' } | { kind: 'error'; message: string } {
  if (costErrorCode(status, body) === 'STALE_REVISION') return { kind: 'stale' }
  const message = (body as { error?: unknown } | null)?.error
  return { kind: 'error', message: typeof message === 'string' && message ? message : `Request failed (${status})` }
}

// ─── Cost dialog form ───────────────────────────────────────────

export type CostForm = {
  name: string
  role: 'price_basis' | 'margin_only'
  costType: 'nrc' | 'mrc'
  source: 'fixed' | 'on_request'
  costModel: 'flat' | 'per_unit'
  /** '' = a line-level (margin-only) cost. */
  chargeCode: string
  unitAmount: string
  currencyCode: string
  valueStatus: 'estimated' | 'confirmed'
  supplierName: string
  supplierQuoteRef: string
  validUntil: string
  supplierTermEnd: string
  supplierMinTermMonths: string
  note: string
}

export type CostFormIssue = 'NAME_REQUIRED' | 'AMOUNT_INVALID' | 'CURRENCY_INVALID' | 'NOTE_REQUIRED' | 'VALIDITY_EVIDENCE_REQUIRED' | 'DATE_INVALID' | 'TERM_INVALID'

export const emptyCostForm = (currencyCode: string): CostForm => ({
  name: '', role: 'margin_only', costType: 'mrc', source: 'fixed', costModel: 'flat', chargeCode: '', unitAmount: '', currencyCode,
  valueStatus: 'estimated', supplierName: '', supplierQuoteRef: '', validUntil: '', supplierTermEnd: '', supplierMinTermMonths: '', note: '',
})

/** The edit form starts from the stored cost. The note starts empty: only a note typed now counts as the reason. */
export function costFormFromCost(cost: FullQuoteCost, quoteCurrency: string, confirm: boolean): CostForm {
  return {
    name: cost.name,
    role: cost.role === 'price_basis' ? 'price_basis' : 'margin_only',
    costType: cost.costType === 'nrc' ? 'nrc' : 'mrc',
    source: cost.source === 'on_request' ? 'on_request' : 'fixed',
    costModel: cost.costModel === 'per_unit' ? 'per_unit' : 'flat',
    chargeCode: cost.chargeCode ?? '',
    unitAmount: cost.unitAmount ?? '',
    currencyCode: cost.currencyCode ?? quoteCurrency,
    valueStatus: confirm || cost.valueStatus === 'confirmed' ? 'confirmed' : 'estimated',
    supplierName: cost.supplierName ?? '',
    supplierQuoteRef: cost.supplierQuoteRef ?? '',
    validUntil: cost.validUntil ?? '',
    supplierTermEnd: cost.supplierTermEnd ?? '',
    supplierMinTermMonths: cost.supplierMinTermMonths === null ? '' : String(cost.supplierMinTermMonths),
    note: '',
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Parses a decimal text; null when empty, NaN when not a non-negative number with at most 4 decimals. */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0 || Math.abs(Math.round(value * 10_000) / 10_000 - value) > 1e-9) return Number.NaN
  return value
}

const sameAmount = (before: string | null, after: number | null) => (before === null ? null : Number(before)) === after

/** Validation the form can do before calling the API, mirroring the server's note / evidence rules (R11). */
export function costFormIssues(form: CostForm, existing: FullQuoteCost | null): CostFormIssue[] {
  const issues: CostFormIssue[] = []
  const note = form.note.trim()
  if (!existing || existing.origin === 'manual') {
    if (!form.name.trim()) issues.push('NAME_REQUIRED')
  }
  const amount = parseAmount(form.unitAmount)
  if (Number.isNaN(amount)) issues.push('AMOUNT_INVALID')
  if (form.currencyCode && !/^[A-Z]{3}$/.test(form.currencyCode.trim())) issues.push('CURRENCY_INVALID')
  if ((form.validUntil && !ISO_DATE.test(form.validUntil)) || (form.supplierTermEnd && !ISO_DATE.test(form.supplierTermEnd))) issues.push('DATE_INVALID')
  if (form.supplierMinTermMonths && !/^\d+$/.test(form.supplierMinTermMonths.trim())) issues.push('TERM_INVALID')
  if (existing) {
    const next = Number.isNaN(amount) ? null : amount
    const valueChanged = !sameAmount(existing.unitAmount, next) || (existing.currencyCode !== null && existing.currencyCode !== form.currencyCode.trim())
    if (existing.valueOrigin === 'catalog' && valueChanged && !note) issues.push('NOTE_REQUIRED')
    const extended = (form.validUntil && (!existing.validUntil || form.validUntil > existing.validUntil))
      || (form.supplierTermEnd && (!existing.supplierTermEnd || form.supplierTermEnd > existing.supplierTermEnd))
    const newRef = form.supplierQuoteRef.trim()
    if (extended && !(newRef && newRef !== (existing.supplierQuoteRef ?? '')) && !note) issues.push('VALIDITY_EVIDENCE_REQUIRED')
  }
  return issues
}

export const COST_ISSUE_FALLBACKS: Record<CostFormIssue, string> = {
  NAME_REQUIRED: 'Enter a name for the cost',
  AMOUNT_INVALID: 'Enter an amount of zero or more with at most 4 decimals',
  CURRENCY_INVALID: 'Use a three-letter currency code, for example EUR',
  DATE_INVALID: 'Use the date format YYYY-MM-DD',
  TERM_INVALID: 'Enter the minimum term as a whole number of months',
  NOTE_REQUIRED: COST_ERROR_FALLBACKS.NOTE_REQUIRED,
  VALIDITY_EVIDENCE_REQUIRED: COST_ERROR_FALLBACKS.VALIDITY_EVIDENCE_REQUIRED,
}

const text = (value: string): string | null => (value.trim() === '' ? null : value.trim())

/** `POST /costs` body. Amount only for a fixed source; status only alongside an amount. */
export function buildCostCreateBody(form: CostForm, quoteLineId: string, expectedRevision: number): Record<string, unknown> {
  const amount = parseAmount(form.unitAmount)
  return {
    quoteLineId,
    chargeCode: text(form.chargeCode),
    name: form.name.trim(),
    role: form.role,
    costType: form.costType,
    source: form.source,
    costModel: form.costModel,
    ...(amount !== null && !Number.isNaN(amount) ? { unitAmount: amount, valueStatus: form.valueStatus } : {}),
    ...(text(form.currencyCode) ? { currencyCode: form.currencyCode.trim() } : {}),
    ...(text(form.supplierName) ? { supplierName: form.supplierName.trim() } : {}),
    ...(text(form.supplierQuoteRef) ? { supplierQuoteRef: form.supplierQuoteRef.trim() } : {}),
    ...(text(form.validUntil) ? { validUntil: form.validUntil.trim() } : {}),
    ...(text(form.supplierTermEnd) ? { supplierTermEnd: form.supplierTermEnd.trim() } : {}),
    ...(text(form.supplierMinTermMonths) ? { supplierMinTermMonths: Number(form.supplierMinTermMonths) } : {}),
    ...(text(form.note) ? { note: form.note.trim() } : {}),
    expectedRevision,
  }
}

/** `PATCH /costs/{id}` body: only what changed; confirming always sends `valueStatus: 'confirmed'`. */
export function buildCostPatch(form: CostForm, existing: FullQuoteCost, confirm: boolean, expectedRevision: number): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (existing.origin === 'manual') {
    if (form.name.trim() !== existing.name) patch.name = form.name.trim()
    if (form.role !== existing.role) patch.role = form.role
    if (form.costType !== existing.costType) patch.costType = form.costType
    if (form.source !== existing.source) patch.source = form.source
    if (form.costModel !== existing.costModel) patch.costModel = form.costModel
    if (text(form.chargeCode) !== existing.chargeCode) patch.chargeCode = text(form.chargeCode)
  }
  const amount = parseAmount(form.unitAmount)
  const nextAmount = amount === null || Number.isNaN(amount) ? null : amount
  // The value is sent only when the user changed it: an untouched value (or the quote-currency default shown for a
  // cost that has no value yet) must never be written back, and a supplier-ref-only edit must never clear it.
  const amountChanged = !sameAmount(existing.unitAmount, nextAmount)
  if (amountChanged) patch.unitAmount = nextAmount
  const currency = text(form.currencyCode)
  if (currency && (existing.currencyCode !== null ? currency !== existing.currencyCode : amountChanged && nextAmount !== null)) patch.currencyCode = currency
  // A row without a value has no status to compare with, and the server would default one by source
  // (`fixed` -> confirmed): an entered value always carries the status the user chose.
  if (confirm) patch.valueStatus = 'confirmed'
  else if (nextAmount !== null && (existing.valueStatus === 'none' || form.valueStatus !== existing.valueStatus)) patch.valueStatus = form.valueStatus
  if (text(form.supplierName) !== existing.supplierName) patch.supplierName = text(form.supplierName)
  if (text(form.supplierQuoteRef) !== existing.supplierQuoteRef) patch.supplierQuoteRef = text(form.supplierQuoteRef)
  if (text(form.validUntil) !== existing.validUntil) patch.validUntil = text(form.validUntil)
  if (text(form.supplierTermEnd) !== existing.supplierTermEnd) patch.supplierTermEnd = text(form.supplierTermEnd)
  const months = text(form.supplierMinTermMonths) === null ? null : Number(form.supplierMinTermMonths)
  if (months !== existing.supplierMinTermMonths) patch.supplierMinTermMonths = months
  if (text(form.note)) patch.note = form.note.trim()
  patch.expectedRevision = expectedRevision
  return patch
}

// ─── Markup override dialog form ────────────────────────────────

export const MARKUP_RULES = ['markup_percent', 'target_margin_percent', 'markup_absolute'] as const
export type MarkupRule = (typeof MARKUP_RULES)[number]
export const MARKUP_RULE_FALLBACKS: Record<MarkupRule, string> = {
  markup_percent: 'Markup on cost (%)',
  target_margin_percent: 'Target margin (%)',
  markup_absolute: 'Fixed amount on top of cost',
}
export const NOTE_MAX_LENGTH = 500

export type MarkupForm = { chargeCode: string; markupRule: MarkupRule; markupValue: string; note: string }
export type MarkupFormIssue = 'CHARGE_REQUIRED' | 'VALUE_INVALID' | 'TARGET_MARGIN_TOO_HIGH' | 'NOTE_REQUIRED' | 'NOTE_TOO_LONG'

export function markupFormIssues(form: MarkupForm): MarkupFormIssue[] {
  const issues: MarkupFormIssue[] = []
  if (!form.chargeCode) issues.push('CHARGE_REQUIRED')
  const value = parseAmount(form.markupValue)
  if (value === null || Number.isNaN(value)) issues.push('VALUE_INVALID')
  else if (form.markupRule === 'target_margin_percent' && value >= 100) issues.push('TARGET_MARGIN_TOO_HIGH')
  const note = form.note.trim()
  if (!note) issues.push('NOTE_REQUIRED')
  else if (note.length > NOTE_MAX_LENGTH) issues.push('NOTE_TOO_LONG')
  return issues
}

export const MARKUP_ISSUE_FALLBACKS: Record<MarkupFormIssue, string> = {
  CHARGE_REQUIRED: 'Pick the charge to override',
  VALUE_INVALID: 'Enter a value of zero or more with at most 4 decimals',
  TARGET_MARGIN_TOO_HIGH: 'A target margin must be below 100%',
  NOTE_REQUIRED: 'A note is required — say why the markup is overridden',
  NOTE_TOO_LONG: 'The note can be at most 500 characters',
}

export function buildMarkupBody(form: MarkupForm, quoteLineId: string, expectedRevision: number): Record<string, unknown> {
  return { quoteLineId, chargeCode: form.chargeCode, markupRule: form.markupRule, markupValue: Number(form.markupValue.trim()), note: form.note.trim(), expectedRevision }
}

export const markupClearQuery = (quoteLineId: string, chargeCode: string, expectedRevision: number): string =>
  `quoteLineId=${encodeURIComponent(quoteLineId)}&chargeCode=${encodeURIComponent(chargeCode)}&expectedRevision=${expectedRevision}`
