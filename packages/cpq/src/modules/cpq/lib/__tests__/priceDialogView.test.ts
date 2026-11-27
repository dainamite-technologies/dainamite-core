import {
  authorText, bodyFromEditor, bundleLines, defaultTargetKey, editorFromRows, emptyStep, groupByTarget, groupSummary, pricedByText,
  scheduleText, stepRanges, suggestedPhaseName, targetOptionLabel, targetOptions,
  type DialogLine, type EditorState, type StoredRow, type Translate,
} from '../priceDialogView'
import { rowsForTarget } from '../targetPrice'

const t: Translate = (_key, fallback, params) => fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? `{${name}}`))
const lineId = '44444444-4444-4444-8444-444444444444'
const charge = (chargeCode: string, chargeType: 'mrc' | 'nrc' | 'usage', price: number) => ({ chargeCode, chargeName: `Charge ${chargeCode}`, chargeType, unitPrice: price, totalPrice: price, standardUnitPrice: price, standardTotalPrice: price })
const line: DialogLine = { lineId, offeringName: 'Internet 300', termMonths: 12, charges: [charge('fee', 'mrc', 90), charge('setup', 'nrc', 100), charge('usage', 'usage', 1)] }
let seq = 0
const row = (patch: Partial<StoredRow>): StoredRow => ({ id: `row-${++seq}`, level: 'line', quoteLineId: lineId, chargeTypeFilter: 'mrc', adjustmentType: 'discount_percent', value: 10,
  reasonCode: 'promotion', createdByUserId: 'aaaaaaaa-1111-4111-8111-111111111111', createdAt: '2026-11-27T10:00:00.000Z', ...patch })
const phased = [row({ adjustmentType: 'price_override', value: 0, fromMonth: 1, toMonth: 1, phaseName: 'Free trial' }), row({ value: 50, fromMonth: 2, toMonth: 4, phaseName: '50% off' })]

describe('target options', () => {
  it('lists the line targets the charges allow and each non-usage charge, with their state', () => {
    const options = targetOptions(line, [line], [...phased, row({ level: 'charge', chargeCode: 'setup', chargeTypeFilter: null, adjustmentType: 'price_override', value: 80 })])
    expect(options.map((option) => targetOptionLabel(t, option))).toEqual([
      'Whole line · recurring — 2 phases', 'Whole line · one-time', 'Whole line · all charges', 'Charge · Charge fee', 'Charge · Charge setup — Set price 80.00',
    ])
    expect(options.map((option) => [option.kind, option.takesPhases, option.types])).toEqual([
      ['line_mrc', true, ['price_override', 'discount_percent', 'discount_absolute']],
      ['line_nrc', false, ['price_override', 'discount_percent', 'discount_absolute']],
      ['line_all', false, ['discount_percent']],
      ['charge', true, ['price_override', 'discount_percent', 'discount_absolute']],
      ['charge', false, ['price_override', 'discount_percent', 'discount_absolute']],
    ])
  })

  it('lists only recurring targets on a recurring-only line, unless rows exist on another one', () => {
    const recurringOnly = { ...line, charges: [charge('fee', 'mrc', 90)] }
    expect(targetOptions(recurringOnly, [recurringOnly], []).map((option) => option.kind)).toEqual(['line_mrc', 'charge'])
    const stored = targetOptions(recurringOnly, [recurringOnly], [row({ chargeTypeFilter: null, value: 5 })])
    expect(stored.map((option) => option.kind)).toEqual(['line_mrc', 'line_all', 'charge'])
  })

  it('uses the whole bundle for the line targets of a bundle parent', () => {
    const parent: DialogLine = { lineId: 'parent', offeringName: 'Bundle', charges: [] }
    const child: DialogLine = { lineId: 'child', parentLineId: 'parent', offeringName: 'Child', charges: [charge('fee', 'mrc', 10)] }
    const bundle = bundleLines(parent, [parent, child])
    expect(bundle.map((entry) => entry.lineId)).toEqual(['parent', 'child'])
    expect(targetOptions(parent, bundle, []).map((option) => option.kind)).toEqual(['line_mrc'])
  })

  it('opens the charge, else the first target with an adjustment, else recurring or one-time', () => {
    expect(defaultTargetKey(targetOptions(line, [line], []), 'setup')).toBe(`charge:${lineId}:setup`)
    expect(defaultTargetKey(targetOptions(line, [line], []))).toBe(`line:${lineId}:mrc`)
    expect(defaultTargetKey(targetOptions(line, [line], [row({ chargeTypeFilter: 'nrc' })]))).toBe(`line:${lineId}:nrc`)
    const oneTime = { ...line, charges: [charge('setup', 'nrc', 100)] }
    expect(defaultTargetKey(targetOptions(oneTime, [oneTime], []))).toBe(`line:${lineId}:nrc`)
  })
})

describe('suggested phase names', () => {
  it('names Free, % off, Amount off, Year N and Special price in the UI language', () => {
    expect(suggestedPhaseName(t, { kind: 'free', value: '' }, 0, { fromMonth: 1, toMonth: 1 })).toBe('Free trial')
    expect(suggestedPhaseName(t, { kind: 'free', value: '' }, 2, { fromMonth: 4, toMonth: 4 })).toBe('Free')
    expect(suggestedPhaseName(t, { kind: 'discount_percent', value: '50' }, 1, { fromMonth: 2, toMonth: 4 })).toBe('50% off')
    expect(suggestedPhaseName(t, { kind: 'discount_absolute', value: '10' }, 1, null)).toBe('10.00 off')
    expect(suggestedPhaseName(t, { kind: 'price_override', value: '110' }, 1, { fromMonth: 13, toMonth: 24 })).toBe('Year 2')
    expect(suggestedPhaseName(t, { kind: 'price_override', value: '110' }, 1, { fromMonth: 2, toMonth: 13 })).toBe('Special price')
    expect(suggestedPhaseName(t, { kind: 'regular', value: '' }, 0, { fromMonth: 1, toMonth: 3 })).toBe('')
    const translated: Translate = (key) => key
    expect(suggestedPhaseName(translated, { kind: 'free', value: '' }, 0, null)).toBe('cpq.priceDialog.names.freeTrial')
  })
})

describe('editor ↔ body', () => {
  const recurring = targetOptions(line, [line], phased)[0]

  it('loads phased rows into Price phases with their names kept, and saves the same rows back', () => {
    const state = editorFromRows(recurring, 'promotion')
    expect(state.mode).toBe('phases')
    expect(state.steps.map((step) => [step.length, step.kind, step.value, step.name, step.nameTouched])).toEqual([['1', 'free', '', 'Free trial', true], ['3', 'discount_percent', '50', '50% off', true]])
    const { body, error } = bodyFromEditor(t, state, recurring, 'USD', 12)
    expect(error).toBeNull()
    expect(rowsForTarget(body!).map((entry) => [entry.fromMonth, entry.toMonth, entry.value, entry.phaseName])).toEqual([[1, 1, 0, 'Free trial'], [2, 4, 50, '50% off']])
  })

  it('fills suggested names until the rep types one, supports years and a Then price', () => {
    const state: EditorState = { ...editorFromRows({ rows: [], types: recurring.types, takesPhases: true }, 'promotion'), mode: 'phases',
      steps: [emptyStep('free'), { ...emptyStep('discount_percent'), value: '50', length: '3' }, { ...emptyStep('price_override'), value: '110', length: '1', unit: 'year', name: 'Ramp', nameTouched: true }],
      then: { kind: 'price_override', value: '120' } }
    expect(stepRanges(state.steps)).toEqual([{ fromMonth: 1, toMonth: 1 }, { fromMonth: 2, toMonth: 4 }, { fromMonth: 5, toMonth: 16 }])
    const { body } = bodyFromEditor(t, state, recurring, 'USD', 24)
    expect(body!.phases.map((phase) => phase.name)).toEqual(['Free trial', '50% off', 'Ramp'])
    expect(body!.then).toEqual({ adjustmentType: 'price_override', value: 120 })
  })

  it('reports the first error with its step', () => {
    const base = editorFromRows(recurring, 'promotion')
    expect(bodyFromEditor(t, { ...base, reasonCode: '' }, recurring, 'USD')).toMatchObject({ error: 'REASON_REQUIRED' })
    expect(bodyFromEditor(t, { ...base, reasonCode: 'other' }, recurring, 'USD')).toMatchObject({ error: 'REASON_NOTE_REQUIRED' })
    expect(bodyFromEditor(t, { ...base, steps: [{ ...base.steps[0], length: '0' }] }, recurring, 'USD')).toMatchObject({ error: 'PHASE_LENGTH_INVALID', stepIndex: 0 })
    expect(bodyFromEditor(t, { ...base, steps: [{ ...base.steps[0], length: '13' }] }, recurring, 'USD', 12)).toMatchObject({ error: 'PHASE_PAST_TERM', stepIndex: 0 })
    expect(bodyFromEditor(t, { ...base, steps: [{ ...emptyStep('discount_percent'), value: '120' }] }, recurring, 'USD')).toMatchObject({ error: 'PHASE_VALUE_INVALID', stepIndex: 0 })
    expect(bodyFromEditor(t, { ...base, steps: [emptyStep('regular')] }, recurring, 'USD')).toMatchObject({ error: 'PHASE_NONE' })
    expect(bodyFromEditor(t, { ...base, steps: Array.from({ length: 13 }, () => emptyStep()) }, recurring, 'USD')).toMatchObject({ error: 'PHASE_TOO_MANY' })
    expect(bodyFromEditor(t, { ...base, then: { kind: 'discount_absolute', value: '0' } }, recurring, 'USD')).toMatchObject({ error: 'PHASE_VALUE_INVALID', stepIndex: 2 })
  })

  it('saves One price as then without phases, also on a target without the switcher', () => {
    const oneTime = targetOptions(line, [line], [])[1]
    const state = { ...editorFromRows(oneTime, 'promotion'), mode: 'phases' as const, one: { adjustmentType: 'discount_percent' as const, value: '20' } }
    expect(bodyFromEditor(t, state, oneTime, 'USD').body).toMatchObject({ phases: [], then: { adjustmentType: 'discount_percent', value: 20 } })
    expect(bodyFromEditor(t, { ...state, one: { ...state.one, value: '' } }, oneTime, 'USD')).toMatchObject({ error: 'VALUE_REQUIRED' })
  })

  it('opens a legacy months 4–6 row as Regular price then the phase', () => {
    const legacy = targetOptions(line, [line], [row({ value: 40, fromMonth: 4, toMonth: 6 })])[0]
    expect(editorFromRows(legacy, 'promotion').steps.map((step) => [step.length, step.kind])).toEqual([['3', 'regular'], ['3', 'discount_percent']])
  })
})

describe('priced by and schedules', () => {
  it('names the adjustment the pricing applied, else the rules, else —', () => {
    expect(pricedByText(t, { adjustments: [], schedule: [
      { fromMonth: 1, toMonth: 1, unitPrice: 0, totalPrice: 0, standardUnitPrice: 90, standardTotalPrice: 90, source: 'manual', name: 'Free trial', adjustmentId: phased[0].id },
    ] }, lineId, phased)).toBe('Line · recurring: 2 phases')
    const setPrice = row({ level: 'charge', chargeCode: 'setup', chargeTypeFilter: null, adjustmentType: 'price_override', value: 80 })
    expect(pricedByText(t, { adjustments: [{ origin: 'manual', adjustmentId: setPrice.id, ruleCode: 'manual', ruleName: 'Manual', ruleType: 'price_override', value: 80, unitPriceBefore: 100, unitPriceAfter: 80, delta: -20 }] }, lineId, [setPrice]))
      .toBe('Charge: Set price 80.00')
    const parentRow = row({ quoteLineId: 'parent', value: 5 })
    expect(pricedByText(t, { adjustments: [{ origin: 'manual', adjustmentId: parentRow.id, ruleCode: 'm', ruleName: 'm', ruleType: 'discount_percent', value: 5, unitPriceBefore: 1, unitPriceAfter: 1, delta: 0 }] }, lineId, [parentRow]))
      .toBe('Bundle: 5% off')
    expect(pricedByText(t, { adjustments: [{ origin: 'rule', ruleCode: 'R1', ruleName: 'Winter sale', ruleType: 'discount_percent', value: 5, unitPriceBefore: 1, unitPriceAfter: 1, delta: 0 }] }, lineId, [])).toBe('Winter sale')
    expect(pricedByText(t, {}, lineId, [])).toBe('—')
  })

  it('writes the one-line schedule inside the term', () => {
    const segment = (fromMonth: number, toMonth: number | null, price: number) => ({ fromMonth, toMonth, unitPrice: price, totalPrice: price, standardUnitPrice: 90, standardTotalPrice: 90, source: 'manual' as const, name: null })
    expect(scheduleText(t, [segment(1, 1, 0), segment(2, 4, 45), segment(5, null, 90)], 12)).toBe('Month 1: 0.00 · Months 2–4: 45.00 · From month 5: 90.00')
    expect(scheduleText(t, [segment(1, 12, 0), segment(13, null, 90)], 12)).toBe('Months 1–12: 0.00')
  })
})

describe('panels', () => {
  it('groups rows by target with the latest change and a phased summary', () => {
    const later = row({ level: 'charge', chargeCode: 'setup', chargeTypeFilter: null, value: 20, updatedAt: '2026-11-28T10:00:00.000Z', createdByName: 'Bob' })
    const groups = groupByTarget([phased[1], later, phased[0]])
    expect(groups.map((group) => [group.key, group.rows.length])).toEqual([[`line:${lineId}:mrc`, 2], [`charge:${lineId}:setup`, 1]])
    expect(groups[0].rows[0].id).toBe(phased[0].id)
    expect(groupSummary(t, groups[0].rows)).toBe('2 phases: Free trial (month 1) → 50% off (months 2–4), then regular')
    expect(groupSummary(t, [...phased, row({ adjustmentType: 'price_override', value: 120, fromMonth: 5, toMonth: null })])).toBe('2 phases: Free trial (month 1) → 50% off (months 2–4), then Set price 120.00 from month 5')
    expect(groupSummary(t, groups[1].rows)).toBe('20% off')
  })

  it('shows the author name, else the email, else the short id', () => {
    expect(authorText({ createdByUserId: 'a8761ab8-0000', createdByName: 'Ann', createdByEmail: 'ann@x' })).toBe('Ann')
    expect(authorText({ createdByUserId: 'a8761ab8-0000', createdByName: ' ', createdByEmail: 'ann@x' })).toBe('ann@x')
    expect(authorText({ createdByUserId: 'a8761ab8-0000' })).toBe('a8761ab8')
  })
})
