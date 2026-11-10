/**
 * Pure view helpers for negotiated quote prices. Client-safe: no service or
 * ORM imports. Rules mirror the server resolver
 * (`services/priceAdjustments/resolveManualAdjustments.ts`) so the UI only
 * offers what the API would accept; the API stays the authority.
 */

export const ADJUST_PRICE_FEATURE = 'cpq.quotes.adjust_price'
/** Matches `assertMutable` in the adjustment service. */
export const ADJUSTMENT_EDITABLE_STATUSES = ['new', 'incomplete', 'ready'] as const
/** Statuses where even an invalid adjustment can no longer be deleted. */
const INVALID_DELETE_BLOCKED = ['accepted', 'rejected', 'cancelled']

export type AdjustmentType = 'discount_percent' | 'discount_absolute' | 'price_override'
export type AdjustmentLevel = 'charge' | 'line'

export type WaterfallChargeInput = {
  chargeType: 'nrc' | 'mrc' | 'usage'
  pricingMethod?: string | null
  unitPrice: number
  totalPrice: number | null
  listUnitPrice?: number
  listTotalPrice?: number | null
  standardUnitPrice?: number
  standardTotalPrice?: number | null
  adjustments?: Array<{
    origin?: 'rule' | 'manual'
    adjustmentId?: string
    ruleCode: string
    ruleName: string
    ruleType: string
    value: number
    unitPriceBefore: number
    unitPriceAfter: number
    delta: number
    reasonCode?: string
    createdByUserId?: string
  }> | null
}

export type WaterfallRow =
  | { kind: 'list'; unitPrice: number }
  | { kind: 'rule' | 'manual'; label: string; ruleType: string; value: number; delta: number; unitPriceAfter: number; reasonCode?: string; adjustmentId?: string }
  | { kind: 'standard'; unitPrice: number }
  | { kind: 'offer'; unitPrice: number }

/**
 * List → rule rows → standard → manual rows → offer. Legacy snapshots without
 * waterfall fields fall back to the stored unit price for list and standard.
 */
export function waterfallRows(charge: WaterfallChargeInput): WaterfallRow[] {
  const entries = charge.adjustments ?? []
  const rules = entries.filter((entry) => entry.origin !== 'manual')
  const manual = entries.filter((entry) => entry.origin === 'manual')
  const standard = charge.standardUnitPrice ?? (manual.length ? manual[0].unitPriceBefore : charge.unitPrice)
  const list = charge.listUnitPrice ?? (rules.length ? rules[0].unitPriceBefore : standard)
  const step = (kind: 'rule' | 'manual') => (entry: (typeof entries)[number]): WaterfallRow => ({
    kind, label: entry.ruleName || entry.ruleCode, ruleType: entry.ruleType, value: entry.value,
    delta: entry.delta, unitPriceAfter: entry.unitPriceAfter, reasonCode: entry.reasonCode, adjustmentId: entry.adjustmentId,
  })
  const rows: WaterfallRow[] = [{ kind: 'list', unitPrice: list }, ...rules.map(step('rule'))]
  if (rules.length || manual.length) rows.push({ kind: 'standard', unitPrice: standard })
  rows.push(...manual.map(step('manual')), { kind: 'offer', unitPrice: charge.unitPrice })
  return rows
}

/** Signed fraction: positive = discount, negative = surcharge, null when undefined. */
export function discountDepth(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before == null || after == null || before === 0) return null
  return 1 - after / before
}

export function formatDepth(depth: number | null): string | null {
  if (depth === null || Math.abs(depth) < 0.00005) return null
  const percent = Math.round(depth * 1000) / 10
  return depth > 0 ? `−${percent}%` : `+${Math.abs(percent)}%`
}

/** Line-level list / standard / offer totals (per line quantity), ignoring usage. */
export function lineWaterfallTotals(line: { quantity: number; charges: WaterfallChargeInput[] }) {
  let list = 0, standard = 0, offer = 0
  for (const charge of line.charges) {
    if (charge.chargeType === 'usage' || charge.totalPrice == null) continue
    const offerTotal = charge.totalPrice
    const standardTotal = charge.standardTotalPrice ?? offerTotal
    list += (charge.listTotalPrice ?? standardTotal) * line.quantity
    standard += standardTotal * line.quantity
    offer += offerTotal * line.quantity
  }
  return { list, standard, offer }
}

/** Adjustment types the server accepts for a target. */
export function allowedAdjustmentTypes(level: AdjustmentLevel, charge?: Pick<WaterfallChargeInput, 'chargeType' | 'pricingMethod'>): AdjustmentType[] {
  if (level === 'line') return ['discount_percent']
  if (!charge || charge.chargeType === 'usage') return []
  const overridable = charge.pricingMethod == null || charge.pricingMethod === 'flat' || charge.pricingMethod === 'per_unit'
  return overridable ? ['price_override', 'discount_percent', 'discount_absolute'] : ['discount_percent', 'discount_absolute']
}

export type LineEligibilityInput = {
  offeringId: string | null
  configuration?: Record<string, unknown> | null
}

/** ARC mirror lines and free-form lines take no manual adjustments yet. */
export function lineAdjustmentBlock(line: LineEligibilityInput, quoteType: string): 'mirror' | 'free_form' | null {
  const mirrored = quoteType !== 'new' && typeof line.configuration?._arcMirroredFromItemId === 'string'
  if (mirrored) return 'mirror'
  if (!line.offeringId) return 'free_form'
  return null
}

export type AdjustmentAccess =
  | { editable: true; reason: null }
  | { editable: false; reason: 'loading' | 'disabled' | 'no_permission' | 'converted' | 'locked' }

export function adjustmentAccess(input: {
  enabled: boolean | null
  canAdjust: boolean
  cpqStatus: string
  convertedOrderId: string | null
}): AdjustmentAccess {
  if (input.enabled === null) return { editable: false, reason: 'loading' }
  if (!input.enabled) return { editable: false, reason: 'disabled' }
  if (!input.canAdjust) return { editable: false, reason: 'no_permission' }
  if (input.convertedOrderId) return { editable: false, reason: 'converted' }
  if (!(ADJUSTMENT_EDITABLE_STATUSES as readonly string[]).includes(input.cpqStatus)) return { editable: false, reason: 'locked' }
  return { editable: true, reason: null }
}

/** An invalid adjustment can still be deleted after submission, unless the quote is final or converted. */
export function canDeleteInvalidAdjustment(input: { enabled: boolean | null; canAdjust: boolean; cpqStatus: string; convertedOrderId: string | null }): boolean {
  return input.enabled === true && input.canAdjust && !input.convertedOrderId && !INVALID_DELETE_BLOCKED.includes(input.cpqStatus)
}

/** English fallbacks for server error codes; keys live under `cpq.priceAdjustments.errors.*`. */
export const ADJUSTMENT_ERROR_FALLBACKS: Record<string, string> = {
  ADJUSTMENT_TARGET_MISSING: 'The adjusted charge no longer exists on this line',
  TARGET_AMBIGUOUS: 'The adjusted charge appears more than once on this line',
  ABOVE_STANDARD: 'The price is above the standard price',
  CURRENCY_MISMATCH: 'The currency does not match the quote',
  TYPE_NOT_ALLOWED: 'This kind of adjustment is not allowed for this charge',
  LINE_NOT_ELIGIBLE: 'This line cannot be adjusted',
  ADJUSTMENT_OVERLAP: 'Another adjustment already targets this charge at the same level',
  ADJUSTMENT_LOCKED: 'Adjustments are locked for this quote',
  STALE_REVISION: 'Prices changed since you opened this — reload and try again',
  REASON_NOT_FOUND: 'Pick a reason from the list',
  REASON_NOTE_REQUIRED: 'Add a note when the reason is “Other”',
  INVALID_PERCENT: 'Enter a percentage above 0 and up to 100',
  INVALID_AMOUNT: 'Enter an amount above 0',
}

export type AdjustmentForm = {
  adjustmentType: AdjustmentType
  /** Raw text from the input; parsed on submit/preview. */
  value: string
  reasonCode: string
  reasonNote: string
  /** Line level only: '' = all billable charges. */
  chargeTypeFilter: '' | 'nrc' | 'mrc'
}

export type AdjustmentTarget =
  | { level: 'charge'; quoteLineId: string; chargeCode: string }
  | { level: 'line'; quoteLineId: string }

/** Shape accepted by POST /price-adjustments and the preview `draft`. */
export function buildAdjustmentDraft(form: AdjustmentForm, target: AdjustmentTarget, currencyCode: string, expectedRevision?: number) {
  const value = Number(form.value.trim().replace(',', '.'))
  if (!form.value.trim() || !Number.isFinite(value)) return null
  const note = form.reasonNote.trim()
  return {
    level: target.level,
    quoteLineId: target.quoteLineId,
    ...(target.level === 'charge' ? { chargeCode: target.chargeCode } : { chargeTypeFilter: form.chargeTypeFilter || null }),
    adjustmentType: form.adjustmentType,
    value,
    ...(form.adjustmentType === 'discount_percent' ? {} : { currencyCode }),
    reasonCode: form.reasonCode,
    ...(note ? { reasonNote: note } : {}),
    ...(expectedRevision !== undefined ? { expectedRevision } : {}),
  }
}

/** PATCH body: target fields are immutable server-side, so they are dropped. */
export function toAdjustmentPatch(draft: NonNullable<ReturnType<typeof buildAdjustmentDraft>>) {
  const { level: _level, quoteLineId: _line, chargeCode: _charge, ...patch } = draft as typeof draft & { chargeCode?: string }
  return { ...patch, reasonNote: patch.reasonNote ?? null, currencyCode: patch.currencyCode ?? null }
}

/** Server error body → a stable code for messages (`STALE_REVISION`, `INVALID_PERCENT`, …). */
export function adjustmentErrorCode(status: number, body: unknown): string {
  const record = (body ?? {}) as { error?: unknown; details?: Array<{ message?: unknown }> }
  const detail = Array.isArray(record.details) ? record.details.find((issue) => typeof issue?.message === 'string' && /^[A-Z_]+$/.test(issue.message as string)) : undefined
  if (detail) return detail.message as string
  if (typeof record.error === 'string' && /^[A-Z_]+$/.test(record.error)) return record.error
  if (status === 403) return 'FORBIDDEN'
  if (status === 409) return 'ADJUSTMENT_LOCKED'
  return typeof record.error === 'string' ? record.error : 'UNKNOWN'
}

/** Narrow a stored charge jsonb (subscription / order item) to the waterfall shape; null when unusable. */
export function parseStoredCharge(raw: unknown): (WaterfallChargeInput & { chargeName: string; quantity: number | null }) | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  const chargeType = record.chargeType === 'nrc' || record.chargeType === 'mrc' || record.chargeType === 'usage' ? record.chargeType : null
  const unitPrice = num(record.unitPrice)
  if (!chargeType || unitPrice === undefined) return null
  const adjustments = Array.isArray(record.adjustments)
    ? (record.adjustments as Array<Record<string, unknown>>).filter((entry) =>
      entry && typeof entry === 'object' && typeof entry.ruleType === 'string' && num(entry.unitPriceAfter) !== undefined && num(entry.delta) !== undefined) as unknown as WaterfallChargeInput['adjustments']
    : null
  return {
    chargeName: typeof record.chargeName === 'string' ? record.chargeName : typeof record.chargeCode === 'string' ? record.chargeCode : '—',
    chargeType,
    pricingMethod: typeof record.pricingMethod === 'string' ? record.pricingMethod : null,
    unitPrice,
    quantity: num(record.quantity) ?? null,
    totalPrice: num(record.totalPrice) ?? null,
    listUnitPrice: num(record.listUnitPrice),
    listTotalPrice: num(record.listTotalPrice) ?? null,
    standardUnitPrice: num(record.standardUnitPrice),
    standardTotalPrice: num(record.standardTotalPrice) ?? null,
    adjustments,
  }
}
