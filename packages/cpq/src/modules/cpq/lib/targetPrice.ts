/**
 * A target's price: one adjustment set per target (UX feedback spec
 * `.ai/specs/2026-11-27-cpq-billing-phases-ux-feedback.md`, D1 / D2 / D5).
 *
 * A **target** is the whole line (recurring, one-time or all charges) or one
 * charge of a line. Its price is either *One price* (one permanent row
 * `[1, null]`) or *Price phases*: steps back to back from month 1, then the
 * price after them (*Then*). A *Regular price* step is a gap between rows, so
 * no schema change is needed: the steps are the target's existing
 * `cpq_quote_price_adjustments` rows.
 *
 * Pure (no ORM, no DI): shared by the target service, routes and the Price
 * dialog. The server stays the authority on pricing; these helpers only shape
 * rows and validate the structure the dialog edits.
 */
import { cpqPriceAdjustmentInputSchema, type PriceAdjustmentInput } from '../data/price-adjustments'
import { normalizeRange } from './priceSchedule'

/** At most 12 steps, *Regular price* steps included: each becomes one billing phase (spec P). */
export const MAX_TARGET_STEPS = 12

export type PriceTarget =
  | { level: 'line'; quoteLineId: string; chargeTypeFilter: 'mrc' | 'nrc' | null }
  | { level: 'charge'; quoteLineId: string; chargeCode: string }

export type PricedAdjustmentType = 'price_override' | 'discount_percent' | 'discount_absolute'
export type TargetStepType = 'regular' | PricedAdjustmentType

export interface TargetPhase {
  months: number
  adjustmentType: TargetStepType
  /** Required except for `regular`. Free = `price_override` 0. */
  value?: number | null
  name?: string | null
}

export interface TargetThen {
  adjustmentType: PricedAdjustmentType
  value: number
  /** Name of the row to the end; kept from a stored row (rows stored through the API may carry one). */
  name?: string | null
}

export interface TargetPriceBody {
  target: PriceTarget
  phases: TargetPhase[]
  /** With phases: the price after them (null = regular price). Without phases: the One price. */
  then: TargetThen | null
  currencyCode?: string | null
  reasonCode?: string | null
  reasonNote?: string | null
}

/** A stored row as far as targets care (snapshot, entity or resolver input). */
export interface TargetRow {
  level: string
  quoteLineId: string
  chargeCode?: string | null
  chargeTypeFilter?: string | null
  adjustmentType: string
  value: number | string
  currencyCode?: string | null
  reasonCode: string
  reasonNote?: string | null
  fromMonth?: number | null
  toMonth?: number | null
  phaseName?: string | null
}

/** Structural error of a target body, with the step it points at (0-based; `phases.length` = Then). */
export class TargetPriceError extends Error {
  constructor(public readonly code: string, public readonly stepIndex?: number) {
    super(code)
    this.name = 'TargetPriceError'
  }
}

export function targetOf(row: Pick<TargetRow, 'level' | 'quoteLineId' | 'chargeCode' | 'chargeTypeFilter'>): PriceTarget {
  if (row.level === 'charge') return { level: 'charge', quoteLineId: row.quoteLineId, chargeCode: row.chargeCode ?? '' }
  const filter = row.chargeTypeFilter === 'mrc' || row.chargeTypeFilter === 'nrc' ? row.chargeTypeFilter : null
  return { level: 'line', quoteLineId: row.quoteLineId, chargeTypeFilter: filter }
}

/** Stable key of a target: `line:<id>:mrc|nrc|all` or `charge:<id>:<code>`. */
export function targetKey(target: PriceTarget): string {
  return target.level === 'charge'
    ? `charge:${target.quoteLineId}:${target.chargeCode}`
    : `line:${target.quoteLineId}:${target.chargeTypeFilter ?? 'all'}`
}

export function isOnTarget(row: Pick<TargetRow, 'level' | 'quoteLineId' | 'chargeCode' | 'chargeTypeFilter'>, target: PriceTarget): boolean {
  return targetKey(targetOf(row)) === targetKey(target)
}

/** Only a recurring target takes phases: a line's recurring total, or a charge (checked against its type when priced). */
export function targetTakesPhases(target: PriceTarget): boolean {
  return target.level === 'charge' || target.chargeTypeFilter === 'mrc'
}

function zodCode(error: { issues: Array<{ message: string }> }): string {
  return error.issues.find((issue) => /^[A-Z_]+$/.test(issue.message))?.message ?? 'INVALID_ADJUSTMENT'
}

/**
 * The rows one body writes on its target, in month order. Every row passes
 * the same `cpqPriceAdjustmentInputSchema` as a POST (R: old and new paths
 * never drift). Throws `TargetPriceError` for what the target cannot hold.
 *
 * `termMonths` (the line's term) refuses steps that run past it.
 */
export function rowsForTarget(body: TargetPriceBody, termMonths?: number | null): PriceAdjustmentInput[] {
  const { target, phases, then } = body
  if (phases.length > MAX_TARGET_STEPS) throw new TargetPriceError('PHASE_TOO_MANY')
  if (phases.length && !targetTakesPhases(target)) throw new TargetPriceError('PHASE_RECURRING_ONLY', 0)
  const term = termMonths && termMonths > 0 ? termMonths : null
  const base = {
    level: target.level,
    quoteLineId: target.quoteLineId,
    ...(target.level === 'charge' ? { chargeCode: target.chargeCode } : { chargeTypeFilter: target.chargeTypeFilter }),
    currencyCode: body.currencyCode ?? null,
    reasonCode: body.reasonCode ?? '',
    ...(body.reasonNote ? { reasonNote: body.reasonNote } : {}),
  }
  const build = (stepIndex: number, fields: Record<string, unknown>): PriceAdjustmentInput => {
    if (!body.reasonCode) throw new TargetPriceError('REASON_NOT_FOUND', stepIndex)
    // A % off carries no currency (as a POST from the old dialog), so a resave matches the stored row.
    const currency = fields.adjustmentType === 'discount_percent' ? { currencyCode: null } : {}
    const parsed = cpqPriceAdjustmentInputSchema.safeParse({ ...base, ...fields, ...currency })
    if (!parsed.success) throw new TargetPriceError(zodCode(parsed.error), stepIndex)
    return parsed.data
  }
  const rows: PriceAdjustmentInput[] = []
  let cursor = 1
  phases.forEach((phase, index) => {
    if (!Number.isInteger(phase.months) || phase.months < 1) throw new TargetPriceError('PHASE_LENGTH_INVALID', index)
    const fromMonth = cursor, toMonth = cursor + phase.months - 1
    cursor = toMonth + 1
    if (term && toMonth > term) throw new TargetPriceError('PHASE_PAST_TERM', index)
    if (phase.adjustmentType === 'regular') return
    if (phase.value == null) throw new TargetPriceError('PHASE_VALUE_REQUIRED', index)
    const name = phase.name?.trim()
    rows.push(build(index, { adjustmentType: phase.adjustmentType, value: phase.value, windowKind: 'relative', fromMonth, toMonth, ...(name ? { phaseName: name } : {}) }))
  })
  if (then) {
    const thenName = then.name?.trim()
    const named = thenName ? { phaseName: thenName } : {}
    if (!phases.length) rows.push(build(0, { adjustmentType: then.adjustmentType, value: then.value, ...named }))
    else {
      if (term && cursor > term) throw new TargetPriceError('PHASE_PAST_TERM', phases.length)
      rows.push(build(phases.length, { adjustmentType: then.adjustmentType, value: then.value, windowKind: 'relative', fromMonth: cursor, toMonth: null, ...named }))
    }
  }
  return rows
}

export type TargetMode = 'one_price' | 'phases'

export interface TargetSteps {
  mode: TargetMode
  phases: Array<Required<Pick<TargetPhase, 'months' | 'adjustmentType'>> & { value: number | null; name: string | null }>
  then: TargetThen | null
  /** Reason and note of the first step (a set with mixed reasons shows the first, §3.4). */
  reasonCode: string | null
  reasonNote: string | null
}

/**
 * A target's rows as dialog steps, in `from_month` order: gaps become
 * *Regular price* steps and the open-ended row becomes *Then*. One row
 * `[1, null]` is *One price*. Any non-overlapping set reads back this way, so
 * rows stored through the API (e.g. "months 4–6 only") stay editable.
 */
export function stepsFromRows(rows: ReadonlyArray<TargetRow>): TargetSteps {
  const sorted = [...rows].map((row) => ({ row, ...normalizeRange(row) })).sort((a, b) => a.fromMonth - b.fromMonth)
  const first = sorted[0]?.row
  const reasonCode = first?.reasonCode ?? null
  const reasonNote = first?.reasonNote ?? null
  if (sorted.length === 1 && sorted[0].fromMonth === 1 && sorted[0].toMonth === null) {
    return { mode: 'one_price', phases: [], then: priced(sorted[0].row), reasonCode, reasonNote }
  }
  const phases: TargetSteps['phases'] = []
  let then: TargetThen | null = null
  let cursor = 1
  for (const entry of sorted) {
    if (entry.fromMonth > cursor) phases.push({ months: entry.fromMonth - cursor, adjustmentType: 'regular', value: null, name: null })
    if (entry.toMonth === null) { then = priced(entry.row); break }
    phases.push({ months: entry.toMonth - Math.max(entry.fromMonth, cursor) + 1, adjustmentType: entry.row.adjustmentType as PricedAdjustmentType, value: Number(entry.row.value), name: entry.row.phaseName ?? null })
    cursor = entry.toMonth + 1
  }
  return { mode: sorted.length ? 'phases' : 'one_price', phases, then, reasonCode, reasonNote }
}

/** The open-ended row (Then or One price), with its stored name so a resave keeps the row. */
function priced(row: TargetRow): TargetThen {
  const name = row.phaseName?.trim()
  return { adjustmentType: row.adjustmentType as PricedAdjustmentType, value: Number(row.value), ...(name ? { name } : {}) }
}

function sameRange(a: TargetRow, b: TargetRow): boolean {
  const left = normalizeRange(a), right = normalizeRange(b)
  return left.fromMonth === right.fromMonth && left.toMonth === right.toMonth
}

const text = (value: string | null | undefined) => (value ?? '').trim() || null

/** Same price, reason and name over the same months: the row needs no write. */
export function sameRow(a: TargetRow, b: TargetRow): boolean {
  return sameRange(a, b) && a.adjustmentType === b.adjustmentType && Number(a.value) === Number(b.value) &&
    (a.currencyCode ?? null) === (b.currencyCode ?? null) && a.reasonCode === b.reasonCode &&
    text(a.reasonNote) === text(b.reasonNote) && text(a.phaseName) === text(b.phaseName)
}

export interface TargetWritePlan<B extends TargetRow & { id: string }> {
  /** Unchanged: keeps id, author and dates. */
  keep: B[]
  /** Same month range, new price / reason / name: updated in place. */
  update: Array<{ row: B; input: PriceAdjustmentInput }>
  create: PriceAdjustmentInput[]
  /** Soft-deleted. */
  remove: B[]
}

/**
 * keep / update / create / delete from the target's stored rows to the wanted
 * ones. Exact matches are kept first, then rows over the same months are
 * updated in place; whatever is left is created or removed.
 */
export function planTargetWrite<B extends TargetRow & { id: string }>(before: ReadonlyArray<B>, wanted: ReadonlyArray<PriceAdjustmentInput>): TargetWritePlan<B> {
  const free = new Set(before)
  const keep: B[] = []
  const pending: PriceAdjustmentInput[] = []
  for (const input of wanted) {
    const match = [...free].find((row) => sameRow(row, input))
    if (match) { free.delete(match); keep.push(match) } else pending.push(input)
  }
  const update: TargetWritePlan<B>['update'] = []
  const create: PriceAdjustmentInput[] = []
  for (const input of pending) {
    const match = [...free].find((row) => sameRange(row, input))
    if (match) { free.delete(match); update.push({ row: match, input }) } else create.push(input)
  }
  return { keep, update, create, remove: [...free] }
}
