import {
  MAX_TARGET_STEPS, TargetPriceError, isOnTarget, planTargetWrite, rowsForTarget, sameRow, stepsFromRows, targetKey, targetOf,
  type PriceTarget, type TargetPriceBody,
} from '../targetPrice'

const lineId = '44444444-4444-4444-8444-444444444444'
const recurring: PriceTarget = { level: 'line', quoteLineId: lineId, chargeTypeFilter: 'mrc' }
const body = (patch: Partial<TargetPriceBody>): TargetPriceBody => ({
  target: recurring, phases: [], then: null, currencyCode: 'USD', reasonCode: 'promotion', ...patch,
})
const stored = (rows: ReturnType<typeof rowsForTarget>) => rows.map((row, index) => ({ ...row, id: `row-${index}` }))

describe('targets', () => {
  it('derives the target of a row and keys it', () => {
    expect(targetOf({ level: 'line', quoteLineId: lineId, chargeTypeFilter: null })).toEqual({ level: 'line', quoteLineId: lineId, chargeTypeFilter: null })
    expect(targetOf({ level: 'charge', quoteLineId: lineId, chargeCode: 'fee', chargeTypeFilter: null })).toEqual({ level: 'charge', quoteLineId: lineId, chargeCode: 'fee' })
    expect(targetKey(recurring)).toBe(`line:${lineId}:mrc`)
    expect(targetKey({ level: 'line', quoteLineId: lineId, chargeTypeFilter: null })).toBe(`line:${lineId}:all`)
    expect(isOnTarget({ level: 'line', quoteLineId: lineId, chargeTypeFilter: 'nrc' }, recurring)).toBe(false)
    expect(isOnTarget({ level: 'line', quoteLineId: lineId, chargeTypeFilter: 'mrc' }, recurring)).toBe(true)
  })
})

describe('rowsForTarget', () => {
  it('builds back-to-back phases with names, Regular price as a gap, and a Then row to the end', () => {
    const rows = rowsForTarget(body({
      phases: [
        { months: 1, adjustmentType: 'price_override', value: 0, name: 'Free trial' },
        { months: 2, adjustmentType: 'regular' },
        { months: 3, adjustmentType: 'discount_percent', value: 50, name: ' 50% off ' },
      ],
      then: { adjustmentType: 'price_override', value: 120 },
    }), 12)
    expect(rows.map((row) => [row.fromMonth, row.toMonth, row.adjustmentType, row.value, row.phaseName ?? null])).toEqual([
      [1, 1, 'price_override', 0, 'Free trial'],
      [4, 6, 'discount_percent', 50, '50% off'],
      [7, null, 'price_override', 120, null],
    ])
    // % off carries no currency, like a POST from the old dialog.
    expect(rows[1].currencyCode).toBeNull()
    expect(rows[0]).toMatchObject({ level: 'line', chargeTypeFilter: 'mrc', reasonCode: 'promotion', currencyCode: 'USD' })
  })

  it('stores One price as one permanent row [1, null] and nothing as a removal', () => {
    const [row, ...rest] = rowsForTarget(body({ target: { level: 'line', quoteLineId: lineId, chargeTypeFilter: null }, then: { adjustmentType: 'discount_percent', value: 10 } }))
    expect(rest).toEqual([])
    expect(row.fromMonth).toBeUndefined()
    expect(row.toMonth).toBeUndefined()
    expect(rowsForTarget(body({ reasonCode: null }))).toEqual([])
  })

  it('allows a Then price above the standard one (ramp 100 → 110 → 120)', () => {
    const rows = rowsForTarget(body({
      phases: [{ months: 12, adjustmentType: 'regular' }, { months: 12, adjustmentType: 'price_override', value: 110, name: 'Year 2' }],
      then: { adjustmentType: 'price_override', value: 120 },
    }), 36)
    expect(rows.map((row) => [row.fromMonth, row.toMonth, row.value])).toEqual([[13, 24, 110], [25, null, 120]])
  })

  it('caps the steps and refuses steps past the term', () => {
    const many = Array.from({ length: MAX_TARGET_STEPS + 1 }, () => ({ months: 1, adjustmentType: 'discount_percent' as const, value: 5 }))
    expect(() => rowsForTarget(body({ phases: many }))).toThrow(new TargetPriceError('PHASE_TOO_MANY'))
    expect(rowsForTarget(body({ phases: many.slice(0, MAX_TARGET_STEPS) }))).toHaveLength(MAX_TARGET_STEPS)
    const past = () => rowsForTarget(body({ phases: [{ months: 13, adjustmentType: 'regular' }] }), 12)
    expect(past).toThrow(TargetPriceError)
    try { past() } catch (error) { expect(error).toMatchObject({ code: 'PHASE_PAST_TERM', stepIndex: 0 }) }
    // A Then price that would start after the term never applies.
    expect(() => rowsForTarget(body({ phases: [{ months: 12, adjustmentType: 'discount_percent', value: 5 }], then: { adjustmentType: 'discount_percent', value: 5 } }), 12))
      .toThrow(expect.objectContaining({ code: 'PHASE_PAST_TERM', stepIndex: 1 }))
  })

  it('refuses phases on a one-time or all-charges line target', () => {
    const phases = [{ months: 1, adjustmentType: 'discount_percent' as const, value: 10 }]
    expect(() => rowsForTarget(body({ target: { level: 'line', quoteLineId: lineId, chargeTypeFilter: null }, phases })))
      .toThrow(expect.objectContaining({ code: 'PHASE_RECURRING_ONLY' }))
    expect(() => rowsForTarget(body({ target: { level: 'line', quoteLineId: lineId, chargeTypeFilter: 'nrc' }, phases })))
      .toThrow(expect.objectContaining({ code: 'PHASE_RECURRING_ONLY' }))
    // A charge target is checked against its charge type when priced.
    expect(rowsForTarget(body({ target: { level: 'charge', quoteLineId: lineId, chargeCode: 'fee' }, phases }))).toHaveLength(1)
  })

  it('runs every row through the POST schema rules', () => {
    const fail = (patch: Partial<TargetPriceBody>) => { try { rowsForTarget(body(patch)); return null } catch (error) { return (error as TargetPriceError).code } }
    expect(fail({ then: { adjustmentType: 'discount_percent', value: 120 } })).toBe('INVALID_PERCENT')
    expect(fail({ then: { adjustmentType: 'discount_absolute', value: 0 } })).toBe('INVALID_AMOUNT')
    expect(fail({ target: { level: 'line', quoteLineId: lineId, chargeTypeFilter: null }, then: { adjustmentType: 'price_override', value: 5 } })).toBe('CHARGE_TYPE_REQUIRED')
    expect(fail({ reasonCode: 'other', then: { adjustmentType: 'discount_percent', value: 5 } })).toBe('REASON_NOTE_REQUIRED')
    expect(fail({ phases: [{ months: 2, adjustmentType: 'discount_percent', value: null }] })).toBe('PHASE_VALUE_REQUIRED')
    expect(fail({ phases: [{ months: 0, adjustmentType: 'regular' }] })).toBe('PHASE_LENGTH_INVALID')
  })
})

describe('stepsFromRows', () => {
  it('round-trips phases, gaps and Then', () => {
    const input = body({
      phases: [
        { months: 1, adjustmentType: 'price_override', value: 0, name: 'Free trial' },
        { months: 3, adjustmentType: 'discount_percent', value: 50, name: '50% off' },
      ],
      then: { adjustmentType: 'price_override', value: 120 },
    })
    const steps = stepsFromRows(rowsForTarget(input))
    expect(steps.mode).toBe('phases')
    expect(steps.then).toEqual({ adjustmentType: 'price_override', value: 120 })
    expect(rowsForTarget({ ...input, phases: steps.phases, then: steps.then })).toEqual(rowsForTarget(input))
  })

  it('reads a legacy "months 4–6 only" row as Regular price 3 months → the phase', () => {
    const steps = stepsFromRows([{ level: 'line', quoteLineId: lineId, chargeTypeFilter: 'mrc', adjustmentType: 'discount_percent', value: '40', reasonCode: 'loyalty', fromMonth: 4, toMonth: 6, phaseName: null }])
    expect(steps).toEqual({
      mode: 'phases', then: null, reasonCode: 'loyalty', reasonNote: null,
      phases: [{ months: 3, adjustmentType: 'regular', value: null, name: null }, { months: 3, adjustmentType: 'discount_percent', value: 40, name: null }],
    })
  })

  it('reads a permanent row as One price, and nothing as an empty One price', () => {
    expect(stepsFromRows([{ level: 'charge', quoteLineId: lineId, chargeCode: 'fee', adjustmentType: 'price_override', value: 80, reasonCode: 'loyalty', fromMonth: 1, toMonth: null }]))
      .toMatchObject({ mode: 'one_price', phases: [], then: { adjustmentType: 'price_override', value: 80 } })
    expect(stepsFromRows([])).toEqual({ mode: 'one_price', phases: [], then: null, reasonCode: null, reasonNote: null })
  })

  it('opens an open-ended row from a later month as phases with a Then', () => {
    expect(stepsFromRows([{ level: 'line', quoteLineId: lineId, chargeTypeFilter: 'mrc', adjustmentType: 'price_override', value: 90, reasonCode: 'loyalty', fromMonth: 7, toMonth: null }]))
      .toMatchObject({ mode: 'phases', phases: [{ months: 6, adjustmentType: 'regular' }], then: { value: 90 } })
  })
})

describe('planTargetWrite', () => {
  const current = stored(rowsForTarget(body({
    phases: [{ months: 1, adjustmentType: 'price_override', value: 0, name: 'Free trial' }, { months: 3, adjustmentType: 'discount_percent', value: 50, name: '50% off' }],
  })))

  it('keeps unchanged rows with their ids', () => {
    const plan = planTargetWrite(current, rowsForTarget(body({
      phases: [{ months: 1, adjustmentType: 'price_override', value: 0, name: 'Free trial' }, { months: 3, adjustmentType: 'discount_percent', value: 50, name: '50% off' }],
    })))
    expect(plan.keep.map((row) => row.id)).toEqual(['row-0', 'row-1'])
    expect(plan.update).toEqual([]); expect(plan.create).toEqual([]); expect(plan.remove).toEqual([])
  })

  it('updates a row in place when its months stay, creates and removes the rest', () => {
    const plan = planTargetWrite(current, rowsForTarget(body({
      phases: [{ months: 1, adjustmentType: 'price_override', value: 0, name: 'Free trial' }, { months: 3, adjustmentType: 'discount_percent', value: 40, name: '40% off' }, { months: 2, adjustmentType: 'discount_percent', value: 10 }],
    })))
    expect(plan.keep.map((row) => row.id)).toEqual(['row-0'])
    expect(plan.update.map((entry) => [entry.row.id, entry.input.value])).toEqual([['row-1', 40]])
    expect(plan.create.map((row) => [row.fromMonth, row.toMonth])).toEqual([[5, 6]])
    expect(plan.remove).toEqual([])
    expect(planTargetWrite(current, []).remove.map((row) => row.id)).toEqual(['row-0', 'row-1'])
  })

  it('treats a changed reason or name as a change', () => {
    expect(sameRow(current[0], { ...current[0], reasonCode: 'loyalty' })).toBe(false)
    expect(sameRow(current[0], { ...current[0], phaseName: 'Trial' })).toBe(false)
    expect(sameRow(current[0], { ...current[0], reasonNote: '' })).toBe(true)
  })
})
