/**
 * Pure view helpers for the quote's Price dialog and the adjustments panels
 * (UX feedback spec `.ai/specs/2026-11-27-cpq-billing-phases-ux-feedback.md`,
 * §3 / §4). Client-safe: no ORM, no DI. Labels go through an injected
 * `translate` so the helpers stay testable and every text has an i18n key.
 */
import { allowedAdjustmentTypes, type AdjustmentType, type WaterfallChargeInput } from './priceAdjustmentView'
import type { ChargeScheduleSegment } from './priceSchedule'
import { MAX_TARGET_STEPS, isOnTarget, stepsFromRows, targetKey, targetOf, type PriceTarget, type TargetPhase, type TargetPriceBody } from './targetPrice'

export type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string

/** A stored adjustment as the list GET returns it. */
export type StoredRow = {
  id: string
  level: 'charge' | 'line'
  quoteLineId: string
  chargeCode?: string | null
  chargeTypeFilter?: 'nrc' | 'mrc' | null
  adjustmentType: AdjustmentType
  value: number
  currencyCode?: string | null
  reasonCode: string
  reasonNote?: string | null
  fromMonth?: number
  toMonth?: number | null
  phaseName?: string | null
  createdByUserId: string
  createdByName?: string | null
  createdByEmail?: string | null
  createdAt: string
  updatedAt?: string
}

export type DialogCharge = WaterfallChargeInput & { chargeCode: string; chargeName: string; quantity?: number | null }
export type DialogLine = { lineId: string; offeringName: string; parentLineId?: string | null; quantity?: number; termMonths?: number | null; charges: DialogCharge[] }

export type TargetKind = 'line_mrc' | 'line_nrc' | 'line_all' | 'charge'
export type TargetState = { kind: 'none' } | { kind: 'one'; adjustmentType: AdjustmentType; value: number } | { kind: 'phases'; count: number }

export type TargetOption = {
  key: string
  kind: TargetKind
  target: PriceTarget
  chargeName?: string
  /** Types the target takes (D2 table). */
  types: AdjustmentType[]
  /** The One price / Price phases switcher shows only on recurring targets. */
  takesPhases: boolean
  rows: StoredRow[]
  state: TargetState
}

const byMonth = (a: StoredRow, b: StoredRow) => (a.fromMonth ?? 1) - (b.fromMonth ?? 1)

/** The line and its bundle descendants (a line adjustment on a bundle parent covers the bundle, spec F-D3). */
export function bundleLines<L extends DialogLine>(line: L, lines: ReadonlyArray<L>): L[] {
  const out = [line]
  for (let index = 0; index < out.length; index++) {
    for (const child of lines) if (child.parentLineId === out[index].lineId && !out.includes(child)) out.push(child)
  }
  return out
}

export function targetState(rows: ReadonlyArray<StoredRow>): TargetState {
  if (!rows.length) return { kind: 'none' }
  const steps = stepsFromRows(rows)
  if (steps.mode === 'one_price' && steps.then) return { kind: 'one', adjustmentType: steps.then.adjustmentType, value: steps.then.value }
  return { kind: 'phases', count: rows.filter((row) => row.toMonth != null).length || rows.length }
}

/**
 * Applies-to options of one line (§3.2): whole line · recurring / one-time /
 * all charges, then each non-usage charge. A target that holds rows is always
 * listed, so rows stored through the API stay editable.
 */
export function targetOptions(line: DialogLine, bundle: ReadonlyArray<DialogLine>, rows: ReadonlyArray<StoredRow>): TargetOption[] {
  const charges = bundle.flatMap((entry) => entry.charges)
  const hasMrc = charges.some((charge) => charge.chargeType === 'mrc')
  const hasNrc = charges.some((charge) => charge.chargeType === 'nrc')
  const lineRows = rows.filter((row) => row.quoteLineId === line.lineId)
  const option = (kind: TargetKind, target: PriceTarget, types: AdjustmentType[], takesPhases: boolean, chargeName?: string): TargetOption => {
    const own = lineRows.filter((row) => isOnTarget(row, target)).sort(byMonth)
    return { key: targetKey(target), kind, target, types, takesPhases, rows: own, state: targetState(own), ...(chargeName ? { chargeName } : {}) }
  }
  const all: AdjustmentType[] = ['price_override', 'discount_percent', 'discount_absolute']
  const options: TargetOption[] = []
  const lineTarget = (filter: 'mrc' | 'nrc' | null): PriceTarget => ({ level: 'line', quoteLineId: line.lineId, chargeTypeFilter: filter })
  const held = (target: PriceTarget) => lineRows.some((row) => isOnTarget(row, target))
  if (hasMrc || held(lineTarget('mrc'))) options.push(option('line_mrc', lineTarget('mrc'), all, true))
  if (hasNrc || held(lineTarget('nrc'))) options.push(option('line_nrc', lineTarget('nrc'), all, false))
  if ((hasMrc && hasNrc) || held(lineTarget(null))) options.push(option('line_all', lineTarget(null), ['discount_percent'], false))
  for (const charge of line.charges) {
    if (charge.chargeType === 'usage') continue
    options.push(option('charge', { level: 'charge', quoteLineId: line.lineId, chargeCode: charge.chargeCode }, allowedAdjustmentTypes('charge', charge), charge.chargeType === 'mrc', charge.chargeName))
  }
  for (const row of lineRows) {
    const target = targetOf(row)
    if (options.some((entry) => entry.key === targetKey(target))) continue
    // A charge that left the line: still listed so its rows can be removed.
    if (target.level === 'charge') options.push(option('charge', target, all, false, target.chargeCode))
  }
  return options
}

/**
 * Default target (§3.2): a charge's % opens that charge; the line's % opens the
 * first target with an adjustment, otherwise recurring (one-time without MRC).
 */
export function defaultTargetKey(options: ReadonlyArray<TargetOption>, chargeCode?: string | null): string | null {
  if (chargeCode) {
    const charge = options.find((entry) => entry.target.level === 'charge' && entry.target.chargeCode === chargeCode)
    if (charge) return charge.key
  }
  return (options.find((entry) => entry.rows.length) ?? options.find((entry) => entry.kind === 'line_mrc') ?? options.find((entry) => entry.kind === 'line_nrc') ?? options[0])?.key ?? null
}

export function formatAmount(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

const TYPE_FALLBACKS: Record<AdjustmentType, string> = { price_override: 'Set price', discount_percent: '% off', discount_absolute: 'Amount off' }

/** "Set price 80.00", "10% off", "5.00 off". */
export function priceText(t: Translate, adjustmentType: AdjustmentType, value: number): string {
  if (adjustmentType === 'discount_percent') return t('cpq.priceDialog.state.percentOff', '{value}% off', { value })
  if (adjustmentType === 'discount_absolute') return t('cpq.priceDialog.state.amountOff', '{value} off', { value: formatAmount(value) })
  return t('cpq.priceDialog.state.setPrice', 'Set price {value}', { value: formatAmount(value) })
}

export function stateText(t: Translate, state: TargetState): string | null {
  if (state.kind === 'none') return null
  if (state.kind === 'phases') return t('cpq.priceDialog.state.phases', '{count} phases', { count: state.count })
  return priceText(t, state.adjustmentType, state.value)
}

/** "Whole line · recurring", "Charge · Setup fee". */
export function targetName(t: Translate, option: Pick<TargetOption, 'kind' | 'chargeName' | 'target'>): string {
  switch (option.kind) {
    case 'line_mrc': return t('cpq.priceDialog.target.lineMrc', 'Whole line · recurring')
    case 'line_nrc': return t('cpq.priceDialog.target.lineNrc', 'Whole line · one-time')
    case 'line_all': return t('cpq.priceDialog.target.lineAll', 'Whole line · all charges')
    default: return t('cpq.priceDialog.target.charge', 'Charge · {name}', { name: option.chargeName ?? (option.target.level === 'charge' ? option.target.chargeCode : '') })
  }
}

/** "Whole line · recurring — 2 phases" (Applies to option, §3.2). */
export function targetOptionLabel(t: Translate, option: TargetOption): string {
  const state = stateText(t, option.state)
  return state ? `${targetName(t, option)} — ${state}` : targetName(t, option)
}

export function kindOfTarget(target: PriceTarget): TargetKind {
  if (target.level === 'charge') return 'charge'
  return target.chargeTypeFilter === 'mrc' ? 'line_mrc' : target.chargeTypeFilter === 'nrc' ? 'line_nrc' : 'line_all'
}

/** "Month 1", "Months 2–4", "From month 5" (same keys as `useMonthRangeLabel`). */
export function monthRangeText(t: Translate, fromMonth: number, toMonth: number | null): string {
  if (toMonth === null) return t('cpq.phases.monthsFrom', 'From month {from}', { from: fromMonth })
  if (toMonth === fromMonth) return t('cpq.phases.month', 'Month {from}', { from: fromMonth })
  return t('cpq.phases.months', 'Months {from}–{to}', { from: fromMonth, to: toMonth })
}

/** One-line schedule under a phased charge: "Month 1: 0.00 · Months 2–4: 45.00 · From month 5: 90.00". */
export function scheduleText(t: Translate, schedule: ReadonlyArray<ChargeScheduleSegment>, termMonths?: number | null): string {
  return schedule
    .filter((segment) => !termMonths || segment.fromMonth <= termMonths)
    .map((segment) => `${monthRangeText(t, segment.fromMonth, segment.toMonth)}: ${formatAmount(segment.totalPrice ?? segment.unitPrice)}`)
    .join(' · ')
}

/**
 * "Priced by" of one charge (§3.1): the manual adjustment the pricing applied
 * (most specific wins, as the server resolved it), else its price rules, else —.
 */
export function pricedByText(t: Translate, charge: Pick<DialogCharge, 'adjustments' | 'schedule'>, lineId: string, rows: ReadonlyArray<StoredRow>): string {
  const ids = new Set<string>()
  for (const entry of charge.adjustments ?? []) if (entry.origin === 'manual' && entry.adjustmentId) ids.add(entry.adjustmentId)
  for (const segment of charge.schedule ?? []) if (segment.source === 'manual' && segment.adjustmentId) ids.add(segment.adjustmentId)
  const applied = rows.find((row) => ids.has(row.id))
  if (applied) {
    const target = targetOf(applied)
    const own = rows.filter((row) => isOnTarget(row, target)).sort(byMonth)
    const kind = kindOfTarget(target)
    const scope = kind === 'charge' ? t('cpq.priceDialog.pricedBy.charge', 'Charge')
      : applied.quoteLineId !== lineId ? t('cpq.priceDialog.pricedBy.bundle', 'Bundle')
        : kind === 'line_mrc' ? t('cpq.priceDialog.pricedBy.lineMrc', 'Line · recurring')
          : kind === 'line_nrc' ? t('cpq.priceDialog.pricedBy.lineNrc', 'Line · one-time')
            : t('cpq.priceDialog.pricedBy.lineAll', 'Line · all charges')
    return `${scope}: ${stateText(t, targetState(own)) ?? ''}`
  }
  const rules = [...new Set((charge.adjustments ?? []).filter((entry) => entry.origin !== 'manual').map((entry) => entry.ruleName || entry.ruleCode))]
  return rules.length ? rules.join(', ') : '—'
}

// ─── Editor state (D1) ───────────────────────────────────────────────

export type StepKind = 'regular' | 'free' | AdjustmentType
export type StepForm = { length: string; unit: 'month' | 'year'; kind: StepKind; value: string; name: string; nameTouched: boolean }
export type ThenForm = { kind: 'regular' | AdjustmentType; value: string }
export type EditorMode = 'one_price' | 'phases'
export type EditorState = {
  mode: EditorMode
  one: { adjustmentType: AdjustmentType; value: string }
  steps: StepForm[]
  then: ThenForm
  reasonCode: string
  reasonNote: string
}

export function emptyStep(kind: StepKind = 'free'): StepForm {
  return { length: '1', unit: 'month', kind, value: '', name: '', nameTouched: false }
}

const valueText = (value: number | null | undefined) => (value == null ? '' : String(value))

/** Editor state of a target's rows; rows with any month range open in Price phases (D1). */
export function editorFromRows(option: Pick<TargetOption, 'rows' | 'types' | 'takesPhases'>, defaultReason: string): EditorState {
  const steps = stepsFromRows(option.rows)
  const firstType = option.types[0] ?? 'discount_percent'
  const base: EditorState = {
    mode: 'one_price', one: { adjustmentType: firstType, value: '' }, steps: [emptyStep()], then: { kind: 'regular', value: '' },
    reasonCode: steps.reasonCode ?? defaultReason, reasonNote: steps.reasonNote ?? '',
  }
  if (steps.mode === 'one_price') {
    return steps.then ? { ...base, one: { adjustmentType: steps.then.adjustmentType, value: valueText(steps.then.value) } } : base
  }
  return {
    ...base,
    mode: 'phases',
    steps: steps.phases.map((phase) => {
      const years = phase.months % 12 === 0 && phase.months >= 12
      const free = phase.adjustmentType === 'price_override' && phase.value === 0
      // Loaded names count as typed: re-saving never renames a stored phase.
      return { length: String(years ? phase.months / 12 : phase.months), unit: years ? 'year' : 'month', kind: free ? 'free' : phase.adjustmentType,
        value: free ? '' : valueText(phase.value), name: phase.name ?? '', nameTouched: true }
    }),
    then: steps.then ? { kind: steps.then.adjustmentType, value: valueText(steps.then.value) } : { kind: 'regular', value: '' },
  }
}

function positiveInt(raw: string): number | null {
  const value = Number(raw.trim())
  return raw.trim() && Number.isInteger(value) && value >= 1 ? value : null
}

function amount(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  const value = Number(text)
  return text && Number.isFinite(value) ? value : null
}

/** Back-to-back month ranges of the steps; null for a step whose length is not a whole number ≥ 1. */
export function stepRanges(steps: ReadonlyArray<Pick<StepForm, 'length' | 'unit'>>): Array<{ fromMonth: number; toMonth: number } | null> {
  let next = 1
  return steps.map((step) => {
    const length = positiveInt(step.length)
    if (length === null) return null
    const range = { fromMonth: next, toMonth: next + (step.unit === 'year' ? length * 12 : length) - 1 }
    next = range.toMonth + 1
    return range
  })
}

/**
 * Suggested phase name (§3.5), in the rep's UI language: Free trial (first
 * step) / Free, "50% off", "10.00 off", "Year N" for a Set price over exactly
 * one year from a year boundary, otherwise "Special price". Regular price
 * steps have no name (no row is stored).
 */
export function suggestedPhaseName(t: Translate, step: Pick<StepForm, 'kind' | 'value'>, stepIndex: number, range: { fromMonth: number; toMonth: number } | null): string {
  const value = amount(step.value)
  switch (step.kind) {
    case 'regular': return ''
    case 'free': return stepIndex === 0 ? t('cpq.priceDialog.names.freeTrial', 'Free trial') : t('cpq.priceDialog.names.free', 'Free')
    case 'discount_percent': return value === null ? '' : t('cpq.priceDialog.names.percentOff', '{value}% off', { value })
    case 'discount_absolute': return value === null ? '' : t('cpq.priceDialog.names.amountOff', '{value} off', { value: formatAmount(value) })
    default:
      if (range && range.toMonth - range.fromMonth + 1 === 12 && range.fromMonth % 12 === 1) {
        return t('cpq.priceDialog.names.year', 'Year {year}', { year: (range.fromMonth - 1) / 12 + 1 })
      }
      return t('cpq.priceDialog.names.special', 'Special price')
  }
}

/** The name a step saves: what the rep typed, else the suggestion. */
export function stepName(t: Translate, step: StepForm, stepIndex: number, range: { fromMonth: number; toMonth: number } | null): string {
  return step.nameTouched ? step.name.trim() : suggestedPhaseName(t, step, stepIndex, range)
}

export type EditorError = 'PHASE_LENGTH_INVALID' | 'PHASE_VALUE_INVALID' | 'PHASE_TOO_MANY' | 'PHASE_NONE' | 'PHASE_PAST_TERM' | 'VALUE_REQUIRED' | 'REASON_REQUIRED' | 'REASON_NOTE_REQUIRED'

function valid(type: AdjustmentType, value: number | null): value is number {
  if (value === null || value < 0) return false
  if (type === 'discount_percent') return value > 0 && value <= 100
  if (type === 'discount_absolute') return value > 0
  return true
}

/**
 * The PUT / preview body of the editor (§6.1), or the first error the server
 * would refuse, with its step (`stepIndex === steps.length` = Then).
 */
export function bodyFromEditor(t: Translate, state: EditorState, option: Pick<TargetOption, 'target' | 'takesPhases'>, currencyCode: string, termMonths?: number | null):
  { body: TargetPriceBody | null; error: EditorError | null; stepIndex?: number } {
  const reason = { currencyCode, reasonCode: state.reasonCode || null, reasonNote: state.reasonNote.trim() || null }
  const fail = (error: EditorError, stepIndex?: number) => ({ body: null, error, ...(stepIndex !== undefined ? { stepIndex } : {}) })
  if (!state.reasonCode) return fail('REASON_REQUIRED')
  if (state.reasonCode === 'other' && !state.reasonNote.trim()) return fail('REASON_NOTE_REQUIRED')
  if (state.mode === 'one_price' || !option.takesPhases) {
    const value = amount(state.one.value)
    if (!state.one.value.trim()) return fail('VALUE_REQUIRED')
    if (!valid(state.one.adjustmentType, value)) return fail('PHASE_VALUE_INVALID')
    return { body: { target: option.target, phases: [], then: { adjustmentType: state.one.adjustmentType, value }, ...reason }, error: null }
  }
  if (state.steps.length > MAX_TARGET_STEPS) return fail('PHASE_TOO_MANY')
  const ranges = stepRanges(state.steps)
  const phases: TargetPhase[] = []
  for (const [index, step] of state.steps.entries()) {
    const range = ranges[index]
    if (!range) return fail('PHASE_LENGTH_INVALID', index)
    if (termMonths && range.toMonth > termMonths) return fail('PHASE_PAST_TERM', index)
    const months = range.toMonth - range.fromMonth + 1
    if (step.kind === 'regular') { phases.push({ months, adjustmentType: 'regular' }); continue }
    const value = step.kind === 'free' ? 0 : amount(step.value)
    const type: AdjustmentType = step.kind === 'free' ? 'price_override' : step.kind
    if (!valid(type, value)) return fail('PHASE_VALUE_INVALID', index)
    const name = stepName(t, step, index, range)
    phases.push({ months, adjustmentType: type, value, ...(name ? { name } : {}) })
  }
  let then: TargetPriceBody['then'] = null
  if (state.then.kind !== 'regular') {
    const value = amount(state.then.value)
    if (!valid(state.then.kind, value)) return fail('PHASE_VALUE_INVALID', state.steps.length)
    then = { adjustmentType: state.then.kind, value }
  }
  if (!phases.some((phase) => phase.adjustmentType !== 'regular') && !then) return fail('PHASE_NONE')
  return { body: { target: option.target, phases, then, ...reason }, error: null }
}

/** The removal body: nothing on the target (§3.4). */
export function removalBody(target: PriceTarget): TargetPriceBody {
  return { target, phases: [], then: null }
}

// ─── Panels (§4.2 / §4.3) ────────────────────────────────────────────

export type PanelGroup = { key: string; target: PriceTarget; rows: StoredRow[]; latest: StoredRow }

/** One group per target, in first-created order; `latest` is its last change (author and date). */
export function groupByTarget(rows: ReadonlyArray<StoredRow>): PanelGroup[] {
  const groups = new Map<string, PanelGroup>()
  for (const row of rows) {
    const target = targetOf(row)
    const key = targetKey(target)
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { key, target, rows: [row], latest: row })
  }
  for (const group of groups.values()) {
    group.rows.sort(byMonth)
    group.latest = group.rows.reduce((latest, row) => ((row.updatedAt ?? row.createdAt) > (latest.updatedAt ?? latest.createdAt) ? row : latest))
  }
  return [...groups.values()]
}

/** "2 phases: Free trial (month 1) → 50% off (months 2–4), then regular" or "Set price 80.00". */
export function groupSummary(t: Translate, rows: ReadonlyArray<StoredRow>): string {
  const state = targetState(rows)
  if (state.kind !== 'phases') return stateText(t, state) ?? ''
  const bounded = rows.filter((row) => row.toMonth != null)
  const open = rows.find((row) => row.toMonth == null)
  const parts = bounded.map((row) => `${row.phaseName?.trim() || priceText(t, row.adjustmentType, row.value)} (${monthRangeText(t, row.fromMonth ?? 1, row.toMonth ?? null).toLowerCase()})`)
  const then = open
    ? t('cpq.priceDialog.summary.thenPrice', 'then {price} from month {from}', { price: priceText(t, open.adjustmentType, open.value), from: open.fromMonth ?? 1 })
    : t('cpq.priceDialog.summary.thenRegular', 'then regular')
  return `${t('cpq.priceDialog.state.phases', '{count} phases', { count: state.count })}: ${parts.join(' → ')}${parts.length ? ', ' : ''}${then}`
}

/** Author shown in the panels (D7): name, else email, else the short id (the full id goes in the tooltip). */
export function authorText(row: Pick<StoredRow, 'createdByName' | 'createdByEmail' | 'createdByUserId'>): string {
  return row.createdByName?.trim() || row.createdByEmail?.trim() || row.createdByUserId.slice(0, 8)
}
